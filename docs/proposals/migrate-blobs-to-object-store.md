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
external-image-scan/{digest}/{arch}/raw_result.json.gz
external-image-scan/{digest}/{arch}/parsed_results_details.json.gz
external-image-sbom/{digest}/{arch}/sbom.json.gz
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
{digest}/{arch}/raw_result.json.gz
{digest}/{arch}/parsed_results_details.json.gz
{digest}/{arch}/sbom.json.gz
```

The `sha256:` algorithm prefix is stripped from the digest, so `sha256:ab3f...` becomes `ab3f.../x86_64/raw_result.json.gz`. The digest is a random hex hash, so it naturally distributes objects evenly across S3/R2 partitions without any artificial shard prefix.

Example keys:
```
ab3f9e.../x86_64/raw_result.json.gz
ab3f9e.../x86_64/parsed_results_details.json.gz
c19d2a.../aarch64/sbom.json.gz
```

No schema changes are needed. The keys are computed from the existing primary key columns.

### Gzip compression

All blob objects are gzip-compressed on upload and decompressed on download. This reduces storage and bandwidth costs by ~80-90% for JSON data (grype output, parsed vulnerability details, SBOM JSON are highly compressible text).

- **Upload**: data is gzip-compressed in memory, then uploaded via `R2Client.PutObject` (same pattern as the existing Alpine secdb feed publisher).
- **Download**: the compressed bytes are fetched via `R2Client.GetObjectData` and decompressed in memory.
- The `.gz` suffix in object keys makes the compression obvious to anyone inspecting the bucket.

The compression/decompression is handled entirely within `pkg/externalimage/blobstore.go` — callers always work with plain strings and are unaware of the compression.

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
    "bytes"
    "compress/gzip"
    "context"
    "fmt"
    "io"
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
    return fmt.Sprintf("%s/%s/raw_result.json.gz", stripDigestAlgo(digest), arch)
}

func parsedResultsDetailsKey(digest, arch string) string {
    return fmt.Sprintf("%s/%s/parsed_results_details.json.gz", stripDigestAlgo(digest), arch)
}

func sbomKey(digest, arch string) string {
    return fmt.Sprintf("%s/%s/sbom.json.gz", stripDigestAlgo(digest), arch)
}

// gzipData compresses a string using gzip and returns the compressed bytes.
func gzipData(data string) ([]byte, error) {
    var buf bytes.Buffer
    gz := gzip.NewWriter(&buf)
    if _, err := gz.Write([]byte(data)); err != nil {
        return nil, fmt.Errorf("failed to gzip data: %w", err)
    }
    if err := gz.Close(); err != nil {
        return nil, fmt.Errorf("failed to close gzip writer: %w", err)
    }
    return buf.Bytes(), nil
}

// gunzipData decompresses gzip-compressed bytes and returns the original string.
func gunzipData(data []byte) (string, error) {
    gz, err := gzip.NewReader(bytes.NewReader(data))
    if err != nil {
        return "", fmt.Errorf("failed to create gzip reader: %w", err)
    }
    defer gz.Close()
    decompressed, err := io.ReadAll(gz)
    if err != nil {
        return "", fmt.Errorf("failed to decompress gzip data: %w", err)
    }
    return string(decompressed), nil
}

// --- Upload (gzip-compressed) ---

func (s *blobStore) putRawResult(ctx context.Context, digest, arch, data string) error {
    compressed, err := gzipData(data)
    if err != nil {
        return err
    }
    return s.client.PutObject(ctx, rawResultKey(digest, arch), bytes.NewReader(compressed))
}

func (s *blobStore) putParsedResultsDetails(ctx context.Context, digest, arch, data string) error {
    compressed, err := gzipData(data)
    if err != nil {
        return err
    }
    return s.client.PutObject(ctx, parsedResultsDetailsKey(digest, arch), bytes.NewReader(compressed))
}

func (s *blobStore) putSBOM(ctx context.Context, digest, arch, data string) error {
    compressed, err := gzipData(data)
    if err != nil {
        return err
    }
    return s.client.PutObject(ctx, sbomKey(digest, arch), bytes.NewReader(compressed))
}

// --- Download (gzip-decompressed) ---

func (s *blobStore) getRawResult(ctx context.Context, digest, arch string) (string, error) {
    data, err := s.client.GetObjectData(ctx, rawResultKey(digest, arch))
    if err != nil {
        return "", err
    }
    return gunzipData(data)
}

func (s *blobStore) getParsedResultsDetails(ctx context.Context, digest, arch string) (string, error) {
    data, err := s.client.GetObjectData(ctx, parsedResultsDetailsKey(digest, arch))
    if err != nil {
        return "", err
    }
    return gunzipData(data)
}

func (s *blobStore) getSBOM(ctx context.Context, digest, arch string) (string, error) {
    data, err := s.client.GetObjectData(ctx, sbomKey(digest, arch))
    if err != nil {
        return "", err
    }
    return gunzipData(data)
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

### Schema change: `is_in_object_store` column

A boolean column `is_in_object_store` (default `false`) is added to both `external_image_scan` and `external_image_sbom`. This column tracks which rows have been copied to object storage, enabling:

- **Restart-safe migration**: the migration function only selects rows where `is_in_object_store = false`, so a crashed/restarted process picks up exactly where it left off.
- **Parallel workers**: multiple workers use `SELECT ... FOR UPDATE SKIP LOCKED` so they never process the same rows.
- **Progress tracking**: `SELECT count(*) WHERE is_in_object_store = false` shows remaining work.

New writes (Phase 1 dual-write) set `is_in_object_store = true` automatically, since the blob is uploaded to the object store before the DB row is written.

### Public Go function

Add to `pkg/externalimage/migrate_blobs.go`:

```go
// MigrateBlobsConfig controls the bulk migration of large text columns
// from PostgreSQL to object storage.
type MigrateBlobsConfig struct {
    BatchSize int           // rows per batch per worker (default: 100)
    Workers   int           // number of parallel workers (default: 5)
    Delay     time.Duration // delay between batches per worker (default: 0)
}

