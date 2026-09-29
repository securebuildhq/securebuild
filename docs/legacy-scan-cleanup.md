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
   securebuild-worker schedule-legacy-scan-cleanup --dry-run --batch-size=100
   ```

   The output reports candidates, existing legacy objects, and their compressed
   bytes. It verifies both replacement objects and performs no database or
   object-storage writes. Rows already scheduled or cleaned are excluded.
4. Schedule the same cohort:

   ```sh
   securebuild-worker schedule-legacy-scan-cleanup --batch-size=100
   ```

   This only records deadlines, starting a new 24-hour grace period. The normal
   worker performs deletion later. The command supports `--timeout` (default
   one hour), can be interrupted, and can be rerun. Concurrent publication may
   schedule rows itself; reported skips require a rerun to confirm completion.

Future successful publications schedule retirement automatically without
extending existing deadlines. Completed rows are not scheduled again, even
when rescanned. Rows with no legacy objects still receive a completion marker.

## Recovery and progress

The cleanup loop claims at most 100 rows at a time with `SKIP LOCKED` and a
five-minute retry lease. Each legacy cleanup pass has a 45-second budget,
separate from generation cleanup. Validation reserves the final five seconds
for deletion and checkpointing, so slow HEAD requests cannot repeatedly discard
already validated work. It releases database transactions before
storage IO, checks replacement keys and compressed sizes using HEAD requests,
and deletes legacy objects in bulk using the configured bucket/folder prefix.

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
