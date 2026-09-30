# External image fixed-count summaries

SecureBuild stores a compact scan summary in
`external_image_scan.parsed_results` and detailed vulnerability data in the
`parsed_results_details.json.gz` object for each digest and architecture. New
scan results persist this compact shape:

```json
{
  "counts": {
    "critical": 27,
    "high": 132,
    "medium": 161,
    "low": 21,
    "total": 341
  },
  "fixed_counts": {
    "critical": 18,
    "high": 107,
    "medium": 90,
    "low": 13,
    "total": 228
  }
}
```

`fixed_counts` is always present for newly completed scans, including when all
of its values are zero. Its absence therefore means fixability data is not
available, rather than that the scan found zero fixable vulnerabilities.

The scan-summary API continues to read legacy flat count objects and `{counts}`
objects, but omits `fixed_counts` for those rows until they are backfilled.

## Backfill

Deploy all updated SecureBuild scan writers and the API before running the
backfill. Use the worker's normal configuration, including PostgreSQL and R2
credentials.

First validate candidate objects without writing PostgreSQL:

```shell
securebuild-worker backfill-external-image-fixed-counts --dry-run --timeout 60m
```

Then run the backfill:

```shell
securebuild-worker backfill-external-image-fixed-counts --timeout 60m
```

The command reads candidates in pages of 100 by default. Use `--batch-size`
between 1 and 1000 to adjust the page size. It prints counts for candidates,
updates, concurrent scans skipped, and failures.

The operation is safe to interrupt and rerun. Rows already containing
`fixed_counts` are not selected. Each update also verifies that the compact
summary and successful scan timestamp have not changed since the candidate was
read, so a concurrently completed scan is never overwritten. A skipped
concurrent row makes the command exit unsuccessfully so the operator reruns it;
the row will either already contain the new summary shape or be picked up by
that rerun.

Any missing, unreadable, or invalid detailed object makes the command exit
unsuccessfully after processing the remaining candidates. Investigate those
objects and rerun until the command reports zero failures. Verify representative
digests through `/api/v1/external-image/scan-summary` before enabling consumers
that no longer fall back to total counts.
