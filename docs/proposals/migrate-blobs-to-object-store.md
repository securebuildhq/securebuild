# Proposal: Migrate Large Text Columns to Object Storage

## Problem

Three `text` columns consume ~1.25 TB of PostgreSQL storage, stored almost entirely in TOAST tables:

| Table | Column | Avg size | Est. total | TOAST table |
|---|---|---|---|---|
| `external_image_scan` | `raw_result` | 972 KB | ~400 GB | `pg_toast_564603` (785 GB total) |
| `external_image_scan` | `parsed_results_details` | 130 KB | ~50 GB | (same TOAST table) |
| `external_image_sbom` | `sbom` | 1.18 MB | ~448 GB | `pg_toast_564596` (448 GB total) |

These are JSON blobs (grype scan output, parsed vulnerability details, and CycloneDX/SBOM JSON) that are written once and read back on-demand via the API. They are never queried with SQL predicates.

## Goal

Move these three columns to S3-compatible object storage (Cloudflare R2 via existing `pkg/storage` package), storing no pointer in PostgreSQL — the object key is derived deterministically from the table's primary key. This must be:

- **Zero-downtime** — no service interruption during migration
- **Fully backwards-compatible** — API responses remain identical before, during, and after migration
- **Externally callable** — a public Go function that a standalone CLI tool can invoke to perform the one-time bulk data copy

## Design Overview

### Key insight: no object key columns needed

Both tables have a composite primary key `(digest, arch)`. The object key is derived deterministically from these columns — no pointer column is needed in the database:

```
external-image-scan/{digest}/{arch}/raw_result.json
external-image-scan/{digest}/{arch}/parsed_results_details.json
external-image-sbom/{digest}/{arch}/sbom.json
```

Given any row's `(digest, arch)`, the object key can be computed without any DB read. This eliminates:
- Schema changes to add object key columns
- DB UPDATEs during bulk migration (just read from DB, write to S3)
- "Is this row migrated?" tracking — reads always try S3 first, fall back to DB

### Migration phases

```
Phase 1: Dual-write (S3 + DB)
         (new code deployed, old columns still populated)
              │
Phase 2: Bulk copy existing data from DB → object store
         (CLI tool uses public Go function, no DB writes needed)
              │
Phase 3: Switch reads to S3 only (still dual-write)
         (reads come from S3, writes still go to both S3 and DB)
              │
Phase 4: Stop writing to DB columns + drop them
         (point of no return — S3 is the sole source of truth)
```

### Key design principles

1. **Dual-write with mandatory S3**: New writes upload to S3 first (fail on error), then write to DB (fail on error, leaving the S3 object in place). Both writes must succeed. This guarantees that once Phase 2 bulk copy completes, every row — old or new — has data in S3. No backfill needed.

2. **Read cutover in Phase 3, write cutover in Phase 4**: Phase 3 switches reads to S3 only (no DB fallback) while still dual-writing to both S3 and DB. This tests S3 reads in production while keeping DB columns as a rollback safety net. Phase 4 is the point of no return: stop writing to DB columns and drop them.

3. **Deterministic keys**: Object keys are derived from `(digest, arch)` — no DB column needed to store the key. The bulk copy is idempotent because S3 `PutObject` overwrites if the key exists.

---

## Phase 1: Dual-Write (No Schema Changes)

### Object key format

```
{digest}/{arch}/raw_result.json
{digest}/{arch}/parsed_results_details.json
{digest}/{arch}/sbom.json
```

The `sha256:` algorithm prefix is stripped from the digest, so `sha256:ab3f...` becomes `ab3f.../x86_64/raw_result.json`. The digest is a random hex hash, so it naturally distributes objects evenly across S3/R2 partitions without any artificial shard prefix.

Example keys:
```
ab3f9e.../x86_64/raw_result.json
ab3f9e.../x86_64/parsed_results_details.json
c19d2a.../aarch64/sbom.json
```

No schema changes are needed. The keys are computed from the existing primary key columns.

### Bucket configuration

The blob store reuses the existing R2 credentials (`R2AccessKey`, `R2SecretKey`, `R2Endpoint`, `R2Region`) but uses a **separate bucket** from `R2BucketName` (which stores APKs). A new param `R2ImageScansBucketName` will be added to `pkg/param/param.go`:

```go
R2ImageScansBucketName string `yaml:"r2_image_scans_bucket_name"`
```

This keeps external image blobs isolated from APK storage, with independent lifecycle policies, retention, and cost tracking. The `NewR2Client` call in `newBlobStore` passes this bucket name instead of `p.R2BucketName`.

