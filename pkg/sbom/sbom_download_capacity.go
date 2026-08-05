package sbom

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/securebuildhq/securebuild/pkg/buildbackend"
	"github.com/securebuildhq/securebuild/pkg/builder"
	buildertypes "github.com/securebuildhq/securebuild/pkg/builder/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/scan"
	"github.com/securebuildhq/securebuild/pkg/telemetry"
	"go.uber.org/zap"
)

const (
	// SbomDownloadTimeout is the maximum duration a syft SBOM generation can
	// run on a builder before it is considered stuck and killed. Image pulls
	// can be slow, so this is longer than ScanTimeout.
	SbomDownloadTimeout = 30 * time.Minute

	// SbomDownloadPollerInterval is how often the SBOM download status poller
	// checks builders for completed downloads.
	SbomDownloadPollerInterval = 10 * time.Second

	// SbomDownloadStartupGracePeriod is the grace period after a download is
	// dispatched before the poller starts checking for exit codes.
	SbomDownloadStartupGracePeriod = 120 * time.Second
)

// ErrNoBuilderAvailableForSbomDownload is returned by SelectBuilderForSbomDownload
// when all running builders are at SBOM download capacity.
var ErrNoBuilderAvailableForSbomDownload = fmt.Errorf("no builder available for SBOM download")

// SbomDownloadMetadata is the JSON metadata file written to each SBOM download
// directory on the builder. It allows the poller to discover downloads and know
// which DB rows to update.
type SbomDownloadMetadata struct {
	Digest     string    `json:"digest"`
	Registry   string    `json:"registry"`
	ImageName  string    `json:"image_name"`
	CreatedAt  time.Time `json:"created_at"`
	RetryCount int       `json:"retry_count"`
}

// SbomDownloadDirInfo tracks a single active SBOM download directory on a builder.
type SbomDownloadDirInfo struct {
	Digest    string
	WorkDir   string
	CreatedAt time.Time
}

// SbomDownloadCapacityCache tracks active SBOM downloads per builder, maintained
// from filesystem scans. There is only one worker instance, so no cross-instance
// coordination is needed. This mirrors ScanCapacityCache but with separate
// capacity limits (MaxSbomDownloadsPerBuilder) since image pulls are heavier.
type SbomDownloadCapacityCache struct {
	mu     sync.RWMutex
	counts map[string]int                  // machineID → count of active download directories
	scans  map[string][]SbomDownloadDirInfo // machineID → list of active download dirs
	ready  bool
}

// NewSbomDownloadCapacityCache creates a new empty SbomDownloadCapacityCache.
func NewSbomDownloadCapacityCache() *SbomDownloadCapacityCache {
	return &SbomDownloadCapacityCache{
		counts: make(map[string]int),
		scans:  make(map[string][]SbomDownloadDirInfo),
	}
}

// IsReady returns true if the cache has been initialized from the builder
// filesystems.
func (c *SbomDownloadCapacityCache) IsReady() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.ready
}

func (c *SbomDownloadCapacityCache) setReady(ready bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.ready = ready
}

// SetBuilderDownloads replaces all download entries for a builder with the given
// list. Called by the poller every 10s to resync the cache with what's actually
// on the builder filesystem.
func (c *SbomDownloadCapacityCache) SetBuilderDownloads(machineID string, downloads []SbomDownloadDirInfo) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(downloads) == 0 {
		delete(c.counts, machineID)
		delete(c.scans, machineID)
		return
	}
	c.scans[machineID] = downloads
	c.counts[machineID] = len(downloads)
}

// AddDownload appends a download entry to the scans map for a builder without
// modifying counts (tryReserveSlot already incremented the count).
func (c *SbomDownloadCapacityCache) AddDownload(machineID string, info SbomDownloadDirInfo) {
	c.mu.Lock()
	defer c.mu.Unlock()
	downloads := c.scans[machineID]
	for i, d := range downloads {
		if d.Digest == info.Digest {
			downloads[i] = info
			return
		}
	}
	c.scans[machineID] = append(downloads, info)
}

