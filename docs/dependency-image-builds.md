# Dependency image rebuilds

Successful package builds enqueue dependent image APKOs through
`listener.EnqueueBuildAPKO`. Concurrent notifications for the same APKO merge
into one unfinished `build_apko` row with the key `dependency-apko:<apkoId>`.
Different APKOs, including different version tags of an image, stay separate.
Manual image requests retain their existing behavior.

The payload records the union of exact package name/version/release requirements.
Both public APK indexes must contain every revision before the handler creates an
image build or acquires a build machine. A newer release does not stand in for an
older required release. Each check downloads one index per architecture, checks
the whole set, and schedules the existing publication retry if anything is
missing. Adding a new requirement starts a fresh publication wait; repeated
notifications for an existing requirement do not extend it. FIFO creation time,
explicit priority, and existing retry deadlines remain intact.

The key stays held during dispatch. Enqueues lock and update the same row while
the handler uses its claimed payload snapshot. Completion and every retry/error
path lock the row and compare against that snapshot. If new requirements arrived,
the row becomes pending again instead of being completed, producing one follow-up
dispatch after all merged requirements are published. Repeating an identical bump
during dispatch does not create a follow-up. Work received after completion creates
a new row. Dispatch completion means the image build was handed to the builder;
it does not mean the resulting image is already published.

## Upgrade

Stop all older worker instances before starting workers with this change. Older
workers only understand the singleton `triggerPackage` field and cannot enforce
the new `triggerPackages` requirement list. A mixed-version rollout is unsafe.
No database migration or production queue cleanup is performed by this change.

On the next dependency notification for an APKO, compatible unclaimed legacy
dependency requests are merged transactionally and their old rows are completed
with a `coalescedInto` receipt. Claimed legacy work, manual requests, malformed
payloads, and payloads containing unknown fields are left alone. Thus an existing
legacy backlog is consolidated as its APKOs receive notifications, rather than
being rewritten wholesale at worker startup.