### New file: `pkg/externalimage/blobstore.go`

A thin layer over `pkg/storage.R2Client` that handles upload/download of the three blob types:

```go
package externalimage

import (
    "context"
    "fmt"
    "strings"

    "github.com/securebuildhq/securebuild/pkg/param"
    "github.com/securebuildhq/securebuild/pkg/storage"
)

// stripDigestAlgo removes the algorithm prefix from a digest string.
// "sha256:ab3f..." → "ab3f..."
func stripDigestAlgo(digest string) string {
    if idx := strings.Index(digest, ":"); idx != -1 {
        return digest[idx+1:]
    }
    return digest
}

// blobStore wraps an R2Client for external image blob storage.
type blobStore struct {
    client *storage.R2Client
}

func newBlobStore(ctx context.Context) (*blobStore, error) {
    p := param.GetParam(ctx)
    bucket := p.R2ImageScansBucketName
    client, err := storage.NewR2Client(ctx, bucket)
    if err != nil {
        return nil, fmt.Errorf("failed to create blob store client: %w", err)
    }
    return &blobStore{client: client}, nil
}

// --- Key generation (deterministic from primary key) ---

func rawResultKey(digest, arch string) string {
    return fmt.Sprintf("%s/%s/raw_result.json", stripDigestAlgo(digest), arch)
}

func parsedResultsDetailsKey(digest, arch string) string {
    return fmt.Sprintf("%s/%s/parsed_results_details.json", stripDigestAlgo(digest), arch)
}

func sbomKey(digest, arch string) string {
    return fmt.Sprintf("%s/%s/sbom.json", stripDigestAlgo(digest), arch)
}

// --- Upload ---

func (s *blobStore) putRawResult(ctx context.Context, digest, arch, data string) error {
    return s.client.PutObject(ctx, rawResultKey(digest, arch), strings.NewReader(data))
}

func (s *blobStore) putParsedResultsDetails(ctx context.Context, digest, arch, data string) error {
    return s.client.PutObject(ctx, parsedResultsDetailsKey(digest, arch), strings.NewReader(data))
}

func (s *blobStore) putSBOM(ctx context.Context, digest, arch, data string) error {
    return s.client.PutObject(ctx, sbomKey(digest, arch), strings.NewReader(data))
}

// --- Download ---

func (s *blobStore) getRawResult(ctx context.Context, digest, arch string) (string, error) {
    data, err := s.client.GetObjectData(ctx, rawResultKey(digest, arch))
    if err != nil {
        return "", err
    }
    return string(data), nil
}

func (s *blobStore) getParsedResultsDetails(ctx context.Context, digest, arch string) (string, error) {
    data, err := s.client.GetObjectData(ctx, parsedResultsDetailsKey(digest, arch))
    if err != nil {
        return "", err
    }
    return string(data), nil
}

func (s *blobStore) getSBOM(ctx context.Context, digest, arch string) (string, error) {
    data, err := s.client.GetObjectData(ctx, sbomKey(digest, arch))
    if err != nil {
        return "", err
    }
    return string(data), nil
}
```

### Write path changes (Go)

#### Modify `SetExternalImageScanStatus` (`pkg/externalimage/externalimage.go:313`)

Upload blobs to S3 first — fail the scan if the upload fails. Then write to DB — fail if DB write fails (S3 object remains, will be overwritten on retry). Both must succeed:

