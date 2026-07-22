package scan

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
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
	"github.com/securebuildhq/securebuild/pkg/telemetry"
	"go.uber.org/zap"
)

const (
	// MaxScanRetryAttempts is the maximum number of times a failed scan is retried
	// before being marked as permanently failed.
	MaxScanRetryAttempts = 3

	// ScanTimeout is the maximum duration a grype scan can run before it is
	// considered stuck and killed.
	ScanTimeout = 10 * time.Minute

	// ScanPollerInterval is how often the scan status poller checks builders
	// for completed scans.
	ScanPollerInterval = 10 * time.Second

	// ScanStartupGracePeriod is the grace period after a scan is dispatched
	// before the poller starts checking for exit codes. This allows grype
	// time to start up and begin processing.
	ScanStartupGracePeriod = 60 * time.Second
)

// ErrNoBuilderAvailable is returned by SelectBuilderForScan when all running
// builders are at capacity. Callers should check for this with errors.Is and
// handle it gracefully (e.g. return nil from the handler so the scheduler
// re-enqueues on the next cycle).
var ErrNoBuilderAvailable = errors.New("no builder available for scan")

// ScanMetadata is the JSON metadata file written to each scan directory on the
// builder. It allows the poller to discover scans and know which DB rows to update.
type ScanMetadata struct {
	Digest     string    `json:"digest"`
	CreatedAt  time.Time `json:"created_at"`
	RetryCount int       `json:"retry_count"`
}

// ScanDirInfo tracks a single active scan directory on a builder.
type ScanDirInfo struct {
	Digest    string
	WorkDir   string
	CreatedAt time.Time
}

// ScanCapacityCache tracks active scans per builder, maintained from filesystem
// scans. There is only one worker instance, so no cross-instance coordination
// is needed.
type ScanCapacityCache struct {
	mu     sync.RWMutex
	counts map[string]int           // machineID → count of active scan directories
	scans  map[string][]ScanDirInfo // machineID → list of active scan dirs
	ready  bool
}

// NewScanCapacityCache creates a new empty ScanCapacityCache.
func NewScanCapacityCache() *ScanCapacityCache {
	return &ScanCapacityCache{
		counts: make(map[string]int),
		scans:  make(map[string][]ScanDirInfo),
	}
}

// IsReady returns true if the cache has been initialized from the builder
// filesystems. Handlers check this as a safety net before dispatching scans.
func (c *ScanCapacityCache) IsReady() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.ready
}

// setReady marks the cache as initialized.
func (c *ScanCapacityCache) setReady(ready bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.ready = ready
}

// SetBuilderScans replaces all scan entries for a builder with the given
// list. The count is set to the length of the list. Called by the poller
// every 10s to resync the cache with what's actually on the builder
// filesystem, eliminating leaked placeholders and stale entries.
func (c *ScanCapacityCache) SetBuilderScans(machineID string, scans []ScanDirInfo) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(scans) == 0 {
		delete(c.counts, machineID)
		delete(c.scans, machineID)
		return
	}
	c.scans[machineID] = scans
	c.counts[machineID] = len(scans)
}

// RemoveScan removes a scan for a builder by digest. Called by the poller
// when a scan completes.
func (c *ScanCapacityCache) RemoveScan(machineID, digest string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	scans := c.scans[machineID]
	for i, s := range scans {
		if s.Digest == digest {
			c.scans[machineID] = append(scans[:i], scans[i+1:]...)
			c.counts[machineID]--
			if c.counts[machineID] <= 0 {
				delete(c.counts, machineID)
				delete(c.scans, machineID)
			}
			return
		}
	}
}

// RemoveBuilder removes all scans for a builder (e.g. when the builder is deleted).
func (c *ScanCapacityCache) RemoveBuilder(machineID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.counts, machineID)
	delete(c.scans, machineID)
}

// GetBuilderScanCount returns the number of active scans for a builder.
func (c *ScanCapacityCache) GetBuilderScanCount(machineID string) int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.counts[machineID]
}

// GetScansForBuilder returns the list of active scan dirs for a builder.
func (c *ScanCapacityCache) GetScansForBuilder(machineID string) []ScanDirInfo {
	c.mu.RLock()
	defer c.mu.RUnlock()
	result := make([]ScanDirInfo, len(c.scans[machineID]))
	copy(result, c.scans[machineID])
	return result
}

