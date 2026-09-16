# Rebuild scheduling

Dependency-ready package rebuild chains and the `build_package` and `build_apko`
work queues prefer newer upstream versions when multiple builds are pending.

At each scheduling pass, PostgreSQL ranks builds within their family: the highest
pending version has rank 0, the next distinct version rank 1, and so on. Rank 0
builds run before rank 1 builds across families. For example, pending Go 1.26 and
PostgreSQL 18 builds run before Go 1.25 and PostgreSQL 17. Version numbers from
unrelated families are never compared directly.

Package families come from `package_family_package`; packages without a family
are grouped by package ID. The requested `package_version.version` determines
order, or the highest upstream version if no version was specified. APK release
epochs and creation timestamps do not make an old upstream release newer.

Image APKOs are grouped by image ID and use their highest semantic version tag.
Aliases such as `latest` do not override versioned tags. Semantic versions,
including numeric components, optional `v` prefixes, and prereleases, use semver
ordering. Missing or non-semver metadata receives rank 0 and falls back to FIFO.

Explicit work-queue priority takes precedence over version rank. Equal ranks
use FIFO, then the job ID for deterministic ties. Older builds remain queued
and drain as newer builds are admitted. Sustained arrivals of newer builds can
delay older builds; there is no aging override.

Package dependency gates still apply before ranking. Running handlers and builds
with assigned VMs are not preempted. The work queue claims only as many jobs as
there are available handler slots and rechecks eligibility under PostgreSQL row
locks. A saturated queue wakes when a handler releases its slot and then ranks
the current backlog; it does not wait for a polling timer. The separate five-second
scheduled-retry poll still wakes queues whose retry deadlines have arrived.
Rebuild chains rank the ready links at the start of each pass. Scheduling
remains separate for each work-queue channel and the rebuild-chain processor.

## Stored keys and deployment

`package_version.version_sort_key` stores an intrinsic upstream-version key;
`image_apko.version_sort_key` stores the highest supported tag's key. Adding an
older version only writes that artifact's key, without renumbering existing
versions. Go and TypeScript compute keys on package-version creation and image
tag changes, with shared fixtures checking that both encoders agree.

Keys encode numeric core components (up to 20 digits each), stable/prerelease
precedence, and prerelease identifiers. Partial numeric tags and an optional `v`
prefix are supported; build metadata is ignored. PostgreSQL uses `COLLATE "C"`
for every key comparison so database locale cannot change the order. Unsupported
formats have an empty key; NULL marks records awaiting backfill. Both fall back
to FIFO at rank zero.

Deploy and backfill in this order:

1. Apply the SchemaHero migrations.
2. Deploy the updated workers and web app, and wait for older instances to stop.
3. Run `securebuild-worker migrate-build-priority` once using the worker's usual
   configuration, including its database connection.

The command processes transactions of at most 500 rows and verifies that no
missing or stale keys remain. It skips locked rows to let other batches progress,
but exits unsuccessfully if any remain at the final check. Release the conflicting
locks and rerun. Interrupted runs are also safe to resume: current keys are not
rewritten. The default timeout is ten minutes and can be adjusted with
`--timeout 20m`. Unsupported versions are marked processed with an empty key and
continue using FIFO.

Workers perform no startup or recurring backfill. Builds remain eligible through
FIFO until the one-time migration fills their keys. Running the migration after
all writers are updated prevents older instances from invalidating keys afterward.

Images also store `version_sort_tags`, the tags used to compute their key. If tags
and their snapshot differ, scheduling ignores the stale key and uses FIFO. Updated
writers maintain tags, their snapshot, and their key in the same transaction. The
migration can be rerun manually to repair any stale keys; there is no background
repair loop.

The work-queue claim is one SQL statement: select eligible jobs, join stored keys,
compute a dense version rank within each family, sort by explicit priority/rank/
FIFO, and claim only the available handler capacity with `FOR UPDATE SKIP LOCKED`.
Only claimed jobs are returned to Go. Rebuild chains use the same SQL version
ranking after their dependency gates. No full backlog of versions or IDs is sent
to Go for comparison or sent back to PostgreSQL.

## Observability

The `listener.process_messages_for_queue` tracing span covers queue ranking,
claiming, and dispatch. It starts after the capacity wait and records
`queue.channel`, `queue.available_workers`, and `queue.claimed_messages`, so
ranking latency can be examined separately from time waiting for busy workers.
Handler execution is outside this span.