```go
func SetExternalImageScanStatus(ctx context.Context, params SetExternalImageScanStatusParams) error {
    conn := persistence.MustGetPooledPostgresSession(ctx)
    defer conn.Release()

    now := time.Now()

    var scanStatusMessage *string
    if params.ScanStatusMessage != "" {
        scanStatusMessage = &params.ScanStatusMessage
    }

    // Step 1: Upload blobs to object store (mandatory — fail on error)
    if params.Status == ScanStatusSucceeded && params.RawResult != "" {
        store, err := newBlobStore(ctx)
        if err != nil {
            return fmt.Errorf("failed to create blob store: %w", err)
        }
        if err := store.putRawResult(ctx, params.Digest, params.Arch, params.RawResult); err != nil {
            return fmt.Errorf("failed to upload raw_result to object store: %w", err)
        }
        if params.ParsedResultsDetails != "" {
            if err := store.putParsedResultsDetails(ctx, params.Digest, params.Arch, params.ParsedResultsDetails); err != nil {
                return fmt.Errorf("failed to upload parsed_results_details to object store: %w", err)
            }
        }
    }

    // Step 2: DB write — fail on error (S3 object stays, will be overwritten on retry)
    query := `
        INSERT INTO external_image_scan (digest, arch, parsed_results, parsed_results_details, raw_result, created_at, status, scan_status_message, updated_at, scan_completed_at, scan_attempted_at, scan_status_updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $6, $6, $6, $6)
        ON CONFLICT (digest, arch) DO UPDATE
        SET parsed_results = $3,
            parsed_results_details = $4,
            raw_result = $5,
            status = $7,
            scan_status_message = $8,
            updated_at = $6,
            scan_completed_at = $6,
            scan_status_updated_at = $6
    `

    _, err := conn.Exec(ctx, query,
        params.Digest,
        params.Arch,
        params.ParsedResults,
        params.ParsedResultsDetails,
        params.RawResult,
        now,
        string(params.Status),
        scanStatusMessage,
    )
    if err != nil {
        return fmt.Errorf("failed to set scan status for digest %s, arch %s: %w", params.Digest, params.Arch, err)
    }

    return nil
}
```

**Both writes must succeed.** S3 is written first; if it fails, the scan fails and the caller will retry. If S3 succeeds but DB fails, the S3 object remains in place — a retry will overwrite it (same key) and then write the DB row. This guarantees that after Phase 2 bulk copy, every row has data in S3 with no gaps to backfill.

#### Modify `SetExternalImageSBOM` (`pkg/externalimage/externalimage.go:455`)

Same dual-write pattern — S3 first (mandatory), then DB:

```go
func SetExternalImageSBOM(ctx context.Context, digest string, sbom string, source string, arch string, imageSizeBytes int64, imageDigest string) error {
    conn := persistence.MustGetPooledPostgresSession(ctx)
    defer conn.Release()

    // Step 1: Upload SBOM to object store (mandatory — fail on error)
    if sbom != "" {
        store, err := newBlobStore(ctx)
        if err != nil {
            return fmt.Errorf("failed to create blob store: %w", err)
        }
        if err := store.putSBOM(ctx, digest, arch, sbom); err != nil {
            return fmt.Errorf("failed to upload sbom to object store: %w", err)
        }
    }

    // Step 2: DB write — fail on error (S3 object stays, will be overwritten on retry)
    query := `
        insert into external_image_sbom (digest, arch, sbom, source, image_size_bytes, image_digest, created_at)
        values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (digest, arch) do update
        set sbom = $3, source = $4, image_size_bytes = $5, image_digest = $6, created_at = $7
    `

    _, err := conn.Exec(ctx, query, digest, arch, sbom, source, imageSizeBytes, imageDigest, time.Now())
    if err != nil {
        return fmt.Errorf("failed to insert/update external image SBOM for digest %s, arch %s: %w", digest, arch, err)
    }

    return nil
}
```

---

## Phase 2: Bulk Data Copy (Public Go Function + CLI)

### Public Go function

Add to `pkg/externalimage/migrate_blobs.go`:

```go
package externalimage

import (
    "context"
    "fmt"
    "time"

    "github.com/securebuildhq/securebuild/pkg/logger"
    "github.com/securebuildhq/securebuild/pkg/persistence"
)

// MigrateBlobsConfig controls the bulk migration of large text columns
// from PostgreSQL to object storage.
type MigrateBlobsConfig struct {
    BatchSize    int           // rows per batch (default: 100)
    DryRun       bool          // if true, log what would be done but don't upload
    SkipExisting bool          // if true, skip objects that already exist in S3 (HEAD check)
    Delay        time.Duration // delay between batches (default: 0)
}

// MigrateBlobsResult summarizes a migration run.
type MigrateBlobsResult struct {
    ScansMigrated int // external_image_scan rows processed
    ScansSkipped  int // external_image_scan rows skipped (already in S3)
    ScansFailed   int // external_image_scan rows that failed
    SBOMsMigrated int // external_image_sbom rows processed
    SBOMsSkipped  int // external_image_sbom rows skipped (already in S3)
    SBOMsFailed   int // external_image_sbom rows that failed
}

// MigrateBlobsToStorage copies large text columns from PostgreSQL to the
// S3-compatible object store. Object keys are derived deterministically from
// each row's primary key (digest, arch), so no object key columns are needed
// in the database and no DB writes are performed during migration.
//
// This function is designed to be called by an external CLI tool for a
// one-time bulk migration. It is safe to run multiple times (idempotent):
// when SkipExisting is true, a HEAD request checks if the object already
// exists before uploading.
//
// The function processes rows in batches using server-side cursors to avoid
// loading the entire ~1.25 TB into memory. Context cancellation is respected
// between batches.
func MigrateBlobsToStorage(ctx context.Context, cfg MigrateBlobsConfig) (*MigrateBlobsResult, error) {
    if cfg.BatchSize <= 0 {
        cfg.BatchSize = 100
    }

    result := &MigrateBlobsResult{}

    store, err := newBlobStore(ctx)
    if err != nil {
        return nil, fmt.Errorf("failed to create blob store: %w", err)
    }

    // Migrate external_image_scan: raw_result + parsed_results_details
    if err := migrateScanBlobs(ctx, store, cfg, result); err != nil {
        return result, fmt.Errorf("scan blob migration failed: %w", err)
    }

    // Migrate external_image_sbom: sbom
    if err := migrateSBOMBlobs(ctx, store, cfg, result); err != nil {
        return result, fmt.Errorf("sbom blob migration failed: %w", err)
    }

    return result, nil
}

// objectExists checks if an object already exists in the object store.
// Returns true if the object exists, false if it doesn't, or on error
// (treat errors as "doesn't exist" to allow re-upload).
func (s *blobStore) objectExists(ctx context.Context, key string) bool {
    _, err := s.client.GetObject(ctx, key)
    return err == nil
}

func migrateScanBlobs(ctx context.Context, store *blobStore, cfg MigrateBlobsConfig, result *MigrateBlobsResult) error {
    conn := persistence.MustGetPooledPostgresSession(ctx)
    defer conn.Release()

    // Use a server-side cursor for memory-efficient iteration over ~410K rows
    // with potentially 1 MB+ payloads each.
    query := `
        DECLARE scan_cursor CURSOR FOR
        SELECT digest, arch, raw_result, parsed_results_details
        FROM external_image_scan
        WHERE raw_result IS NOT NULL OR parsed_results_details IS NOT NULL
    `

    if _, err := conn.Exec(ctx, query); err != nil {
        return fmt.Errorf("failed to declare cursor: %w", err)
    }
    defer conn.Exec(ctx, "CLOSE scan_cursor")

    batchNum := 0
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        default:
        }

        rows, err := conn.Query(ctx, fmt.Sprintf("FETCH %d FROM scan_cursor", cfg.BatchSize))
        if err != nil {
            return fmt.Errorf("failed to fetch batch: %w", err)
        }

        batchCount := 0
        for rows.Next() {
            batchCount++
            var digest, arch string
            var rawResult, parsedDetails *string
            if err := rows.Scan(&digest, &arch, &rawResult, &parsedDetails); err != nil {
                result.ScansFailed++
                logger.Errorf("failed to scan row: %v", err)
                continue
            }

            // Upload raw_result
            if rawResult != nil && *rawResult != "" {
                rawKey := rawResultKey(digest, arch)

                if cfg.SkipExisting && store.objectExists(ctx, rawKey) {
                    result.ScansSkipped++
                } else if cfg.DryRun {
                    logger.Infof("[dry-run] would upload raw_result for %s/%s (%d bytes)", digest, arch, len(*rawResult))
                } else {
                    if err := store.putRawResult(ctx, digest, arch, *rawResult); err != nil {
                        result.ScansFailed++
                        logger.Errorf("failed to upload raw_result for %s/%s: %v", digest, arch, err)
                    } else {
                        result.ScansMigrated++
                    }
                }
            }

            // Upload parsed_results_details
            if parsedDetails != nil && *parsedDetails != "" {
                detailsKey := parsedResultsDetailsKey(digest, arch)

                if cfg.SkipExisting && store.objectExists(ctx, detailsKey) {
                    // Already counted as skipped or migrated above; don't double-count
                } else if cfg.DryRun {
                    logger.Infof("[dry-run] would upload parsed_results_details for %s/%s (%d bytes)", digest, arch, len(*parsedDetails))
                } else {
                    if err := store.putParsedResultsDetails(ctx, digest, arch, *parsedDetails); err != nil {
                        result.ScansFailed++
                        logger.Errorf("failed to upload parsed_results_details for %s/%s: %v", digest, arch, err)
                    }
                }
            }
        }
        rows.Close()

        if batchCount == 0 {
            break // no more rows
        }

        batchNum++
        logger.Infof("scan migration: completed batch %d (migrated=%d, skipped=%d, failed=%d)",
            batchNum, result.ScansMigrated, result.ScansSkipped, result.ScansFailed)

        if cfg.Delay > 0 {
            select {
            case <-ctx.Done():
                return ctx.Err()
            case <-time.After(cfg.Delay):
            }
        }
    }

    return nil
}

func migrateSBOMBlobs(ctx context.Context, store *blobStore, cfg MigrateBlobsConfig, result *MigrateBlobsResult) error {
    conn := persistence.MustGetPooledPostgresSession(ctx)
    defer conn.Release()

    query := `
        DECLARE sbom_cursor CURSOR FOR
        SELECT digest, arch, sbom
        FROM external_image_sbom
        WHERE sbom IS NOT NULL
    `

    if _, err := conn.Exec(ctx, query); err != nil {
        return fmt.Errorf("failed to declare cursor: %w", err)
    }
    defer conn.Exec(ctx, "CLOSE sbom_cursor")

    batchNum := 0
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        default:
        }

        rows, err := conn.Query(ctx, fmt.Sprintf("FETCH %d FROM sbom_cursor", cfg.BatchSize))
        if err != nil {
            return fmt.Errorf("failed to fetch batch: %w", err)
        }

        batchCount := 0
        for rows.Next() {
            batchCount++
            var digest, arch, sbom string
            if err := rows.Scan(&digest, &arch, &sbom); err != nil {
                result.SBOMsFailed++
                logger.Errorf("failed to scan row: %v", err)
                continue
            }

            key := sbomKey(digest, arch)

            if cfg.SkipExisting && store.objectExists(ctx, key) {
                result.SBOMsSkipped++
            } else if cfg.DryRun {
                logger.Infof("[dry-run] would upload sbom for %s/%s (%d bytes)", digest, arch, len(sbom))
            } else {
                if err := store.putSBOM(ctx, digest, arch, sbom); err != nil {
                    result.SBOMsFailed++
                    logger.Errorf("failed to upload sbom for %s/%s: %v", digest, arch, err)
                } else {
                    result.SBOMsMigrated++
                }
            }
        }
        rows.Close()

        if batchCount == 0 {
            break
        }

        batchNum++
        logger.Infof("sbom migration: completed batch %d (migrated=%d, skipped=%d, failed=%d)",
            batchNum, result.SBOMsMigrated, result.SBOMsSkipped, result.SBOMsFailed)

        if cfg.Delay > 0 {
            select {
            case <-ctx.Done():
                return ctx.Err()
            case <-time.After(cfg.Delay):
            }
        }
    }

    return nil
}
```