// GetTotalScanCount returns the total number of active scans across all builders.
// Used by the scheduler for backpressure.
func (c *ScanCapacityCache) GetTotalScanCount() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	total := 0
	for _, count := range c.counts {
		total += count
	}
	return total
}

// GetTotalActiveScanCount returns the total number of active scan directories
// across all builders, based on the scans map (not the counts map). This is
// more accurate than GetTotalScanCount because counts can be temporarily
// inflated by tryReserveSlot reservations between poller resync cycles, while
// scans only reflects scan directories the poller has actually observed on
// builder filesystems.
func (c *ScanCapacityCache) GetTotalActiveScanCount() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	total := 0
	for _, scans := range c.scans {
		total += len(scans)
	}
	return total
}

// GetBuilderIDs returns the machine IDs of all builders that have active scans.
func (c *ScanCapacityCache) GetBuilderIDs() []string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	ids := make([]string, 0, len(c.scans))
	for id := range c.scans {
		ids = append(ids, id)
	}
	return ids
}

// tryReserveSlot atomically checks whether a builder has capacity for one
// more scan and, if so, increments the count under the write lock. Returns
// true if the slot was reserved. The poller resyncs the cache every 10s, so
// any leaked reservations (dispatch failure before scan files are written)
// are automatically cleaned up on the next poll cycle.
func (c *ScanCapacityCache) tryReserveSlot(machineID string, hasBuildAssignment bool, maxScansPerBuilder int) bool {
	c.mu.Lock()
	defer c.mu.Unlock()

	current := c.counts[machineID]

	if hasBuildAssignment {
		if current >= 1 {
			return false
		}
	} else {
		if current >= maxScansPerBuilder {
			return false
		}
	}

	c.counts[machineID] = current + 1
	return true
}

// ReleaseScanSlot decrements the capacity count for a builder. Used when a
// reservation was made but the scan dispatch failed before scan files were
// written. The poller will correct the count on the next resync anyway, but
// this avoids temporarily over-counting.
func (c *ScanCapacityCache) ReleaseScanSlot(machineID string) {
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

// ReportCapacityMetrics sends gauge metrics for total and used scan capacity.
//
// Total capacity = number of running builders × MaxScansPerBuilder.
// Used capacity = sum of active scan counts across all builders (from cache).
//
// Gauges sent:
//   - securebuild.external_image.scan.capacity.total
//   - securebuild.external_image.scan.capacity.used
//   - securebuild.external_image.scan.capacity.used (tag: machine_id=<id>) per builder
func (c *ScanCapacityCache) ReportCapacityMetrics(ctx context.Context) {
	maxScansPerBuilder := param.GetParam(ctx).MaxScansPerBuilder

	builders, err := getRunningBuildersForScan(ctx)
	if err != nil {
		logger.Warn("failed to query running builders for capacity metrics",
			zap.Error(err))
		return
	}

	totalCapacity := len(builders) * maxScansPerBuilder
	telemetry.Gauge(telemetry.MetricExternalImageScanCapacityTotal, float64(totalCapacity), nil)

	used := c.GetTotalScanCount()
	telemetry.Gauge(telemetry.MetricExternalImageScanCapacityUsed, float64(used), nil)

	for _, b := range builders {
		builderUsed := c.GetBuilderScanCount(b.ID)
		telemetry.Gauge(telemetry.MetricExternalImageScanCapacityUsed, float64(builderUsed),
			[]string{"machine_id:" + b.ID})
	}
}

// DumpToFile writes the current cache state to a JSON file for debugging.
// The file is written to os.TempDir()/securebuild-scan-capacity-cache.json
// and is overwritten on each call. This provides visibility into the
// in-memory capacity data that is not stored in the database.
func (c *ScanCapacityCache) DumpToFile() error {
	c.mu.RLock()
	snapshot := struct {
		Timestamp time.Time                `json:"timestamp"`
		Ready     bool                     `json:"ready"`
		Counts    map[string]int           `json:"counts"`
		Scans     map[string][]ScanDirInfo `json:"scans"`
	}{
		Timestamp: time.Now().UTC(),
		Ready:     c.ready,
		Counts:    make(map[string]int, len(c.counts)),
		Scans:     make(map[string][]ScanDirInfo, len(c.scans)),
	}
	for k, v := range c.counts {
		snapshot.Counts[k] = v
	}
	for k, v := range c.scans {
		snapshot.Scans[k] = make([]ScanDirInfo, len(v))
		copy(snapshot.Scans[k], v)
	}
	c.mu.RUnlock()

	data, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal cache dump: %w", err)
	}

	path := filepath.Join(os.TempDir(), "securebuild-scan-capacity-cache.json")
	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("failed to write cache dump to %s: %w", path, err)
	}

	return nil
}