// MigrateBlobsResult summarizes a migration run.
type MigrateBlobsResult struct {
    ScansMigrated int // external_image_scan rows successfully migrated
    SBOMsMigrated int // external_image_sbom rows successfully migrated
}
```

### How it works

1. **Parallel workers**: `MigrateBlobsToStorage` spawns `cfg.Workers` goroutines. Each worker runs an independent loop that grabs a batch of rows, uploads blobs, and marks rows as migrated.

2. **Row selection**: Each worker runs:
   ```sql
   SELECT digest, arch, raw_result, parsed_results_details
   FROM external_image_scan
   WHERE is_in_object_store = false
     AND (raw_result IS NOT NULL OR parsed_results_details IS NOT NULL)
   ORDER BY random()
   LIMIT $1
   FOR UPDATE SKIP LOCKED
   ```
   `FOR UPDATE SKIP LOCKED` ensures concurrent workers never process the same rows — no duplicate work. `ORDER BY random()` distributes work across the table to reduce contention.

3. **Upload + mark**: For each row, the worker uploads blobs to the object store, then runs `UPDATE ... SET is_in_object_store = true` in the same transaction. If the process crashes, the transaction rolls back and the row stays `false` — it will be retried on the next run.

4. **Two passes**: Scans are migrated first, then SBOMs. Each pass runs all workers to completion before moving to the next table.

### Usage from external CLI tool

The external program imports the package and calls the function:

```go
result, err := externalimage.MigrateBlobsToStorage(ctx, externalimage.MigrateBlobsConfig{
    BatchSize: 100,
    Workers:   10,   // parallel workers
    Delay:     0,    // add delay if needed to reduce load
})
```

### Restart safety

- If the process is killed mid-batch, the transaction rolls back — locked rows are released and `is_in_object_store` stays `false`.
- On restart, the function selects only `is_in_object_store = false` rows, so it picks up exactly where it left off.
- Object keys are deterministic (`{digest}/{arch}/raw_result.json.gz`), so re-uploading the same key is safe (idempotent overwrite).

### Performance estimate

With ~800K rows total and ~0.75s per row (sequential), the migration would take ~5 days with a single worker. With 10 parallel workers and `FOR UPDATE SKIP LOCKED`, the estimated time drops to **~12-15 hours**. Increasing `Workers` further reduces time proportionally, limited by R2 API rate limits and database connection pool size.

---

## Phase 3: Switch Reads to S3 Only (Still Dual-Write)

Phase 3 switches all reads to S3 — no DB fallback. Writes continue to go to both S3 and DB (Phase 1 dual-write code unchanged). This tests S3 reads in production while keeping DB columns fully populated as a rollback safety net.

### Prerequisites

- Phase 2 bulk copy completed with zero failures
- Verification that object count in S3 matches row count in DB

### Write path — no changes

The write path from Phase 1 is unchanged. New writes still go to both S3 and DB. This is intentional — if Phase 3 reveals S3 read problems, reverting to Phase 1/2 code immediately restores DB reads with no data gaps.

### Read path changes (Go)

`GetExternalImageSBOM` and `GetExternalImageSBOMs` fetch SBOM content from object storage. Standalone raw-result, parsed-details, and SBOM-content getters were removed because they had no callers; the TypeScript API reads those objects through its own blob-store module.

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

Remove the old blob columns from SchemaHero YAML. Keep `is_in_object_store` for now so rows with missing objects can be identified and rescanned:

**`db/schema/tables/external-image-scan.yaml`** — remove:
```yaml
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