### Usage from external CLI tool

The external program imports the package and calls the function:

```go
import (
    "context"
    "fmt"
    "os"
    "time"

    "github.com/securebuildhq/securebuild/pkg/externalimage"
    // ... other imports for config initialization (param, persistence)
)

func main() {
    ctx := context.Background()

    // Initialize config, DB pool, and param context
    // (the external CLI handles this — see existing cmd/cli patterns)

    result, err := externalimage.MigrateBlobsToStorage(ctx, externalimage.MigrateBlobsConfig{
        BatchSize:    100,
        SkipExisting: true,  // skip objects already in S3 (idempotent restart)
        DryRun:       false, // set true first to preview
        Delay:        0,     // add delay if needed to reduce load
    })
    if err != nil {
        fmt.Fprintf(os.Stderr, "migration failed: %v\n", err)
        os.Exit(1)
    }

    fmt.Printf("Migration complete:\n")
    fmt.Printf("  Scans:  migrated=%d, skipped=%d, failed=%d\n",
        result.ScansMigrated, result.ScansSkipped, result.ScansFailed)
    fmt.Printf("  SBOMs:  migrated=%d, skipped=%d, failed=%d\n",
        result.SBOMsMigrated, result.SBOMsSkipped, result.SBOMsFailed)
}
```

### Why server-side cursors

With ~1 MB per row and ~410K rows, loading all rows into memory would require ~400 GB of RAM. Server-side cursors (`DECLARE` / `FETCH`) stream rows in batches, keeping memory bounded to `BatchSize` rows.

### Idempotency

- Object keys are deterministic (`{digest}/{arch}/raw_result.json`). S3 `PutObject` overwrites if the key exists — safe to re-run.
- `SkipExisting: true` does a HEAD/GET check before uploading — avoids re-uploading on restart, saving bandwidth and time.
- No DB writes during migration — no partial state to clean up.

### No DB writes during migration

Since object keys are derived from the primary key, the migration function only **reads** from the database and **writes** to the object store. There are no `UPDATE` statements, no transactions to manage, and no risk of corrupting database state. If the process is killed mid-batch, simply re-run with `SkipExisting: true`.