// InitScanCapacityCache performs a one-time full scan of all running builders
// to discover in-flight scan directories and populate the in-memory cache.
// This enables self-healing after a worker restart: grype processes survive
// the restart (they run via nohup), and the poller resumes collecting results.
func InitScanCapacityCache(ctx context.Context) (*ScanCapacityCache, error) {
	cache := NewScanCapacityCache()

	builders, err := getRunningBuildersForScan(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to query running builders for scan cache init: %w", err)
	}

	for _, b := range builders {
		scans, err := ListScanDirsOnBuilder(ctx, b.BuilderVM)
		if err != nil {
			logger.Warn("failed to list scan dirs on builder during init, skipping",
				zap.String("machineID", b.BuilderVM.ID),
				zap.Error(err))
			continue
		}

		activeScans := make([]ScanDirInfo, 0)
		for _, s := range scans {
			if s.AllArchsDone {
				continue
			}
			activeScans = append(activeScans, ScanDirInfo{
				Digest:    s.Metadata.Digest,
				WorkDir:   s.WorkDir,
				CreatedAt: s.Metadata.CreatedAt,
			})
		}
		cache.SetBuilderScans(b.BuilderVM.ID, activeScans)
	}

	cache.setReady(true)
	logger.Info("scan capacity cache initialized",
		zap.Int("builders", len(builders)),
		zap.Int("activeScans", cache.GetTotalScanCount()))

	return cache, nil
}

// builderForScan is a running builder with its build assignment status.
type builderForScan struct {
	buildertypes.BuilderVM
	HasBuildAssignment bool
}

// SelectBuilderForScan finds a builder VM that can accept a new scan and
// atomically reserves a capacity slot. Priority: idle builders first (no
// build assignments), then busy builders.
// Capacity rules:
//   - Idle builders (no machine_assignment rows): up to maxScansPerBuilder concurrent scans
//   - Busy builders (has machine_assignment rows): at most 1 concurrent scan
//
// The reservation is atomic: the capacity count is incremented under the
// cache write lock before returning, preventing concurrent handlers from
// all selecting the same builder and exceeding MaxScansPerBuilder.
// The poller resyncs the cache from builder filesystems every 10s, so any
// leaked reservations (dispatch failure before scan files are written) are
// automatically corrected on the next poll cycle.
func SelectBuilderForScan(ctx context.Context, cache *ScanCapacityCache) (buildertypes.BuilderVM, error) {
	if cache == nil || !cache.IsReady() {
		return buildertypes.BuilderVM{}, fmt.Errorf("scan capacity cache is not ready")
	}

	maxScansPerBuilder := param.GetParam(ctx).MaxScansPerBuilder

	builders, err := getRunningBuildersForScan(ctx)
	if err != nil {
		return buildertypes.BuilderVM{}, fmt.Errorf("failed to query running builders for scan: %w", err)
	}

	for _, b := range builders {
		if cache.tryReserveSlot(b.ID, b.HasBuildAssignment, maxScansPerBuilder) {
			return b.BuilderVM, nil
		}
	}

	return buildertypes.BuilderVM{}, ErrNoBuilderAvailable
}

// GetRunningBuilders returns all running builder VMs from the machine pool,
// ordered by idle-first (no build assignments first).
func GetRunningBuilders(ctx context.Context) ([]buildertypes.BuilderVM, error) {
	builders, err := getRunningBuildersForScan(ctx)
	if err != nil {
		return nil, err
	}
	result := make([]buildertypes.BuilderVM, 0, len(builders))
	for _, b := range builders {
		result = append(result, b.BuilderVM)
	}
	return result, nil
}

