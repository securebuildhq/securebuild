# Retire duplicate catalog scan jobs

Deploy the catalog scheduler deduplication fix to every worker before cleaning
the queue. The scheduler excludes unfinished jobs before its batch limit and
uses the catalog image ID as an atomic deduplication key. It recognizes pending,
running, and delayed retry jobs created without keys by older workers.

The cleanup marks surplus `scan_catalog_image` jobs complete in batches of up
to 1,000. It preserves payloads, creation times, retry metadata, and existing error
messages, and records the queue ID of the retained job in `last_error`. It does
not delete rows or change scan results, catalog freshness, or other queues.

## Choose the retained job

For each nonempty string `catalogImageId`, the cleanup prefers a running job,
then a job with a deduplication key, then higher priority, then the oldest job.
The queue ID breaks timestamp ties. It preserves every running job, including
stale claims that the listener must recover through its normal retry path. If
no job is running, one pending job remains, including its retry delay.

Jobs with missing, blank, or non-string IDs need separate inspection. Completed
jobs remain unchanged. The cleanup locks only the duplicate rows it updates,
skips locked rows, and checks again that each row is unfinished and unclaimed
before retiring it. A worker can continue claiming jobs while cleanup runs.

## Preview in production

Use an approved production connection. Run this from the repository root in
`psql` with `ON_ERROR_STOP` enabled:

```sql
\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
\i scripts/sql/preview-duplicate-catalog-scans.sql
ROLLBACK;
```

The preview reports valid pending jobs, distinct catalog images, running jobs,
and duplicate jobs eligible for retirement. Save the output with its UTC time.
At 19:06 UTC on November 3, 2026, the preview found 227,206 unfinished jobs for
1,551 catalog images, including one running scan. It identified 225,655
duplicates for retirement. Recheck the counts before applying cleanup.

## Apply one batch

Confirm that every active worker runs the deduplicating scheduler. Obtain
approval for the production updates, then run one batch in a short transaction:

```sql
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
\i scripts/sql/retire-duplicate-catalog-scans.sql
COMMIT;
```

Save the returned retired IDs and keeper IDs. A failed statement must be
followed by `ROLLBACK`; investigate the error before retrying. To rehearse the
updates without retaining them, replace `COMMIT` with `ROLLBACK`. This rehearsal
still writes and takes row locks, so it requires production write approval.

Pause at least one second between committed batches and check worker errors and
database load. Re-run the preview after the first batch and periodically during
cleanup. Stop when `retireable_duplicates` reaches zero. An empty batch can also
mean that another transaction holds the remaining duplicates; retry later and
use the preview to distinguish that case from completion.

## Verify and recover

After cleanup, expect one unfinished job per valid catalog image, except when
multiple jobs are already running for the same image. Allow those handlers to
finish. Confirm that completed scans advance `image_catalog.next_scan_at` and
that pending job counts stay bounded across at least two ten-minute scheduler
cycles. Check that other queue counts and in-flight jobs were unaffected.

Retired rows remain available for audit, with a `superseded duplicate catalog
scan` reason. Do not bulk reopen them: their retained job may already have
finished. If an image still needs a scan, check its catalog freshness and any
unfinished job, then let the scheduler enqueue one scan when it is due. Stop
cleanup if duplicate counts grow after deployment; first verify that no worker
is still running the old scheduler.