// RemoveDownload removes a download for a builder by digest. Called by the
// poller when a download completes.
func (c *SbomDownloadCapacityCache) RemoveDownload(machineID, digest string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	downloads := c.scans[machineID]
	for i, d := range downloads {
		if d.Digest == digest {
			c.scans[machineID] = append(downloads[:i], downloads[i+1:]...)
			c.counts[machineID]--
			if c.counts[machineID] <= 0 {
				delete(c.counts, machineID)
				delete(c.scans, machineID)
			}
			return
		}
	}
}

// RemoveBuilder removes all downloads for a builder (e.g. when the builder is deleted).
func (c *SbomDownloadCapacityCache) RemoveBuilder(machineID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.counts, machineID)
	delete(c.scans, machineID)
}

// GetBuilderDownloadCount returns the number of active downloads for a builder.
func (c *SbomDownloadCapacityCache) GetBuilderDownloadCount(machineID string) int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.counts[machineID]
}

// GetDownloadsForBuilder returns the list of active download dirs for a builder.
func (c *SbomDownloadCapacityCache) GetDownloadsForBuilder(machineID string) []SbomDownloadDirInfo {
	c.mu.RLock()
	defer c.mu.RUnlock()
	result := make([]SbomDownloadDirInfo, len(c.scans[machineID]))
	copy(result, c.scans[machineID])
	return result
}

// GetTotalDownloadCount returns the total number of active downloads across all
// builders. Used by the scheduler for backpressure.
func (c *SbomDownloadCapacityCache) GetTotalDownloadCount() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	total := 0
	for _, count := range c.counts {
		total += count
	}
	return total
}

// GetTotalActiveDownloadCount returns the total number of active download
// directories across all builders, based on the scans map (not the counts map).
func (c *SbomDownloadCapacityCache) GetTotalActiveDownloadCount() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	total := 0
	for _, downloads := range c.scans {
		total += len(downloads)
	}
	return total
}

// GetBuilderIDs returns the machine IDs of all builders that have active downloads.
func (c *SbomDownloadCapacityCache) GetBuilderIDs() []string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	ids := make([]string, 0, len(c.scans))
	for id := range c.scans {
		ids = append(ids, id)
	}
	return ids
}

// tryReserveSlot atomically checks whether a builder has capacity for one more
// SBOM download and, if so, increments the count under the write lock.
func (c *SbomDownloadCapacityCache) tryReserveSlot(machineID string, hasBuildAssignment bool, maxDownloadsPerBuilder int) bool {
	c.mu.Lock()
	defer c.mu.Unlock()

	current := c.counts[machineID]

	if hasBuildAssignment {
		if current >= 1 {
			return false
		}
	} else {
		if current >= maxDownloadsPerBuilder {
			return false
		}
	}

	c.counts[machineID] = current + 1
	return true
}

// ReleaseDownloadSlot decrements the capacity count for a builder. Used when a
// reservation was made but the download dispatch failed before files were written.
func (c *SbomDownloadCapacityCache) ReleaseDownloadSlot(machineID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.counts[machineID]--
	if c.counts[machineID] <= 0 {
		delete(c.counts, machineID)
		if len(c.scans[machineID]) == 0 {
			delete(c.scans, machineID)
		}
	}
}

// ReportDownloadCapacityMetrics sends gauge metrics for total and used SBOM
// download capacity.
func (c *SbomDownloadCapacityCache) ReportDownloadCapacityMetrics(ctx context.Context) {
	maxDownloadsPerBuilder := param.GetParam(ctx).MaxSbomDownloadsPerBuilder

	builders, err := scan.GetRunningBuildersForScan(ctx)
	if err != nil {
		logger.Warn("failed to query running builders for SBOM download capacity metrics",
			zap.Error(err))
		return
	}

	totalCapacity := len(builders) * maxDownloadsPerBuilder
	telemetry.Gauge(telemetry.MetricExternalImageSbomDownloadCapacityTotal, float64(totalCapacity), nil)

	used := c.GetTotalDownloadCount()
	telemetry.Gauge(telemetry.MetricExternalImageSbomDownloadCapacityUsed, float64(used), nil)

	for _, b := range builders {
		builderUsed := c.GetBuilderDownloadCount(b.ID)
		telemetry.Gauge(telemetry.MetricExternalImageSbomDownloadCapacityUsed, float64(builderUsed),
			[]string{"machine_id:" + b.ID})
	}
}