---

## Phase 3: Switch Reads to S3 Only (Still Dual-Write)

Phase 3 switches all reads to S3 — no DB fallback. Writes continue to go to both S3 and DB (Phase 1 dual-write code unchanged). This tests S3 reads in production while keeping DB columns fully populated as a rollback safety net.

### Prerequisites

- Phase 2 bulk copy completed with zero failures
- Verification that object count in S3 matches row count in DB

### Write path — no changes

The write path from Phase 1 is unchanged. New writes still go to both S3 and DB. This is intentional — if Phase 3 reveals S3 read problems, reverting to Phase 1/2 code immediately restores DB reads with no data gaps.

### Read path changes (Go)

Replace the Phase 1 fallback readers with S3-only getters. No DB fallback:

```go
// GetExternalImageScanRawResult returns the raw scan result from object storage.
func GetExternalImageScanRawResult(ctx context.Context, digest, arch string) (string, error) {
    store, err := newBlobStore(ctx)
    if err != nil {
        return "", fmt.Errorf("failed to create blob store: %w", err)
    }
    return store.getRawResult(ctx, digest, arch)
}

// GetExternalImageScanParsedResultsDetails returns parsed vulnerability details from object storage.
func GetExternalImageScanParsedResultsDetails(ctx context.Context, digest, arch string) (string, error) {
    store, err := newBlobStore(ctx)
    if err != nil {
        return "", fmt.Errorf("failed to create blob store: %w", err)
    }
    return store.getParsedResultsDetails(ctx, digest, arch)
}

// GetExternalImageSBOMContent returns the SBOM JSON from object storage.
func GetExternalImageSBOMContent(ctx context.Context, digest, arch string) (string, error) {
    store, err := newBlobStore(ctx)
    if err != nil {
        return "", fmt.Errorf("failed to create blob store: %w", err)
    }
    return store.getSBOM(ctx, digest, arch)
}
```

No fallback, no DB column reads. If S3 is unavailable, the read fails — same as any other infrastructure dependency.

### API (TypeScript) read path changes

The TypeScript API layer (`securebuild-api/lib/externalimage/externalimage.ts`) queries the database directly. Two approaches:

**Option A (recommended): Add a Go API endpoint** that the TypeScript API calls. The Go service handles the object store reads. This keeps the object store credentials and logic on the Go side.

**Option B: TypeScript fetches from S3 directly.** Requires adding AWS SDK to the Next.js app and sharing R2 credentials. More moving parts, but avoids a Go API round-trip.

#### Option A: New Go HTTP endpoints

Add to the Go service (or an existing HTTP handler):

```
GET /internal/external-image-scan/{digest}/{arch}/raw_result       → returns raw_result JSON
GET /internal/external-image-scan/{digest}/{arch}/parsed_results    → returns parsed_results_details JSON
GET /internal/external-image-sbom/{digest}/{arch}                   → returns sbom JSON
```

These endpoints call the new Go getter functions and return the content directly.

#### TypeScript changes (`getExternalImageScan`)

Replace the direct DB column read with a call to the Go internal endpoint:

```typescript
// Before:
query = `select escan.raw_result as scan_result, ...`

// After:
// 1. Query DB for metadata only (no blob column)
query = `select escan.created_at as scan_created_at, esbom.created_at as sbom_created_at, ...
    from external_image_scan escan
    left join external_image_sbom esbom on escan.digest = esbom.digest and escan.arch = esbom.arch
    where escan.digest = $1 and escan.arch = $2`

// 2. Fetch scan result from Go internal endpoint
const scanResult = await fetch(`${internalGoBaseUrl}/internal/external-image-scan/${digest}/${arch}/${format === 'raw' ? 'raw_result' : 'parsed_results'}`)
```

Same change applies to `getBatchExternalImageScans`, `getExternalImageSBOM`, `getExternalImageSbom`, and `getBatchExternalSboms`.

---

## Phase 4: Stop Writing to DB Columns + Drop Them

Phase 4 is the point of no return. After Phase 3 has been running stable (suggested: 2 weeks), stop writing blob data to DB columns and drop them.

### Prerequisites

1. Phase 3 has been running stable for a confidence period (suggested: 2 weeks).
2. No old code versions are running (all pods on Phase 3 code that reads S3 only).
3. S3 read error rates are within acceptable bounds.

### Write path changes (Go)

#### `SetExternalImageScanStatus` — remove `raw_result` and `parsed_results_details` from DB write

