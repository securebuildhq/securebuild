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
locks. Rebuild chains rank the ready links at the start of each pass. Scheduling
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

Apply the SchemaHero migrations before deploying the worker or web app. The
worker backfills missing keys in transactions of at most 500 rows before starting
its schedulers, with a one-minute timeout. It retries once a minute to handle
locked records, interrupted migration, and records from older writers during a
rolling deployment. The backfill does not rewrite already-current keys.

Images also store `version_sort_tags`, the tags used to compute their key. If an
older writer changes tags without updating the key, scheduling ignores the stale
key and uses FIFO until the next backfill repairs it. Updated writers maintain
tags, their snapshot, and their key in the same transaction.

The work-queue claim is one SQL statement: select eligible jobs, join stored keys,
compute a dense version rank within each family, sort by explicit priority/rank/
FIFO, and claim only the available handler capacity with `FOR UPDATE SKIP LOCKED`.
Only claimed jobs are returned to Go. Rebuild chains use the same SQL version
ranking after their dependency gates. No full backlog of versions or IDs is sent
to Go for comparison or sent back to PostgreSQL.