// DumpToFile writes the current cache state to a JSON file for debugging.
func (c *SbomDownloadCapacityCache) DumpToFile() error {
	c.mu.RLock()
	snapshot := struct {
		Timestamp time.Time                     `json:"timestamp"`
		Ready     bool                          `json:"ready"`
		Counts    map[string]int                `json:"counts"`
		Downloads map[string][]SbomDownloadDirInfo `json:"downloads"`
	}{
		Timestamp: time.Now().UTC(),
		Ready:     c.ready,
		Counts:    make(map[string]int, len(c.counts)),
		Downloads: make(map[string][]SbomDownloadDirInfo, len(c.scans)),
	}
	for k, v := range c.counts {
		snapshot.Counts[k] = v
	}
	for k, v := range c.scans {
		snapshot.Downloads[k] = make([]SbomDownloadDirInfo, len(v))
		copy(snapshot.Downloads[k], v)
	}
	c.mu.RUnlock()

	data, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal SBOM download cache dump: %w", err)
	}

	path := filepath.Join(os.TempDir(), "securebuild-sbom-download-capacity-cache.json")
	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("failed to write SBOM download cache dump to %s: %w", path, err)
	}

	return nil
}

// InitSbomDownloadCapacityCache performs a one-time full scan of all running
// builders to discover in-flight SBOM download directories and populate the
// in-memory cache. This enables self-healing after a worker restart: syft
// processes survive the restart (they run via nohup), and the poller resumes
// collecting results.
func InitSbomDownloadCapacityCache(ctx context.Context) (*SbomDownloadCapacityCache, error) {
	cache := NewSbomDownloadCapacityCache()

	builders, err := scan.GetRunningBuildersForScan(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to query running builders for SBOM download cache init: %w", err)
	}

	var wg sync.WaitGroup
	for _, b := range builders {
		wg.Add(1)
		go func(b scan.BuilderForScan) {
			defer wg.Done()
			downloads, err := ListSbomDownloadDirsOnBuilder(ctx, b.BuilderVM)
			if err != nil {
				logger.Warn("failed to list SBOM download dirs on builder during init, skipping",
					zap.String("machineID", b.BuilderVM.ID),
					zap.Error(err))
				return
			}

			activeDownloads := make([]SbomDownloadDirInfo, 0)
			for _, d := range downloads {
				if d.AllArchsDone {
					continue
				}
				activeDownloads = append(activeDownloads, SbomDownloadDirInfo{
					Digest:    d.Metadata.Digest,
					WorkDir:   d.WorkDir,
					CreatedAt: d.Metadata.CreatedAt,
				})
			}
			cache.SetBuilderDownloads(b.BuilderVM.ID, activeDownloads)
		}(b)
	}
	wg.Wait()

	cache.setReady(true)
	logger.Info("SBOM download capacity cache initialized",
		zap.Int("builders", len(builders)),
		zap.Int("activeDownloads", cache.GetTotalDownloadCount()))

	return cache, nil
}

// SelectBuilderForSbomDownload finds a builder VM that can accept a new SBOM
// download and atomically reserves a capacity slot. Priority: idle builders
// first, then busy builders.
// Capacity rules:
//   - Idle builders: up to maxSbomDownloadsPerBuilder concurrent downloads
//   - Busy builders: at most 1 concurrent download
func SelectBuilderForSbomDownload(ctx context.Context, cache *SbomDownloadCapacityCache) (buildertypes.BuilderVM, error) {
	if cache == nil || !cache.IsReady() {
		return buildertypes.BuilderVM{}, fmt.Errorf("SBOM download capacity cache is not ready")
	}

	maxDownloadsPerBuilder := param.GetParam(ctx).MaxSbomDownloadsPerBuilder

	builders, err := scan.GetRunningBuildersForScan(ctx)
	if err != nil {
		return buildertypes.BuilderVM{}, fmt.Errorf("failed to query running builders for SBOM download: %w", err)
	}

	for _, b := range builders {
		if cache.tryReserveSlot(b.ID, b.HasBuildAssignment, maxDownloadsPerBuilder) {
			return b.BuilderVM, nil
		}
	}

	return buildertypes.BuilderVM{}, ErrNoBuilderAvailableForSbomDownload
}