```go
func SetExternalImageScanStatus(ctx context.Context, params SetExternalImageScanStatusParams) error {
    conn := persistence.MustGetPooledPostgresSession(ctx)
    defer conn.Release()

    now := time.Now()

    var scanStatusMessage *string
    if params.ScanStatusMessage != "" {
        scanStatusMessage = &params.ScanStatusMessage
    }

    // Step 1: Upload blobs to object store (mandatory — fail on error)
    if params.Status == ScanStatusSucceeded && params.RawResult != "" {
        store, err := newBlobStore(ctx)
        if err != nil {
            return fmt.Errorf("failed to create blob store: %w", err)
        }
        if err := store.putRawResult(ctx, params.Digest, params.Arch, params.RawResult); err != nil {
            return fmt.Errorf("failed to upload raw_result to object store: %w", err)
        }
        if params.ParsedResultsDetails != "" {
            if err := store.putParsedResultsDetails(ctx, params.Digest, params.Arch, params.ParsedResultsDetails); err != nil {
                return fmt.Errorf("failed to upload parsed_results_details to object store: %w", err)
            }
        }
    }

    // Step 2: DB write — blob columns removed, metadata only
    query := `
        INSERT INTO external_image_scan (digest, arch, parsed_results, created_at, status, scan_status_message, updated_at, scan_completed_at, scan_attempted_at, scan_status_updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $4, $4, $4, $4)
        ON CONFLICT (digest, arch) DO UPDATE
        SET parsed_results = $3,
            status = $5,
            scan_status_message = $6,
            updated_at = $4,
            scan_completed_at = $4,
            scan_status_updated_at = $4
    `

    _, err := conn.Exec(ctx, query,
        params.Digest,
        params.Arch,
        params.ParsedResults,       // counts JSON — small, keep in DB for query efficiency
        now,
        string(params.Status),
        scanStatusMessage,
    )
    if err != nil {
        return fmt.Errorf("failed to set scan status for digest %s, arch %s: %w", params.Digest, params.Arch, err)
    }

    return nil
}
```

Note: `parsed_results` (the 66-byte counts JSON) is kept in the DB — it's tiny and used for quick count lookups. Only `raw_result` and `parsed_results_details` are dropped from the DB write.

#### `SetExternalImageSBOM` — remove `sbom` from DB write

```go
func SetExternalImageSBOM(ctx context.Context, digest string, sbom string, source string, arch string, imageSizeBytes int64, imageDigest string) error {
    conn := persistence.MustGetPooledPostgresSession(ctx)
    defer conn.Release()

    // Step 1: Upload SBOM to object store (mandatory — fail on error)
    if sbom != "" {
        store, err := newBlobStore(ctx)
        if err != nil {
            return fmt.Errorf("failed to create blob store: %w", err)
        }
        if err := store.putSBOM(ctx, digest, arch, sbom); err != nil {
            return fmt.Errorf("failed to upload sbom to object store: %w", err)
        }
    }

    // Step 2: DB write — sbom column removed, metadata only
    query := `
        insert into external_image_sbom (digest, arch, source, image_size_bytes, image_digest, created_at)
        values ($1, $2, $3, $4, $5, $6)
        on conflict (digest, arch) do update
        set source = $3, image_size_bytes = $4, image_digest = $5, created_at = $6
    `

    _, err := conn.Exec(ctx, query, digest, arch, source, imageSizeBytes, imageDigest, time.Now())
    if err != nil {
        return fmt.Errorf("failed to insert/update external image SBOM for digest %s, arch %s: %w", digest, arch, err)
    }

    return nil
}
```

### Schema changes

Remove the old columns from SchemaHero YAML:

**`db/schema/tables/external-image-scan.yaml`** — remove:
```yaml
    - name: parsed_results
      type: text
    - name: parsed_results_details
      type: text
    - name: raw_result
      type: text
```

**`db/schema/tables/external-image-sbom.yaml`** — remove:
```yaml
    - name: sbom
      type: text
```

SchemaHero generates `ALTER TABLE ... DROP COLUMN` DDL. This reclaims TOAST space immediately.

### Post-drop cleanup

```sql
VACUUM FULL external_image_scan;
VACUUM FULL external_image_sbom;
```

`VACUUM FULL` rewrites the table to reclaim physical space. This requires an exclusive lock on the table — schedule during a maintenance window. Alternatively, use `pg_repack` for online table rewriting.

### Expected storage savings