Phase 4 is where dual-write stops. The DB INSERT/UPDATE no longer includes `raw_result`, `parsed_results_details`, or `sbom` columns. `parsed_results` (the 66-byte counts JSON) remains for efficient count queries, and `is_in_object_store` remains so missing objects can be identified and rescanned.

---

## Failure Modes & Mitigations

| Failure | Impact | Mitigation |
|---|---|---|
| S3 upload fails during write (Phase 1-4) | Scan/SBOM write fails entirely — caller retries | No partial state: nothing written to DB, no orphan S3 object (unless DB fails after S3, in which case retry overwrites same key) |
| DB write fails after S3 upload (Phase 1-3) | S3 object exists but DB row doesn't | Retry will overwrite same S3 key and write DB row — idempotent |
| S3 read fails during API request (Phase 3+) | Read fails — no DB fallback | S3 is now a hard dependency, same as DB. Alert on error rate. |
| Bulk copy interrupted (Phase 2) | Partial migration — some objects in S3, some not | Idempotent — re-run; only `is_in_object_store = false` rows are selected |
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

- [x] **Phase 1** (schema change: is_in_object_store column added)
  - [x] Add `R2ImageScansBucketName` param to `pkg/param/param.go`
  - [ ] Create the new R2 bucket (manual or via infra config)
  - [x] Create `pkg/externalimage/blobstore.go`
  - [x] Modify `SetExternalImageScanStatus` for dual-write (S3 upload + DB write with is_in_object_store=true)
  - [x] Modify `SetExternalImageSBOM` for dual-write
  - [x] Add `is_in_object_store` column to SchemaHero YAML for both tables
  - [ ] Deploy new code (rolling update — zero downtime)

- [ ] **Phase 2** (not started)
  - [x] Create `pkg/externalimage/migrate_blobs.go` with public `MigrateBlobsToStorage` function
  - [x] Add parallel workers with `FOR UPDATE SKIP LOCKED` and `is_in_object_store` tracking
  - [ ] Build external CLI tool that calls `MigrateBlobsToStorage`
  - [ ] Run with `BatchSize: 100, Workers: 10`
  - [ ] Verify object count in S3 matches row count in DB

- [x] **Phase 3** (S3-only reads, still dual-write)
  - [x] Remove unused standalone Go blob getter functions
  - [x] Update Go `GetExternalImageSBOM` / `GetExternalImageSBOMs` to read SBOM from object store
  - [x] Create TypeScript R2 blob reader (`securebuild-api/lib/externalimage/blobstore.ts`)
  - [x] Add R2 params to TypeScript param module (`securebuild-api/lib/data/param.ts`)
  - [x] Modify `getExternalImageScan` to fetch scan result from object store instead of DB column
  - [x] Modify `getBatchExternalImageScans` to fetch scan results from object store
  - [x] Modify `getExternalImageSBOM` / `getExternalImageSbom` to fetch SBOM from object store
  - [x] Modify `getBatchExternalSboms` to fetch SBOMs from object store
  - [ ] Deploy and monitor for 2 weeks — DB columns still written as safety net

- [ ] **Phase 4** (in progress) (stop writing to DB + drop columns)
  - [x] Add compressed SQL backup and streaming restore scripts for `sbom`, `parsed_results_details`, and `raw_result`
  - [x] Review rows where `is_in_object_store` is `false`; retain the flag so they can be rescanned
  - [ ] Run the backup script
  - [x] Modify `SetExternalImageScanStatus` — remove `raw_result` and `parsed_results_details` from DB write (keep `parsed_results` counts)
  - [x] Modify `SetExternalImageSBOM` — remove `sbom` from DB write
  - [ ] Remove old blob columns from SchemaHero YAML; retain `is_in_object_store`
  - [ ] Apply schema change
  - [ ] Run `VACUUM FULL` on both tables
  - [ ] Deploy final code