// ResolveSbomDownloadBaseDir returns the base SBOM downloads directory for a builder.
// For local builders, uses os.TempDir()/securebuild/sbom-downloads.
// For CMX/static, uses $HOME/sbom-downloads (resolved via GetRemoteHome).
func ResolveSbomDownloadBaseDir(ctx context.Context, vm buildertypes.BuilderVM) (string, error) {
	if vm.Type == "local" {
		return filepath.Join(os.TempDir(), "securebuild", "sbom-downloads"), nil
	}
	homeDir, err := builder.GetRemoteHome(ctx, vm)
	if err != nil {
		return "", fmt.Errorf("failed to get remote home: %w", err)
	}
	return filepath.Join(homeDir, "sbom-downloads"), nil
}

// ResolveSbomDownloadWorkDir returns the work directory for an SBOM download on
// a builder: <baseDir>/<digest>.
func ResolveSbomDownloadWorkDir(ctx context.Context, vm buildertypes.BuilderVM, digest string) (string, error) {
	baseDir, err := ResolveSbomDownloadBaseDir(ctx, vm)
	if err != nil {
		return "", err
	}
	return filepath.Join(baseDir, digest), nil
}

// SbomDownloadDirStatus represents the status of an SBOM download directory on a builder.
type SbomDownloadDirStatus struct {
	WorkDir      string
	Metadata     SbomDownloadMetadata
	ArchStatuses map[string]*ArchSbomDownloadStatus
	AllArchsDone bool
}

// ArchSbomDownloadStatus represents the status of a single architecture's SBOM download.
type ArchSbomDownloadStatus struct {
	Done      bool
	ExitCode  string
	SbomJSON  string
	Stderr    string
}

// ListSbomDownloadDirsOnBuilder connects to a builder and discovers all SBOM
// download directories by listing download.json files.
func ListSbomDownloadDirsOnBuilder(ctx context.Context, vm buildertypes.BuilderVM) ([]SbomDownloadDirStatus, error) {
	baseDir, err := ResolveSbomDownloadBaseDir(ctx, vm)
	if err != nil {
		return nil, err
	}

	runner, err := buildbackend.NewRunner(ctx, vm)
	if err != nil {
		return nil, fmt.Errorf("failed to create runner: %w", err)
	}
	defer runner.Close()

	return ListSbomDownloadDirsWithRunner(ctx, runner, baseDir)
}

// ListSbomDownloadDirsWithRunner lists SBOM download directories using an
// existing runner. This allows the poller to reuse a runner for both listing
// and reading results.
func ListSbomDownloadDirsWithRunner(ctx context.Context, runner buildbackend.Runner, baseDir string) ([]SbomDownloadDirStatus, error) {
	cmd := fmt.Sprintf(`if [ ! -d %q ]; then exit 0; fi
find %q -name download.json 2>/dev/null | sort | while IFS= read -r f; do
  dir=$(dirname "$f")
  echo "@@DL@@|$dir"
  cat "$f"
  echo ""
  echo "@@META_END@@"
  for arch in linux/amd64 linux/arm64; do
    archdir=$(echo "$arch" | tr '/' '_')
    if [ -d "$dir/$archdir" ]; then
      exitFile="$dir/$archdir/output/exit_code"
      if [ -f "$exitFile" ]; then
        echo "@@DONE@@|$arch|$(cat "$exitFile")"
      else
        echo "@@PENDING@@|$arch"
      fi
    fi
  done
  echo "@@DL_END@@"
done`, baseDir, baseDir)

	output, err := runner.RunCommand(ctx, cmd)
	if err != nil {
		return nil, fmt.Errorf("failed to list SBOM download dirs: %w", err)
	}

	return parseSbomDownloadDirListing(output), nil
}

