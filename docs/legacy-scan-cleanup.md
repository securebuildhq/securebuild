# Retiring legacy external-image scan objects

Generation-based scans leave the older `<digest>/<arch>/raw_result.json.gz`
and `parsed_results_details.json.gz` objects behind. The worker retires those
exact two keys only after a generation replacement has been published and a
24-hour grace period has elapsed. SBOMs and generation-specific objects are
not part of legacy cleanup. Images without a selected generation retain their
legacy results.

## Deployment and existing data

1. Apply the SchemaHero changes to `external_image_scan` before updating workers.
2. Deploy the generation-aware readers, updated fixed-count backfill, and worker.
   Retire old processes before the first 24-hour cleanup deadline; old binaries
   that read or write legacy paths are no longer compatible after retirement.
3. Preview the existing migrated images that have not already been scheduled:

   ```sh
   securebuild-worker schedule-legacy-scan-cleanup --dry-run --batch-size=1000
   ```

   The output reports candidate rows and `intended_keys` (two per eligible row).
   It reads PostgreSQL only, checks selected generation metadata, and performs
   no writes. Keys may already be absent; there is no storage byte accounting.
   Rows already scheduled or cleaned are excluded.
4. Schedule the same cohort:

   ```sh
   securebuild-worker schedule-legacy-scan-cleanup --batch-size=1000
   ```

   This updates up to 1,000 rows per database batch by default, starting a new
   24-hour grace period. Both modes work without R2 credentials or requests.
   The normal worker performs deletion later. The command supports `--timeout` (default
   one hour), can be interrupted, and can be rerun. Concurrent publication may
   schedule rows itself; reported skips require a rerun to confirm completion.

Future successful publications schedule retirement automatically without
extending existing deadlines. Completed rows are not scheduled again, even
when rescanned. Rows with no legacy objects still receive a completion marker.

## Recovery and progress

The legacy and generation cleanup loops run independently once per minute,
each with a 45-second budget. Both claim at most 500 rows per batch and delete
up to 1,000 keys per storage request, then checkpoint the batch in PostgreSQL.
Claims reserve up to five seconds for deletion and checkpointing, use
`SKIP LOCKED`, and persist a five-minute retry lease. No transaction remains
open during storage IO.

Legacy cleanup validates generation identity and exact object keys from the
database. It relies on publication having uploaded and read back both objects
before selecting the generation; it does not repeat those checks with HEAD.
Generation cleanup locks scan rows before generation rows, rechecks publication
leases under lock, protects selected generations, and revokes expired current
generation ownership before deleting. Locked rows are retried on a later pass.

Scheduling pages the scan table before joining generation metadata, avoiding
repeated full-table joins. With 557,818 eligible rows, default dry-run uses 559
bounded read queries, scheduling adds 558 batch updates, and legacy deletion
needs 1,116 storage requests if there are no errors or retries. There are no
per-object existence requests or per-row claim/completion transactions. Actual
runtime still depends on database and storage latency.

A missing legacy object is successful deletion. Storage errors, including
partial batch failures, leave rows unfinished. Completion is recorded only
after successful object deletion; a crash between deletion and recording
completion is safe to retry after the lease expires. The worker never resets
a selected image to legacy storage or writes new data to legacy keys; those
invariants are required for this cleanup protocol.

Inspect persisted progress with:

```sql
SELECT COUNT(*) FILTER (WHERE legacy_cleaned_at IS NOT NULL) AS cleaned,
       COUNT(*) FILTER (WHERE legacy_cleaned_at IS NULL
                         AND legacy_cleanup_after IS NOT NULL) AS pending,
       COUNT(*) FILTER (WHERE legacy_cleaned_at IS NULL
                         AND legacy_cleanup_after <= NOW()) AS due
FROM external_image_scan;
```

An active retry lease temporarily moves a row out of `due`. Existing scan
candidate cleanup metrics describe generation objects only; they do not
include legacy objects. Inspect worker warnings for legacy replacement
validation or cleanup errors. Objects whose database rows have disappeared
are outside this cleanup's scope and require a separate inventory review.