// getRunningBuildersForScan queries all running builders, ordered by idle-first
// (no build assignments first), then by oldest builder first.
func getRunningBuildersForScan(ctx context.Context) ([]builderForScan, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT mp.id, mp.created_at, mp.expires_at, mp.private_key, mp.username,
		       mp.status, mp.ip_address, mp.port, mp.architecture,
		       mp.last_uptime, mp.last_uptime_updated_at, mp.cleanup_locked_at,
		       mp.is_on_demand, mp.type,
		       EXISTS (SELECT 1 FROM machine_assignment ma WHERE ma.machine_id = mp.id) AS has_build_assignment
		FROM machine_pool mp
		WHERE mp.status = 'running'
		  AND mp.cleanup_locked_at IS NULL
		  AND mp.is_on_demand = false
		ORDER BY
		  CASE WHEN EXISTS (
		    SELECT 1 FROM machine_assignment ma WHERE ma.machine_id = mp.id
		  ) THEN 1 ELSE 0 END,
		  mp.created_at ASC
	`

	rows, err := conn.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query running builders: %w", err)
	}
	defer rows.Close()

	var result []builderForScan
	for rows.Next() {
		var b builderForScan
		var ipAddress sql.NullString
		var port sql.NullInt64
		var architecture sql.NullString
		var lastUptime sql.NullString
		var lastUptimeUpdatedAt sql.NullTime
		var cleanupLockedAt sql.NullTime
		var expiresAt sql.NullTime
		var hasBuildAssignment bool

		err := rows.Scan(
			&b.ID, &b.CreatedAt, &expiresAt, &b.PrivateKey, &b.Username,
			&b.Status, &ipAddress, &port, &architecture,
			&lastUptime, &lastUptimeUpdatedAt, &cleanupLockedAt,
			&b.IsOnDemand, &b.Type,
			&hasBuildAssignment,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan builder row: %w", err)
		}

		if ipAddress.Valid {
			b.IPAddress = ipAddress.String
		}
		if port.Valid {
			b.Port = int(port.Int64)
		}
		if architecture.Valid {
			b.Architecture = architecture.String
		}
		if lastUptime.Valid {
			b.LastUptime = lastUptime.String
		}
		if lastUptimeUpdatedAt.Valid {
			b.LastUptimeUpdatedAt = &lastUptimeUpdatedAt.Time
		}
		if cleanupLockedAt.Valid {
			b.CleanupLockedAt = &cleanupLockedAt.Time
		}
		if expiresAt.Valid {
			b.ExpiresAt = &expiresAt.Time
		}
		b.HasBuildAssignment = hasBuildAssignment

		result = append(result, b)
	}

	return result, nil
}

// ScanDirStatus represents the status of a scan directory on a builder.
type ScanDirStatus struct {
	WorkDir      string
	Metadata     ScanMetadata
	ArchStatuses map[string]*ArchScanStatus
	AllArchsDone bool
}

// ArchScanStatus represents the status of a single architecture's scan.
type ArchScanStatus struct {
	Done      bool
	ExitCode  string
	GrypeJSON string
	Stderr    string
}

// ResolveScanBaseDir returns the base scans directory for a builder.
// For local builders, uses os.TempDir()/securebuild/scans.
// For CMX/static, uses $HOME/scans (resolved via GetRemoteHome).
func ResolveScanBaseDir(ctx context.Context, vm buildertypes.BuilderVM) (string, error) {
	if vm.Type == "local" {
		return filepath.Join(os.TempDir(), "securebuild", "scans"), nil
	}
	homeDir, err := builder.GetRemoteHome(ctx, vm)
	if err != nil {
		return "", fmt.Errorf("failed to get remote home: %w", err)
	}
	return filepath.Join(homeDir, "scans"), nil
}

// ResolveScanWorkDir returns the work directory for a scan on a builder.
// For local builders, uses os.TempDir()/securebuild/scans/<digest>.
// For CMX/static, uses $HOME/scans/<digest> (resolved via GetRemoteHome).
func ResolveScanWorkDir(ctx context.Context, vm buildertypes.BuilderVM, digest string) (string, error) {
	baseDir, err := ResolveScanBaseDir(ctx, vm)
	if err != nil {
		return "", err
	}
	return filepath.Join(baseDir, digest), nil
}

// ListScanDirsOnBuilder connects to a builder and discovers all scan directories
// by listing scan.json files. For each scan, it checks whether each architecture's
// grype process has completed (exit_code file exists). Completed scans are not
// counted toward capacity (the poller will collect them on the next cycle).
func ListScanDirsOnBuilder(ctx context.Context, vm buildertypes.BuilderVM) ([]ScanDirStatus, error) {
	baseDir, err := ResolveScanBaseDir(ctx, vm)
	if err != nil {
		return nil, err
	}

	runner, err := buildbackend.NewRunner(ctx, vm)
	if err != nil {
		return nil, fmt.Errorf("failed to create runner: %w", err)
	}
	defer runner.Close()

	return ListScanDirsWithRunner(ctx, runner, baseDir)
}

// ListScanDirsWithRunner lists scan directories using an existing runner.
// This allows the poller to reuse a runner for both listing and reading results.
func ListScanDirsWithRunner(ctx context.Context, runner buildbackend.Runner, baseDir string) ([]ScanDirStatus, error) {
	cmd := fmt.Sprintf(`if [ ! -d %q ]; then exit 0; fi
find %q -name scan.json 2>/dev/null | sort | while IFS= read -r f; do
  dir=$(dirname "$f")
  echo "@@SCAN@@|$dir"
  cat "$f"
  echo ""
  echo "@@META_END@@"
  for arch in x86_64 aarch64; do
    if [ -d "$dir/$arch" ]; then
      exitFile="$dir/$arch/output/exit_code"
      if [ -f "$exitFile" ]; then
        echo "@@DONE@@|$arch|$(cat "$exitFile")"
      else
        echo "@@PENDING@@|$arch"
      fi
    fi
  done
  echo "@@SCAN_END@@"
done`, baseDir, baseDir)

	output, err := runner.RunCommand(ctx, cmd)
	if err != nil {
		return nil, fmt.Errorf("failed to list scan dirs: %w", err)
	}

	return parseScanDirListing(output), nil
}

// parseScanDirListing parses the output of the scan dir listing command.
func parseScanDirListing(output string) []ScanDirStatus {
	var scans []ScanDirStatus
	lines := strings.Split(output, "\n")

	i := 0
	for i < len(lines) {
		line := strings.TrimSpace(lines[i])
		if !strings.HasPrefix(line, "@@SCAN@@|") {
			i++
			continue
		}

		workDir := strings.TrimPrefix(line, "@@SCAN@@|")
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
		var meta ScanMetadata
		if metadataJSON != "" {
			if err := json.Unmarshal([]byte(metadataJSON), &meta); err != nil {
				logger.Warn("failed to parse scan.json during listing",
					zap.String("workDir", workDir),
					zap.Error(err))
			}
		}

		status := &ScanDirStatus{
			WorkDir:      workDir,
			Metadata:     meta,
			ArchStatuses: make(map[string]*ArchScanStatus),
			AllArchsDone: true,
		}

		hasAnyArch := false
		for i < len(lines) {
			l := strings.TrimSpace(lines[i])
			if l == "@@SCAN_END@@" {
				i++
				break
			}
			if strings.HasPrefix(l, "@@DONE@@|") {
				hasAnyArch = true
				parts := strings.SplitN(strings.TrimPrefix(l, "@@DONE@@|"), "|", 2)
				if len(parts) == 2 {
					arch := parts[0]
					exitCode := parts[1]
					status.ArchStatuses[arch] = &ArchScanStatus{
						Done:     true,
						ExitCode: exitCode,
					}
				}
			} else if strings.HasPrefix(l, "@@PENDING@@|") {
				hasAnyArch = true
				arch := strings.TrimPrefix(l, "@@PENDING@@|")
				status.ArchStatuses[arch] = &ArchScanStatus{
					Done: false,
				}
				status.AllArchsDone = false
			}
			i++
		}

		if !hasAnyArch {
			status.AllArchsDone = false
		}

		scans = append(scans, *status)
	}

	return scans
}