// parseSbomDownloadDirListing parses the output of the SBOM download dir listing command.
func parseSbomDownloadDirListing(output string) []SbomDownloadDirStatus {
	var downloads []SbomDownloadDirStatus
	lines := strings.Split(output, "\n")

	i := 0
	for i < len(lines) {
		line := strings.TrimSpace(lines[i])
		if !strings.HasPrefix(line, "@@DL@@|") {
			i++
			continue
		}

		workDir := strings.TrimPrefix(line, "@@DL@@|")
		i++

		var metadataLines []string
		for i < len(lines) {
			l := strings.TrimSpace(lines[i])
			if l == "@@META_END@@" {
				i++
				break
			}
			metadataLines = append(metadataLines, lines[i])
			i++
		}

		metadataJSON := strings.TrimSpace(strings.Join(metadataLines, "\n"))
		var meta SbomDownloadMetadata
		if metadataJSON != "" {
			if err := json.Unmarshal([]byte(metadataJSON), &meta); err != nil {
				logger.Warn("failed to parse download.json during listing",
					zap.String("workDir", workDir),
					zap.Error(err))
			}
		}

		status := &SbomDownloadDirStatus{
			WorkDir:      workDir,
			Metadata:     meta,
			ArchStatuses: make(map[string]*ArchSbomDownloadStatus),
			AllArchsDone: true,
		}

		hasAnyArch := false
		for i < len(lines) {
			l := strings.TrimSpace(lines[i])
			if l == "@@DL_END@@" {
				i++
				break
			}
			if strings.HasPrefix(l, "@@DONE@@|") {
				hasAnyArch = true
				parts := strings.SplitN(strings.TrimPrefix(l, "@@DONE@@|"), "|", 2)
				if len(parts) == 2 {
					arch := parts[0]
					exitCode := parts[1]
					status.ArchStatuses[arch] = &ArchSbomDownloadStatus{
						Done:     true,
						ExitCode: exitCode,
					}
				}
			} else if strings.HasPrefix(l, "@@PENDING@@|") {
				hasAnyArch = true
				arch := strings.TrimPrefix(l, "@@PENDING@@|")
				status.ArchStatuses[arch] = &ArchSbomDownloadStatus{
					Done: false,
				}
				status.AllArchsDone = false
			}
			i++
		}

		if !hasAnyArch {
			status.AllArchsDone = false
		}

		downloads = append(downloads, *status)
	}

	return downloads
}

// ReportDownloadMetrics sends gauge metrics for the SBOM download backlog
// and running download counts.
//
// The backlog is the count of work_queue rows on the external_image_sbom
// channel that are not yet completed (pending or in-flight). This directly
// reflects what the user can see in the work_queue table.
//
// Running downloads are sourced from the in-memory SbomDownloadCapacityCache,
// which reflects download directories the poller has actually observed on
// builder filesystems.
func ReportDownloadMetrics(ctx context.Context, cache *SbomDownloadCapacityCache) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	var backlog int
	if err := conn.QueryRow(ctx,
		`SELECT COUNT(*) FROM work_queue WHERE channel = 'external_image_sbom' AND completed_at IS NULL`,
	).Scan(&backlog); err != nil {
		logger.Warn("failed to count SBOM download backlog", zap.Error(err))
	} else {
		telemetry.Gauge(telemetry.MetricExternalImageSbomBacklog, float64(backlog), nil)
	}

	var runningCount int
	if cache != nil {
		runningCount = cache.GetTotalActiveDownloadCount()
	}
	telemetry.Gauge(telemetry.MetricExternalImageSbomDownloadsRunning, float64(runningCount), nil)
}

// MetricsReportInterval is how often SBOM download backlog and running download
// gauges are sent. Matches the scan scheduler's interval.
const MetricsReportInterval = 1 * time.Minute

// StartMetricsReporter runs a periodic loop that reports SBOM download backlog,
// running download counts, and download capacity gauges. It also dumps the
// in-memory SBOM download capacity cache to a temp file for debugging
// visibility.
func StartMetricsReporter(ctx context.Context, cache *SbomDownloadCapacityCache) {
	logger.Info("Starting SBOM download metrics reporter")

	go func() {
		ticker := time.NewTicker(MetricsReportInterval)
		defer ticker.Stop()
		// Report immediately on startup so metrics are available without
		// waiting for the first tick.
		reportMetrics(ctx, cache)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				reportMetrics(ctx, cache)
			}
		}
	}()
}

func reportMetrics(ctx context.Context, cache *SbomDownloadCapacityCache) {
	ReportDownloadMetrics(ctx, cache)
	if cache != nil {
		cache.ReportDownloadCapacityMetrics(ctx)
		if err := cache.DumpToFile(); err != nil {
			logger.Warn("failed to dump SBOM download capacity cache to file", zap.Error(err))
		}
	}
}