| Before | After |
|---|---|
| `external_image_scan`: 796 GB | ~187 MB (heap + indexes only) |
| `external_image_sbom`: 453 GB | ~109 MB (heap + indexes only) |
| **Total**: ~1.25 TB | **~300 MB** |

The ~1.25 TB of blobs now lives in R2/S3 at a fraction of the cost.

---

## Write Path: Dual-Write Stop Condition

Phase 4 is where dual-write stops. The DB INSERT/UPDATE no longer includes `raw_result`, `parsed_results_details`, or `sbom` columns. Only `parsed_results` (the 66-byte counts JSON) remains in the DB for efficient count queries.

---

## Failure Modes & Mitigations

| Failure | Impact | Mitigation |
|---|---|---|
| S3 upload fails during write (Phase 1-4) | Scan/SBOM write fails entirely — caller retries | No partial state: nothing written to DB, no orphan S3 object (unless DB fails after S3, in which case retry overwrites same key) |
| DB write fails after S3 upload (Phase 1-3) | S3 object exists but DB row doesn't | Retry will overwrite same S3 key and write DB row — idempotent |
| S3 read fails during API request (Phase 3+) | Read fails — no DB fallback | S3 is now a hard dependency, same as DB. Alert on error rate. |
| Bulk copy interrupted (Phase 2) | Partial migration — some objects in S3, some not | Idempotent — re-run with `SkipExisting: true` |
| Old code version running during deploy (Phase 1-3) | Writes to DB only (no S3) | Bulk migration (Phase 2) handles pre-existing rows; new code writes to both |
| Object store outage (Phase 3+) | Reads fail (no DB fallback). Writes fail (mandatory S3). | S3 is a hard dependency. Same SLA as DB. |

---

## Rollback Plan

At any point before Phase 4 (stop writing + drop):

- **Phase 1 rollback**: Revert code. Old columns still have all data. S3 objects are harmless and ignored.
- **Phase 2 rollback**: Stop bulk copy. S3 has partial data, DB has all data. Reads still work from DB (Phase 1 fallback readers).
- **Phase 3 rollback**: Revert to Phase 1/2 code (fallback reads). DB columns are still being written (dual-write never stopped), so all data is present in DB. Immediate rollback with zero data loss.

After Phase 4 (stop writing + columns dropped), rollback is not possible without restoring from backup. Phase 4 should only proceed after a confidence period (suggested: 2 weeks of stable Phase 3 operation with S3-only reads).

---

## Implementation Checklist

- [ ] **Phase 1** (no schema changes needed)
  - [ ] Add `R2ImageScansBucketName` param to `pkg/param/param.go`
  - [ ] Create the new R2 bucket (manual or via infra config)
  - [ ] Create `pkg/externalimage/blobstore.go`
  - [ ] Modify `SetExternalImageScanStatus` for dual-write (S3 upload + unchanged DB write)
  - [ ] Modify `SetExternalImageSBOM` for dual-write
  - [ ] Deploy new code (rolling update — zero downtime)

- [ ] **Phase 2**
  - [ ] Create `pkg/externalimage/migrate_blobs.go` with public `MigrateBlobsToStorage` function
  - [ ] Build external CLI tool that calls `MigrateBlobsToStorage`
  - [ ] Run with `DryRun: true` first to estimate work
  - [ ] Run with `SkipExisting: true, BatchSize: 100`
  - [ ] Verify object count in S3 matches row count in DB

- [ ] **Phase 3** (S3-only reads, still dual-write)
  - [ ] Replace Go read functions with S3-only getters (no DB fallback)
  - [ ] Add Go internal HTTP endpoints for blob reads
  - [ ] Modify `getExternalImageScan` to use Go endpoint instead of DB column
  - [ ] Modify `getBatchExternalImageScans` to use Go endpoint
  - [ ] Modify `getExternalImageSBOM` / `getExternalImageSbom` to use Go endpoint
  - [ ] Modify `getBatchExternalSboms` to use Go endpoint
  - [ ] Deploy and monitor for 2 weeks — DB columns still written as safety net

- [ ] **Phase 4** (stop writing to DB + drop columns)
  - [ ] Modify `SetExternalImageScanStatus` — remove `raw_result` and `parsed_results_details` from DB write (keep `parsed_results` counts)
  - [ ] Modify `SetExternalImageSBOM` — remove `sbom` from DB write
  - [ ] Remove old columns from SchemaHero YAML
  - [ ] Apply schema change
  - [ ] Run `VACUUM FULL` on both tables
  - [ ] Deploy final code
