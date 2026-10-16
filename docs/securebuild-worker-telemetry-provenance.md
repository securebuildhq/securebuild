# securebuild-worker telemetry and observability provenance map

This provenance map inventories the worker's application traces, metrics, alert-related logs, and selected Grafana alert rules, reviewed on 2026-09-30. It connects each signal to its source, explains what it means in SecureBuild terms, and links alert rules to the telemetry they consume. Use it to follow a signal from its code definition to live Grafana data, or work backward from an alert to its inputs. Trace, metric, and log definitions come from source code; the alert inventory comes from live Grafana API configuration. The live-access section records successful Grafana MCP checks, not verification of every instrument, dashboard, or retention policy. A short Tempo history shows only the paths exercised during that window; this catalog also includes less frequent handlers and instrumentation outside the normal production path.

## Table of contents

- [Looking up live data through Grafana MCP](#looking-up-live-data-through-grafana-mcp)
  - [Metrics: current value or behavior over time](#metrics-current-value-or-behavior-over-time)
  - [Traces: find an operation, then inspect an example](#traces-find-an-operation-then-inspect-an-example)
  - [Using this map in an investigation](#using-this-map-in-an-investigation)
- [Entry points and telemetry plumbing](#entry-points-and-telemetry-plumbing)
- [Workflow vocabulary](#workflow-vocabulary)
- [Telemetry design guardrails](#telemetry-design-guardrails)
- [Trace inventory](#trace-inventory)
  - [Queue processing and handlers](#queue-processing-and-handlers)
  - [External-image dispatch and collection](#external-image-dispatch-and-collection)
  - [Library and alternate-path spans](#library-and-alternate-path-spans)
  - [Trace boundaries and error reporting](#trace-boundaries-and-error-reporting)
- [Metric inventory](#metric-inventory)
  - [Queue and SBOM generation](#queue-and-sbom-generation)
  - [External-image vulnerability scans](#external-image-vulnerability-scans)
  - [Capacity and outcome interpretation](#capacity-and-outcome-interpretation)
  - [Scan-generation object cleanup](#scan-generation-object-cleanup)
- [Log inventory](#log-inventory)
  - [Log format and Loki labels](#log-format-and-loki-labels)
  - [Stored external-image scan results](#stored-external-image-scan-results)
  - [CMX provisioning credit errors](#cmx-provisioning-credit-errors)
- [Image-build workflow and dashboard](#image-build-workflow-and-dashboard)
  - [Demand and local processing](#demand-and-local-processing)
  - [Image-build log inventory](#image-build-log-inventory)
  - [Coverage limits](#coverage-limits)
- [Grafana alert rules](#grafana-alert-rules)
  - [Shared configuration and interpretation](#shared-configuration-and-interpretation)
  - [securebuild-cmx-credits-prod](#securebuild-cmx-credits-prod)
  - [securebuild-external-image-scans-prod](#securebuild-external-image-scans-prod)
  - [Refreshing the alert inventory](#refreshing-the-alert-inventory)
- [Other existing diagnostic surfaces and gaps](#other-existing-diagnostic-surfaces-and-gaps)
- [Keeping this provenance map current](#keeping-this-provenance-map-current)

## Looking up live data through Grafana MCP

Grafana MCP access was verified from a Codex session on 2026-09-30: datasource discovery, a Prometheus instant query, and a Tempo trace search all succeeded. Future sessions should discover their available Grafana tools and call `list_datasources` to confirm access and datasource UIDs; the presence of this document does not guarantee that a connection is enabled in every session. Tool names may appear with a prefix such as `mcp__grafana__`.

| Data | Verified datasource UID | Worker selector | Verification scope |
| --- | --- | --- | --- |
| Prometheus metrics | `prometheus` | `job="securebuild-worker"` | Returned `securebuild_external_image_scan_running`, `securebuild_external_image_scan_capacity_total`, and `securebuild_external_image_sbom_backlog`. |
| Tempo traces | `tempo` | `resource.service.name = "securebuild-worker"` | Returned matching `listener.poll_scan_status` traces. |
| Loki logs | `loki` | `service_name="securebuild-worker", env="prod"` | Returned stored scan-result logs; a credit-error query returned no matches in the checked 15-minute window. See [log inventory](#log-inventory). |
| Pyroscope profiles | `pyroscope` | Discover labels before querying | Datasource listed; profile queries not tested in this check. |

### Metrics: current value or behavior over time

Use `query_prometheus` with `datasourceUid="prometheus"`. An instant query uses `queryType="instant"` and `endTime="now"`; for example:

```promql
securebuild_external_image_scan_running{job="securebuild-worker"}
```

For a trend, use the same expression with `queryType="range"`, `startTime="now-1h"`, `endTime="now"`, and `stepSeconds=60`. `list_prometheus_metric_names`, `list_prometheus_label_names`, and `list_prometheus_label_values` can help discover available series and dimensions. Inspect returned labels before combining instances, environments, tiers, or fleet/per-builder series; the verified `job` label alone does not establish a deployment environment.

Read the metric's inventory entry before choosing an expression: gauges describe state, while counter rates/increases describe events. Preserve labels needed to explain the result and check sample freshness. An empty result is not a zero value. The three metric names above were successfully queried together during the connectivity check; the single-metric and range examples illustrate follow-up queries.

### Traces: find an operation, then inspect an example

Use `search_tempo_traces` with `datasourceUid="tempo"` and this verified TraceQL query:

```traceql
{ resource.service.name = "securebuild-worker" && name = "listener.poll_scan_status" }
```

The tool defaults to the past hour when `start` and `end` are omitted. For a specific investigation, pass explicit RFC3339 timestamps with timezone offsets. Replace the span name with another entry from this catalog, then use `get_tempo_trace` with a returned trace ID to inspect its spans. Consult the current tool schema for arguments. Trace search results are a bounded set of examples, not necessarily a complete count or a representative latency distribution.

### Using this map in an investigation

Requests such as “Explain scan backlog by tier over the last hour” or “Show what `listener.poll_scan_status` is spending time on in recent traces” can start here: find the source definition and counting unit, query the corresponding datasource, and interpret the returned data using the caveats below. These lookups use read-only discovery and query tools.

When relaying findings, include the datasource, exact query, time window/timezone, relevant labels, and trace IDs where applicable. Separate what the code defines from what live data shows, and distinguish an individual example from a trend. Report connection/query failures explicitly rather than treating missing access or missing telemetry as evidence that no work occurred. Re-query for current values instead of treating the connectivity check as a lasting operational snapshot.

## Entry points and telemetry plumbing

- [RunCmd and runWorker](../cmd/cli/run.go) initialize telemetry with `securebuild-worker`, then start queue listeners, builder status pollers, scan scheduling, SBOM metrics reporting, and other background workers.
- [telemetry.go](../pkg/telemetry/telemetry.go) selects the backend with `TELEMETRY_BACKEND`: `otlp`, `datadog`, or disabled. An unset backend falls back to Datadog when `DD_ENABLED` is `true` or `1`; otherwise instrumentation is a no-op.
- [otel.go](../pkg/telemetry/otel.go) exports traces and metrics over OTLP/HTTP, using the `OTEL_EXPORTER_OTLP_*` environment variables. `OTEL_SERVICE_NAME` overrides `securebuild-worker`. Resource attributes can include deployment environment and service version; `DD_ENV` and `DD_VERSION` supply fallbacks. Traces use a batch exporter, and metrics use an SDK periodic reader. Application reporting intervals below are separate from export timing.
- [datadog.go](../pkg/telemetry/datadog.go) contains the backend-neutral metric constants despite its filename, plus the Datadog tracing and DogStatsD implementations. The queue gauge name is defined directly in [listener.go](../pkg/listener/listener.go).

The metric tables use the underscore names seen in Grafana. The code emits dotted names unchanged to OTLP; the monitoring pipeline determines their eventual Prometheus representation. The tables show both names to make source searches unambiguous. Counter names acquire `_total` in the observed naming convention, but a name ending in `_total` is **not necessarily a counter**: capacity totals and queue total are gauges.

## Workflow vocabulary

An **external image** is identified by digest and can have SBOMs and vulnerability results for multiple architectures. SBOM generation uses Syft on a builder; vulnerability scanning uses Grype against those SBOMs. Queue handlers dispatch these jobs asynchronously, and separate pollers collect their results. A completed queue message therefore does not imply the remote job has completed.

A **catalog image** is a SecureBuild catalog entry. Its scan handler scans stored SBOMs with both the standard Grype database for website results and the custom database used for vulnerability-feed data. These scans are distinct from the external-image builder scan pipeline and its capacity metrics. See [scan-catalog-image.go](../pkg/listener/scan-catalog-image.go).

A **scan generation** identifies a particular attempt to produce and publish scan results. Cleanup retires failed, abandoned, or superseded generation objects after their cleanup deadline, while protecting the selected results.

## Telemetry design guardrails

This section guides future instrumentation changes; it does not claim that the correlation features described here are already implemented. Use metrics for aggregate health and throughput, traces for execution paths, and logs for detailed events and outcomes.

**Keep metric dimensions bounded.** Each distinct metric label combination creates a separate time series. Image digests, request/trace IDs, scan-generation IDs, arbitrary image references, and raw error messages have unbounded or continually growing value sets. Do not add them as Prometheus labels, put them into dynamic metric names, or attach them to OTel metric resource attributes that the pipeline promotes to labels. Hashing an identifier or shortening its text does not meaningfully bound the number of distinct values. Query-time aggregation cannot undo the ingestion and storage cost.

For illustration, 100,000 digests reported across two architectures and three outcomes could produce 600,000 label combinations for a single metric, before deployment/instance dimensions. Actual series count depends on combinations emitted, and histogram exports can multiply the number of series further. A request to “see this image in metrics” should prompt an explanation of this cost and an alternative that answers the underlying question.

| Investigative need | Preferred instrumentation |
| --- | --- |
| Backlog, throughput, failures, capacity | Metrics with small, controlled value sets such as operation, architecture, tier, and categorized failure reason. Estimate combinations before adding dimensions. |
| Follow one image or scan generation | Digest and generation/operation identifiers in span attributes and structured log fields. Keep span names stable, such as `listener.external_image_scan`. |
| Connect a trace to its detailed events | Trace ID and span ID in log fields; configure backend correlation as needed. These IDs should not become metric labels or Loki stream labels. |
| Connect asynchronous dispatch and collection | Propagated trace context or span links, plus an operation identifier that distinguishes repeated work on the same digest. |
| Explain an individual failure | A bounded failure category for metrics, with useful error detail in logs/spans. |

Loki stream labels also need controlled cardinality: keep per-image and per-request identifiers in the log body or supported structured metadata. Span attributes and log fields still incur volume, indexing, and retention costs; include useful identifiers deliberately and never add credentials or secrets for correlation.

Existing `machine_id` capacity series are a specific per-builder diagnostic choice, not precedent for arbitrary identity labels. Assess their active fleet size and churn over retention when extending them. For any new metric dimension, document its expected value set, combined series count, and operational purpose. When a proposed label is unbounded, explain the tradeoff and use a trace/log-based design to preserve the user's investigative goal. The [trace boundaries](#trace-boundaries-and-error-reporting) and [log inventory](#log-inventory) describe the current limitations.

## Trace inventory

Start with the Tempo resource filter `resource.service.name = securebuild-worker` (or the configured service-name override). The names below are literal application span names.

### Queue processing and handlers

[`listener.process_messages_for_queue`](../pkg/listener/listener.go) wraps one queue claim/dispatch iteration in `processMessagesForQueue`. It starts **after waiting for worker capacity**, covers fetching/ranking/locking messages and dispatching handler goroutines, and does not wait for those handlers to finish. Attributes are `queue.channel`, `queue.available_workers`, and `queue.claimed_messages`. Its duration is not queue residence time or job execution time.

All the following handler spans are defined in [start.go](../pkg/listener/start.go), in the corresponding `Start…Listener` registration. Each wraps a handler invocation with `telemetry.WithSpan`. The queue channel is the span name without `listener.`; the wrapper itself adds no business identifiers as span attributes.

| Span | What the handler does / business meaning | Handler implementation |
| --- | --- | --- |
| `listener.create_package` | Imports a pending package definition and initiates its build workflow. | [create-package.go](../pkg/listener/create-package.go) |
| `listener.remove_package` | Processes package removal. | [remove-package.go](../pkg/listener/remove-package.go) |
| `listener.build_package` | Handles a package build request. | [build-package.go](../pkg/listener/build-package.go) |
| `listener.provision_vms` | Provisions architecture-specific VMs for a build execution. | [provision-vms.go](../pkg/listener/provision-vms.go) |
| `listener.build_package_chain` | Computes the dependency rebuild chain for a package change. | [build-package-chain.go](../pkg/listener/build-package-chain.go) |
| `listener.build_package_with_vms_assigned` | Starts package build work after builders have been assigned. | [build-package-with-vms-assigned.go](../pkg/listener/build-package-with-vms-assigned.go) |
| `listener.build_image` | Creates image build records and assigns/enqueues builder work for the image's APKO configurations. | [build-image.go](../pkg/listener/build-image.go) |
| `listener.build_image_with_vm_assigned` | Handles image build execution with an assigned builder. | [build-image-with-vm-assigned.go](../pkg/listener/build-image-with-vm-assigned.go) |
| `listener.build_apko` | Requests a build for one APKO configuration, including checking availability of a triggering package. | [build-apko.go](../pkg/listener/build-apko.go) |
| `listener.custom_build_request` | Processes a custom request and enqueues package/image builds. | [custom-build-request.go](../pkg/listener/custom-build-request.go) |
| `listener.scan_image` | Processes requested SecureBuild and/or canonical image scans, optionally limited to an image tag. | [scan-image.go](../pkg/listener/scan-image.go) |
| `listener.scan_catalog_image` | Refreshes a catalog entry's vulnerability results and feed data from stored SBOMs. | [scan-catalog-image.go](../pkg/listener/scan-catalog-image.go) |
| `listener.external_image_sbom` | Skips an existing SBOM or dispatches generation to a builder. Its completion usually means dispatch completed, not that an SBOM is available. | [external-image-sbom.go](../pkg/listener/external-image-sbom.go) |
| `listener.external_image_scan` | Handles an external-image scan request using builder dispatch. Its duration does not cover the detached Grype execution. | [external-image-scan-builder.go](../pkg/listener/external-image-scan-builder.go) |
| `listener.package_family_update_check` | Checks a package family for updates. | [package-family-update-check.go](../pkg/listener/package-family-update-check.go) |
| `listener.image_update_check` | Checks an image for updates. | [image-update-check.go](../pkg/listener/image-update-check.go) |
| `listener.github_sync` | Processes a GitHub synchronization request. | [github-sync.go](../pkg/listener/github-sync.go) |
| `listener.pipeline_sync` | Synchronizes package pipeline content. | [pipeline-sync.go](../pkg/listener/pipeline-sync.go) |
| `listener.image_pipeline_sync` | Synchronizes image pipeline content through the same handler. | [pipeline-sync.go](../pkg/listener/pipeline-sync.go) |

### External-image dispatch and collection

The scan and SBOM pollers run immediately and then sleep for 10 seconds **after each poll completes**. A slow poll therefore extends the start-to-start interval. Each poll inspects builders concurrently and also recovers work from builders that disappeared. These spans can be present even when no jobs complete.

| Span | Scope and interpretation | Definition |
| --- | --- | --- |
| `listener.dispatch_scan_to_builder` | Selects/reserves a builder, prepares scan files, and launches Grype asynchronously. | `dispatchScanToBuilder`, [external-image-scan-builder.go](../pkg/listener/external-image-scan-builder.go) |
| `listener.poll_scan_status` | One fleet-wide scan collection/recovery cycle. | `pollScanStatus`, [update-external-image-scan-status.go](../pkg/listener/update-external-image-scan-status.go) |
| `listener.process_builder_scans` | Inspects and processes one builder's scan directories. | `processBuilderScans`, [update-external-image-scan-status.go](../pkg/listener/update-external-image-scan-status.go) |
| `listener.process_completed_scans_batch` | Transfers completed Grype outputs in a tar archive, processes results locally, and cleans up. One span can cover many jobs and architectures. | `processCompletedScansBatch`, [update-external-image-scan-status.go](../pkg/listener/update-external-image-scan-status.go) |
| `listener.cleanup_scan_dirs_batch` | Removes multiple temporary scan directories from a builder. | `cleanupScanDirsBatch`, [update-external-image-scan-status.go](../pkg/listener/update-external-image-scan-status.go) |
| `listener.handle_successful_scan` | Reads and stores one architecture's successful Grype output in individual-directory processing. | `handleSuccessfulScan`, [update-external-image-scan-status.go](../pkg/listener/update-external-image-scan-status.go) |
| `listener.handle_failed_scan` | Reads stderr and records one architecture's failed/timed-out Grype execution. | `handleFailedScan`, [update-external-image-scan-status.go](../pkg/listener/update-external-image-scan-status.go) |
| `listener.cleanup_scan_dir` | Removes a single temporary builder scan directory. | `cleanupScanDir`, [update-external-image-scan-status.go](../pkg/listener/update-external-image-scan-status.go) |
| `listener.dispatch_sbom_download_to_builder` | Selects/reserves a builder, prepares files, and launches Syft asynchronously. | `dispatchSbomDownloadToBuilder`, [external-image-sbom-builder.go](../pkg/listener/external-image-sbom-builder.go) |
| `listener.poll_sbom_download_status` | One fleet-wide SBOM collection/recovery cycle. | `pollSbomDownloadStatus`, [update-external-image-sbom-status.go](../pkg/listener/update-external-image-sbom-status.go) |
| `listener.process_builder_sbom_downloads` | Inspects and processes one builder's SBOM download directories. | `processBuilderSbomDownloads`, [update-external-image-sbom-status.go](../pkg/listener/update-external-image-sbom-status.go) |
| `listener.process_completed_sbom_downloads_batch` | Transfers completed Syft outputs in bulk, stores results, and cleans up. | `processCompletedSbomDownloadsBatch`, [update-external-image-sbom-status.go](../pkg/listener/update-external-image-sbom-status.go) |
| `listener.cleanup_sbom_download_dirs_batch` | Removes multiple temporary SBOM directories from a builder. | `cleanupSbomDownloadDirsBatch`, [update-external-image-sbom-status.go](../pkg/listener/update-external-image-sbom-status.go) |
| `listener.handle_successful_sbom_download` | Reads and stores one architecture's SBOM in individual-directory processing. | `handleSuccessfulSbomDownload`, [update-external-image-sbom-status.go](../pkg/listener/update-external-image-sbom-status.go) |
| `listener.handle_failed_sbom_download` | Reads Syft stderr and records a failed/timed-out architecture download. | `handleFailedSbomDownload`, [update-external-image-sbom-status.go](../pkg/listener/update-external-image-sbom-status.go) |
| `listener.cleanup_sbom_download_dir` | Removes a single temporary builder SBOM directory. | `cleanupSbomDownloadDir`, [update-external-image-sbom-status.go](../pkg/listener/update-external-image-sbom-status.go) |

Individual result handlers are used for in-progress directories, timeout handling, and fallback when batch transfer cannot be used. Successful bulk collection need not produce a `handle_successful_*` span for each result. The `cleanup_*dir*` spans concern builder filesystems, not the object-storage cleanup metrics below.

### Library and alternate-path spans

| Span | Scope and production relevance | Definition |
| --- | --- | --- |
| `anchore.ScanSBOMForCVEs` | An in-process Grype library scan of one SBOM. Used by catalog scans; it does not instrument the detached Grype process on a builder. | `ScanSBOMForCVEs`, [scanner.go](../pkg/anchore/scanner.go) |
| `scan.ScanExternalImage` | In-process external-image scanning across stored SBOMs. The normal queue listener dispatches to builders instead. | `ScanExternalImage`, [scan.go](../pkg/scan/scan.go) |
| `listener.external_image_scan.store_results` | Parses and stores results in the alternate in-process scan flow. Normal builder collection uses `storeBuilderScanResult` instead. | `storeScanResults`, [external-image-sbom.go](../pkg/listener/external-image-sbom.go) |
| `sbom.FetchSBOM` | In-process SBOM acquisition/generation. Normal external-image SBOM handling dispatches to builders; the retained in-process handler is selected by an injected test function. | `FetchSBOM`, [sbom.go](../pkg/sbom/sbom.go) |

`RunScanForDigest` normally enqueues builder work; its in-process branch requires an injected scan function. Definitions in this last table therefore do not all imply expected production traffic.

### Trace boundaries and error reporting

- Queue handler goroutines use the original context, not the claim span's `claimCtx`. Do not expect handler spans to be children of `listener.process_messages_for_queue`. The queue machinery does not serialize/extract trace context with work items, and pollers start independently of dispatch; there is no single application span covering submission through remote completion.
- `WithSpan` marks returned handler errors. Manual spans only record errors where their implementation calls `SetTag`: the poller, dispatch, collection, and builder-directory cleanup spans generally only call `Finish`. A span named `handle_failed_scan` can consequently have an unset OTel error status even while it records a business failure. Check logs and stored status alongside Tempo.
- Most manual spans have no digest, architecture, or machine attributes. Those details are usually in logs. The queue claim attributes above are an exception.
- PostgreSQL operations have backend-specific instrumentation through [NewPgxPool](../pkg/telemetry/contrib.go), used by [persistence/pg.go](../pkg/persistence/pg.go). These library-generated spans supplement the explicit application inventory; their names are not fixed by worker call sites.

## Metric inventory

Types below come from the actual `Gauge`, `Increment`, or `Count` call, rather than the exported name. Labels listed are application-supplied labels; deployment/resource labels may be added by the pipeline.

### Queue and SBOM generation

| Grafana metric / source instrument | Type and labels | What it counts and business meaning | Emission site |
| --- | --- | --- | --- |
| `securebuild_worker_queue_total`<br>`securebuild.worker.queue.total` | Gauge; `channel` | All unfinished `work_queue` rows for a channel (`completed_at IS NULL`), including in-flight work and delayed retries. Outstanding queue obligations, not just immediately runnable work. | `fetchAndLockMessages`, [listener.go](../pkg/listener/listener.go) |
| `securebuild_external_image_sbom_backlog`<br>`securebuild.external_image.sbom.backlog` | Gauge; none | The same unfinished-row predicate specifically for `external_image_sbom`. Requests still awaiting completion of the queue handler; remote Syft work may continue after this falls. | `ReportDownloadMetrics`, [sbom_download_capacity.go](../pkg/sbom/sbom_download_capacity.go) |
| `securebuild_external_image_sbom_download_capacity_total`<br>`securebuild.external_image.sbom_download.capacity.total` | Gauge; none | Eligible running builders × `MaxSbomDownloadsPerBuilder`. Configured concurrent SBOM job slots, not bytes/sec or CPU capacity. | `ReportDownloadCapacityMetrics`, [sbom_download_capacity.go](../pkg/sbom/sbom_download_capacity.go) |
| `securebuild_external_image_sbom_download_capacity_used`<br>`securebuild.external_image.sbom_download.capacity.used` | Gauge; fleet series without labels, plus `machine_id` series | Reserved/occupied SBOM slots from the cache's counts map. Indicates how much dispatch capacity has been committed. | `ReportDownloadCapacityMetrics`, [sbom_download_capacity.go](../pkg/sbom/sbom_download_capacity.go) |
| `securebuild_external_image_sbom_downloads_running`<br>`securebuild.external_image.sbom.downloads_running` | Gauge; none | Active download entries in the cache's directory map, summed across builders. One digest directory can contain multiple architecture jobs; this is not a Syft process count. | `ReportDownloadMetrics` / `GetTotalActiveDownloadCount`, [sbom_download_capacity.go](../pkg/sbom/sbom_download_capacity.go) |
| `securebuild_external_image_sbom_failed_total`<br>`securebuild.external_image.sbom.failed` | Counter; `channel=external_image_sbom`, `reason` | Explicit non-retryable SBOM failure events, plus the missing-external-image case. Builder failures can be recorded per architecture. Does not count every retry, returned error, or distinct failed digest. | `recordSBOMFailure` and `HandleExternalImageSbom`, [external-image-sbom.go](../pkg/listener/external-image-sbom.go); calls from [SBOM poller](../pkg/listener/update-external-image-sbom-status.go) |
| `securebuild_external_image_sbom_succeeded_total`<br>`securebuild.external_image.sbom.succeeded` | Counter; `channel=external_image_sbom` | On the production builder path, increments for **each architecture SBOM successfully stored**. A two-architecture image can add two. Skipping an already-existing SBOM adds nothing. Alternate in-process paths also increment on digest-level success. | `storeBuilderSbomResult`, [external-image-sbom-builder.go](../pkg/listener/external-image-sbom-builder.go); alternate sites in [external-image-sbom.go](../pkg/listener/external-image-sbom.go) |

The SBOM reporter emits immediately at startup and every minute. Queue total is emitted opportunistically during queue fetching, after capacity is available and the statistics query succeeds; it is not an independent periodic reporter. The SBOM backlog and `queue_total{channel="external_image_sbom"}` measure the same database population at different times.

### External-image vulnerability scans

| Grafana metric / source instrument | Type and labels | What it counts and business meaning | Emission site |
| --- | --- | --- | --- |
| `securebuild_external_image_scan_backlog`<br>`securebuild.external_image.scan.backlog` | Gauge; `tier` | Distinct digests with SBOMs that are never scanned or older than a tier's rescan threshold. Security-result freshness debt, not `work_queue` length. | `ReportScanMetrics`, [scan.go](../pkg/scan/scan.go) |
| `securebuild_external_image_scan_capacity_total`<br>`securebuild.external_image.scan.capacity.total` | Gauge; none | Eligible running builders × `MaxScansPerBuilder`. Configured concurrent external-image scan slots. | `ReportCapacityMetrics`, [scan_capacity.go](../pkg/scan/scan_capacity.go) |
| `securebuild_external_image_scan_capacity_used`<br>`securebuild.external_image.scan.capacity.used` | Gauge; fleet series without labels, plus `machine_id` series | Reserved/occupied scan slots from the cache's counts map. Measures committed dispatch capacity. | `ReportCapacityMetrics`, [scan_capacity.go](../pkg/scan/scan_capacity.go) |
| `securebuild_external_image_scan_running`<br>`securebuild.external_image.scan.running` | Gauge; none | Active scan-directory entries in the cache, summed across builders. Counts digest jobs, not architecture processes or database rows with `status='running'`. | `ReportScanMetrics` / `GetTotalActiveScanCount`, [scan.go](../pkg/scan/scan.go), [scan_capacity.go](../pkg/scan/scan_capacity.go) |
| `securebuild_external_image_scan_failed_total`<br>`securebuild.external_image.scan.failed` | Counter; `channel=external_image_scan`, `reason` | Non-retryable failure-recording events, normally per digest/architecture. Includes execution, parsing, and publication-related failure paths that call `recordScanFailure`; not every infrastructure error. | `recordScanFailure`, [external-image-sbom.go](../pkg/listener/external-image-sbom.go); calls from [scan poller](../pkg/listener/update-external-image-scan-status.go) |
| `securebuild_external_image_scan_succeeded_total`<br>`securebuild.external_image.scan.succeeded` | Counter; `channel=external_image_scan` | **Defined but emitted only in the alternate in-process scan path**, when all expected architecture results are present and stored. The normal builder collection path does not increment it. It is not currently a production scan-throughput counterpart to `scan_failed_total`. | `runScanForDigestInProcess`, [external-image-sbom.go](../pkg/listener/external-image-sbom.go) |

The [scan scheduler](../pkg/scan/scheduler.go) emits backlog, running, and capacity gauges immediately and every minute. The tier definitions and backlog SQL are in [scan.go](../pkg/scan/scan.go):

| `tier` | Population / submission recency | Scan age threshold |
| --- | --- | --- |
| `never_scanned` | SBOM rows with `last_security_scanned_at IS NULL`, counted by distinct digest | No previous scan |
| `active` | A tag submitted less than 7 days ago | Older than 4 hours |
| `recent` | A tag submitted at least 7 but less than 30 days ago | Older than 12 hours |
| `stale` | A tag submitted at least 30 but less than 90 days ago | Older than 24 hours |
| `inactive` | A tag submitted at least 90 days ago | Older than 24 hours |

The backlog queries do **not** apply the scheduler's recent-failure and running-scan exclusions. A digest may therefore remain in backlog while running or in failure backoff. They also classify using matching tag rows, rather than assigning each digest one exclusive tier: different tags for a digest can land it in multiple tiers. Architecture SBOM rows can also differ in scan timestamp. Summing all tiers is not a guaranteed unique-digest total.

### Capacity and outcome interpretation

Both capacity totals use [GetRunningBuildersForScan](../pkg/scan/scan_capacity.go): `machine_pool.status='running'`, no cleanup lock, and `is_on_demand=false`. Builders with an existing build assignment are still included. These totals describe configured slots on eligible shared builders, not a resource-isolated guarantee of throughput.

Both caches reserve slots before dispatch, add directory entries on dispatch, and reconcile with builder filesystem observations during polling. Consequently, `capacity_used` can temporarily differ from `running`; neither is an instantaneous OS process census. Completed directories are excluded when the poller refreshes its active list. See [scan cache](../pkg/scan/scan_capacity.go), [SBOM cache](../pkg/sbom/sbom_download_capacity.go), and the two poller implementations above.

For each `capacity_used` metric, choose either the fleet series **without `machine_id`** or the per-builder series. Summing both double-counts capacity. With multiple worker replicas, database-wide gauges may also repeat the same population, while caches are process-local views: inspect instance/resource labels before aggregating across workers.

Failure labels are generated by [ReasonForDatadogMetric](../pkg/externalimage/errors.go), used by both backends: `external_image_not_found`, `failed_to_fetch_sbom`, `no_sbom_data_available`, `failed_to_parse_scan_result`, `failed_to_marshal_scan_counts`, `failed_to_marshal_scan_summary`, `failed_to_save_scan_status`, `no_scan_result_for_arch`, `scan_execution_failed`, and fallback `unknown`. Not every reason occurs for both counters. Digest and architecture are not counter labels. A counter increment records an event, not necessarily a successfully persisted state transition: failure recording can log a database error and still increment.

Counters are created lazily when emitted. Absence of a series is not proof of zero events, and counter resets follow process lifetime. Use rates/increases for event volume; compare the underlying units before calculating a success ratio, particularly across the alternate and builder paths.

### Scan-generation object cleanup

All six instruments below are emitted by [cleanup.go](../pkg/externalimage/cleanup.go). They concern **generation objects in object storage**, not temporary scan directories on builders, SBOM objects, or legacy scan objects. Legacy retirement has its own loop and logs; see [legacy-scan-cleanup.md](legacy-scan-cleanup.md).

| Grafana metric / source instrument | Type / unit | Exact population and business meaning | Function |
| --- | --- | --- | --- |
| `securebuild_external_image_scan_cleanup_pending`<br>`securebuild.external_image.scan.cleanup.pending` | Gauge / generation rows | Rows in `external_image_scan_generation` with `cleanup_after IS NOT NULL` and `state != 'selected'`. All scheduled cleanup, including future deadlines. | `reportScanCandidateCleanupMetrics` |
| `securebuild_external_image_scan_cleanup_pending_bytes`<br>`securebuild.external_image.scan.cleanup.pending_bytes` | Gauge / bytes | Sum of recorded `raw_size_bytes + details_size_bytes` for the pending population. Storage bytes represented by cleanup metadata, not a live bucket size measurement. | `reportScanCandidateCleanupMetrics` |
| `securebuild_external_image_scan_cleanup_overdue`<br>`securebuild.external_image.scan.cleanup.overdue` | Gauge / generation rows | Pending rows whose `cleanup_after <= NOW()`. Cleanup currently due. | `reportScanCandidateCleanupMetrics` |
| `securebuild_external_image_scan_cleanup_oldest_overdue_seconds`<br>`securebuild.external_image.scan.cleanup.oldest_overdue_seconds` | Gauge / seconds | Time since the earliest currently overdue `cleanup_after`, or zero if none. Age of the oldest due cleanup deadline. | `reportScanCandidateCleanupMetrics` |
| `securebuild_external_image_scan_cleanup_deleted_total`<br>`securebuild.external_image.scan.cleanup.deleted` | Counter / generation rows | Metadata rows successfully deleted after object deletion. One generation row can represent two object keys; this is not an object count. | `StartScanCandidateCleanup` reports `stats.deleted` from `cleanupExternalImageScanCandidateBatch` |
| `securebuild_external_image_scan_cleanup_failed_total`<br>`securebuild.external_image.scan.cleanup.failed` | Counter / candidate-row failure events | Candidate/deletion rows affected by claim, object-store, deletion, or metadata-checkpoint failures as accounted by the batch. Retries can count the same row again; some early errors have no candidate count and only produce logs. | `StartScanCandidateCleanup` reports `stats.failed` from `cleanupExternalImageScanCandidateBatch` |

These metrics have no application labels. Cleanup runs immediately and every minute with a 45-second run budget and batches of at most 500 rows; gauges are reported after initial cleanup and every five minutes. Counters are added after cleanup passes, with zero additions skipped.

Claims move `cleanup_after` to a five-minute retry lease. A claimed row can temporarily leave the overdue population without being deleted, and oldest-overdue age reflects the current deadline, not total time since the original retirement decision. Pending count/bytes plus deletion/failure activity provide more context than overdue alone.

## Log inventory

This catalogs the log signals consumed by the two [Loki-dependent alert rules](#grafana-alert-rules), not every worker log statement. Source locations below were checked on 2026-09-30; line anchors are conveniences, while function and message names identify the call sites as code moves.

### Log format and Loki labels

[logger.go](../pkg/logger/logger.go) writes a custom console format to stdout: time, level, `[package/file.go:line]`, message, then key/value fields. `zap.AddCallerSkip(1)` makes the caller point to the application logging call rather than the logger wrapper; `TrimmedPath()` produces paths such as `listener/update-external-image-scan-status.go:337`. `logger.Error(err)` emits the message `error` and puts the wrapped error text in an `error` field. These are not JSON log lines.

Loki stream labels `service_name` and `env` are deployment/ingestion metadata, not fields added by these application call sites. A live check confirmed `{service_name="securebuild-worker",env="prod"}` returns the scan-result logs below. Digest and architecture are fields in the line, not stream labels in the returned samples. The alert queries use literal substring filters, without parsing those fields or selecting a log level.

Use `query_loki_logs` with `datasourceUid="loki"`, an explicit bounded time window, and either selector below to inspect examples. For event counts, use the alert's `count_over_time` query with `queryType="instant"`; a limited sample of log lines is not a total. Message wording, source-file moves, logger formatting, log-level settings, and ingestion configuration can all affect these signals.

### Stored external-image scan results

**Signal:** INFO message `stored scan result`, with `digest` and `arch` string fields. **Consumer:** [SecureBuildExternalImageScanProcessingStalled](#securebuild-external-image-scans-prod), which looks for absence of this signal while backlog is high.

| Exact source | When emitted | Unit / business meaning |
| --- | --- | --- |
| `processCompletedScansBatch`, [update-external-image-scan-status.go:337](../pkg/listener/update-external-image-scan-status.go#L337) | For an architecture with exit code zero and nonempty Grype JSON, after `storeBuilderScanResult` returns successfully during batch collection. | One architecture's vulnerability result was successfully processed and stored by the collector. |
| `handleSuccessfulScan`, [update-external-image-scan-status.go:560](../pkg/listener/update-external-image-scan-status.go#L560) | After reading nonempty Grype output and successfully calling the same storage helper during individual-directory processing. | The same event on the individual/fallback collection path. |

Both call [storeBuilderScanResult](../pkg/listener/external-image-scan-builder.go#L340), which parses results, builds summaries, and calls `SetExternalImageScanStatus` with succeeded status and generation identity. Successful generation publication is implemented in [publication.go](../pkg/externalimage/publication.go). These messages occur after storage succeeds, not merely when Grype starts or exits. They do not establish that every architecture of a digest has completed, and repeated collection is not deduplicated by the log query.

Exact line selector used by the alert:

```logql
{service_name="securebuild-worker",env="prod"}
  |= "listener/update-external-image-scan-status.go:"
  |= "stored scan result"
```

The filename filter matches both call sites without fixing the line number. It excludes `stored scan result for architecture` in the [alternate in-process path](../pkg/listener/external-image-sbom.go#L291). It also excludes other success messages such as SBOM storage. Corresponding spans are [`listener.process_completed_scans_batch` and `listener.handle_successful_scan`](#external-image-dispatch-and-collection). This log signal supplies production completion evidence that [`securebuild_external_image_scan_succeeded_total`](#external-image-vulnerability-scans) currently does not provide on the builder path.

**Live verification:** a bounded Loki query on 2026-09-30 returned two examples at 18:03:36–18:03:37 UTC, both from `listener/update-external-image-scan-status.go:337`, with `arch=aarch64` and `arch=x86_64`. The individual call site is source-confirmed but was not observed in that two-line sample. Illustrative shape, with the digest replaced:

```text
18:03:37  INFO   [listener/update-external-image-scan-status.go:337] stored scan result  digest=sha256:<digest> arch=x86_64
```

Setting worker `LogLevel` to `warn` or `error` suppresses these INFO messages. The [stalled rule](#securebuild-external-image-scans-prod) can then see zero progress even while scans succeed, just as it can during a log-ingestion gap.

### CMX provisioning credit errors

**Signal:** a worker log line containing `Request exceeds available credits`. **Consumer:** [SecureBuildCMXCreditsExhausted](#securebuild-cmx-credits-prod).

The exact phrase is **upstream response text**, not a string literal defined in this checkout. The code path carrying it is identifiable: [provisionVM](../pkg/builder/pool.go#L1541) POSTs to `<ReplicatedAPIOrigin>/v3/vm`, reads the response body, and returns `bad request: <body>` for HTTP 400 or `unexpected status code: <status>, response: <body>` for other non-success responses. Thus a CMX rejection body containing the phrase is preserved into the following log emitters.

| Exact source | Message/error shape | Trigger and business meaning |
| --- | --- | --- |
| `CreatePool` initial provisioning, [pool.go:420](../pkg/builder/pool.go#L420) | ERROR; message `error`, field `error=failed to provision VM for <arch>: <wrapped API error>` | Initial pool fill could not create a builder for `x86_64` or `aarch64`. |
| `CreatePool` maintenance goroutine, [pool.go:502](../pkg/builder/pool.go#L502) | Same ERROR shape | Pool replenishment could not create a missing builder. The architecture's provisioning loop breaks on failure and can try again on a later maintenance tick. |
| `StartProvisionVMsListener` handler wrapper, [start.go:130](../pkg/listener/start.go#L130) | ERROR; message `error`, field `error=failed to handle provision vms notification: failed to provision <arch> VM: <wrapped API error>` | An on-demand build's architecture-specific VM request failed. [handleProvisionVMs](../pkg/listener/provision-vms.go) calls `ProvisionVMForBuild`, which wraps `provisionVM`, and returns the error to this logger. |

The pool logs put the architecture in the error text rather than a separate `architecture` field. The on-demand path has nearby INFO logs with `executionID` and `diskSizeGB`, but those are separate events, not fields automatically attached to the ERROR. The [CMX backend's `acquireOnDemand`](../pkg/buildbackend/cmx.go) also propagates errors from `ProvisionVMForBuild` to its callers, so the three emitters above are confirmed paths, not an exhaustive list of places the phrase could surface.

Exact line selector used by the alert:

```logql
{service_name="securebuild-worker", env="prod"}
  |= "Request exceeds available credits"
```

Unlike the stored-result selector, this has **no caller-path or severity filter**: any matching line in the selected worker streams contributes. Repeated attempts and error propagation can generate multiple lines for the same underlying credit shortage. The count is neither distinct rejected VMs nor remaining credits. Source code confirms how a matching response would reach logs; it does not determine CMX's exact error response schema or status code.

**Live verification limit:** the same 2026-09-30 check found no matching credit-error lines during 17:48:37–18:03:37 UTC. No specific deployed credit-error caller was confirmed from that window. The source-confirmed emitters above remain useful for tracing the alert, but absence of recent matches does not establish a healthy balance or successful provisioning. See [CMX alert semantics](#securebuild-cmx-credits-prod) and [builder capacity interpretation](#capacity-and-outcome-interpretation).

## Image-build workflow and dashboard

The [image-build service-level dashboard](https://monitoring.repldev.com/d/jov8hkx/service-levels-sb-image-builds) uses existing queue gauges and log events. Handler spans are documented below for separate diagnostic use. It is separate from the [external-image scan dashboard](https://monitoring.repldev.com/d/jo7bqvd/service-levels-sb-external-image-scans). Queries and source semantics below were checked on 2026-09-30; no application instrumentation was added.

The production line is **request → configuration build record and VM assignment → background build launch → result collection and catalog publication**. An image may have multiple APKO configurations, tags, and architectures. The launch and publication logs below count configuration-build events, not unique images, tags, or architecture results. Package builds are a separate workflow.

### Demand and local processing

Use the existing [queue gauge](#queue-and-sbom-generation), selecting each channel separately:

```promql
securebuild_worker_queue_total{job="securebuild-worker",channel="build_apko"}
```

| Channel | Meaning | Source |
| --- | --- | --- |
| `build_image` | Request to build all APKO configurations of an image; one request may create several build records. | [handleBuildImage](../pkg/listener/build-image.go) |
| `build_apko` | Request for one APKO configuration, including package-triggered rebuilds. | [handleBuildAPKO](../pkg/listener/build-apko.go) |
| `build_image_with_vm_assigned` | Assigned-builder launch request. Completion of this handler does not mean the background build or publication completed. | [HandleBuildImageWithVMAssigned](../pkg/listener/build-image-with-vm-assigned.go) |

Each count includes in-flight handlers and delayed retries. Stages can overlap during handoff; their sum is not a distinct-build backlog. The gauge is emitted when the listener fetches work, after waiting for handler capacity. A flat exported series can reflect an old application observation. Queue depth is neither arrival rate nor a census of all unpublished builds.

The existing [handler spans](#queue-processing-and-handlers) cover these same three channels. For a focused investigation of local launch handling, use:

```traceql
{ resource.service.name = "securebuild-worker" && resource.env = "prod" && name = "listener.build_image_with_vm_assigned" } | quantile_over_time(duration, .95)
```

This covers lookup, preparation, dispatch, and error paths, **not** queue residence, detached VM execution, collection, or publication. Sparse spans can leave a percentile unavailable or based on very few observations. The local-handler duration row was removed from the image-build dashboard; this query remains available for diagnosis. Do not interpret it as customer delivery latency.

### Image-build log inventory

Use Loki `{service_name="securebuild-worker",env="prod"}` and filename filters without fixed line numbers. `buildID`, `apkoID`, `vmID`, and image names are log fields for investigation, not Prometheus labels or Loki stream labels.

| Event | Level, fields, and exact emitter | What it establishes |
| --- | --- | --- |
| `IMAGE BUILD JOB STARTED - monitoring process will handle completion` | INFO; `buildID`, `apkoID`, `vmID`; [HandleBuildImageWithVMAssigned](../pkg/listener/build-image-with-vm-assigned.go), after `buildAndPushAPKOWithVM` returns successfully. | A background build was launched. Not incoming demand or successful output. |
| `IMAGE BUILD COMPLETED successfully` | INFO; `buildID`, `imageName`; `processImageBuildResults` in [update-build-image-status.go](../pkg/listener/update-build-image-status.go), after `PublishCatalogImage` succeeds. | Result processing and required catalog publication reached the success log. This occurs before the caller persists the final build success status; timestamp-write failures only warn. Does not prove customer consumption. |
| `IMAGE BUILD FAILED:` message prefix | WARN; fields vary, generally including `buildID`; [build-image.go](../pkg/listener/build-image.go), [build-apko.go](../pkg/listener/build-apko.go), [build-image-with-vm-assigned.go](../pkg/listener/build-image-with-vm-assigned.go), and [update-build-image-status.go](../pkg/listener/update-build-image-status.go). | Selected VM-assignment, launch, VM-loss, missing-status-file, and timeout failure reports. **Incomplete failure coverage**: failed remote status and result-processing errors can mark a build failed without this prefix. Not a failure counter or success-rate denominator. |

Dashboard log-event stats show **total counts within the dashboard-selected time range**, evaluated at its end. Their matching charts show **non-overlapping 5-minute event-count bars**, using `[5m]` with an explicit Loki query `step="5m"`. Bars represent the interval preceding each timestamp. At range edges, buckets may straddle the boundary or omit the final partial interval, so use the stat for the exact selected-period count. Neither is a per-minute rate. For the publication stat:

```logql
sum(count_over_time({service_name="securebuild-worker",env="prod"}
  |= "listener/update-build-image-status.go:"
  |= "IMAGE BUILD COMPLETED successfully" [$__range]))
```

For the publication chart, replace `[$__range]` with `[5m]` and set the query step to `5m`. For launches, substitute filename `listener/build-image-with-vm-assigned.go:` and the full launch message above. Failure-report stats use the following query, with the same window substitution and step for their chart:

```logql
sum(count_over_time({service_name="securebuild-worker",env="prod"}
  |~ "listener/(build-image|build-apko|build-image-with-vm-assigned|update-build-image-status)\\.go:"
  |= "IMAGE BUILD FAILED:" [$__range]))
```

These are event counts without build-ID deduplication; retries/repeated collection may contribute more than once. No matching events and missing telemetry cannot be distinguished by these queries alone. The dashboard displays **No observations**, keeps gaps, and does not force absent series to zero. Live checks over approximately 16:36–22:36 UTC on 2026-09-30 returned all three queue channels and launch, publication, and failure-report events; recent 15-minute windows can be empty.

### Coverage limits

The dashboard does not establish incoming request rate, total unfinished builds across all stages, running remote builds, per-build elapsed time, queue-wait p95, end-to-end p95, or an SLA/success percentage. Subtracting launch and publication rates cannot reconstruct those populations because windows cross build boundaries and failure/retry coverage is incomplete. [Scan-slot totals](#capacity-and-outcome-interpretation) are not image-build capacity and are deliberately not reused. No arbitrary health thresholds are assigned.

## Grafana alert rules

These five rules were read from Grafana on 2026-09-30 using Grafana MCP, including each rule's full query/condition configuration and both provisioning rule-group endpoints. They live in the **SecureBuild** folder (UID `ffq0j8zaypo1sa`) on [Grafana](https://monitoring.repldev.com/alerting/list). This section is a configuration snapshot, not a declaration of current alert state or an inventory of every Grafana alert. No rules were changed.

### Shared configuration and interpretation

Both groups evaluate every **60 seconds**. All five rules were enabled (`is_paused=false`), use `no_data_state=OK`, `exec_err_state=KeepLast`, and `keep_firing_for=0s`. `for` below is the time the condition must remain true before firing, separate from a query's lookback window. A `for=0s` rule fires at the first qualifying evaluation, not immediately when an event occurs between evaluations.

`OK` maps no-data results to a normal state; `KeepLast` preserves the prior state on evaluation errors. Several queries use comparisons without `bool`, filtering out non-matching values entirely. Consequently, **Normal (NoData) can be the expected non-breaching result**, but may also conceal missing input. Do not interpret it as proof of telemetry health. The dedicated missing-metrics rule covers backlog-tier presence, not all metric or log ingestion failures.

All rules carry `team=securebuild` and `env=prod`. CMX uses `component=securebuild-worker`; the scan group uses `component=external-image-scans`. Severity is listed per rule. Importantly, the **Prometheus selectors filter only `job="securebuild-worker"`**, whereas Loki explicitly filters `env="prod"`. An alert's `env=prod` label does not constrain its input series; verify datasource/environment scope if deployments share the Prometheus datasource. Notification routing/contact points were not inspected.

### securebuild-cmx-credits-prod

| Rule | Severity / pending period | Inputs and condition | Business interpretation |
| --- | --- | --- | --- |
| [SecureBuildCMXCreditsExhausted](https://monitoring.repldev.com/alerting/grafana/sb-cmx-credits-exhausted-prod/view)<br>UID `sb-cmx-credits-exhausted-prod` | Critical; `for=0s` | Loki `loki`: at least one [CMX credit-error log](#cmx-provisioning-credit-errors) in the previous 5 minutes. Query A below; Grafana threshold B tests `A > 0`. | CMX is rejecting provisioning for insufficient credits. Detects an actual provisioning failure, not a low-balance forecast or credit-balance metric. |

Exact query A (instant LogQL; configured relative query range is 600 seconds, while the event-count window is `[5m]`):

```logql
sum(count_over_time(
  {service_name="securebuild-worker", env="prod"}
  |= "Request exceeds available credits"
  [5m]
)) > 0
```

There is **no direct Prometheus dependency**. The [CMX log inventory](#cmx-provisioning-credit-errors) traces the upstream response through the provisioning code to its log emitters. The rule's runbook annotation calls for checking production worker logs and CMX balance, replenishing credits, then verifying ARM/x86 provisioning and queued work recovery. Resolution only means the matching log signal is absent; it does not confirm restored credits or successful provisioning, especially if provisioning attempts or log ingestion stop.

For downstream impact, inspect [scan capacity and running jobs](#external-image-vulnerability-scans), [SBOM capacity and backlog](#queue-and-sbom-generation), and [capacity interpretation](#capacity-and-outcome-interpretation). Those metrics help diagnosis but are not inputs to this rule.

### securebuild-external-image-scans-prod

All four rules depend on [`securebuild_external_image_scan_backlog`](#external-image-vulnerability-scans), whose definition and tier table are above. The stalled rule additionally depends on Loki logs. None directly queries the scan-running, capacity, failed, or succeeded metrics.

| Rule | Severity / pending period | Inputs and firing condition | Business interpretation |
| --- | --- | --- | --- |
| [SecureBuildExternalImageScanBacklogHigh](https://monitoring.repldev.com/alerting/grafana/sb-ext-scan-backlog-high-prod/view)<br>UID `sb-ext-scan-backlog-high-prod` | Warning; `for=30m` | Prometheus A: sum of backlog series **> 10,000**; threshold B: `A > 0`. | Sustained scan freshness debt. |
| [SecureBuildExternalImageScanBacklogCritical](https://monitoring.repldev.com/alerting/grafana/sb-ext-scan-backlog-critical-prod/view)<br>UID `sb-ext-scan-backlog-critical-prod` | Critical; `for=0s` | Prometheus A: sum of backlog series **> 25,000**; threshold B: `A > 0`. | Large backlog requiring attention at the next evaluation. |
| [SecureBuildExternalImageScanProcessingStalled](https://monitoring.repldev.com/alerting/grafana/sb-ext-scan-stalled-prod/view)<br>UID `sb-ext-scan-stalled-prod` | Critical; `for=5m` | Prometheus A: backlog sum. Loki C: [stored-result log](#stored-external-image-scan-results) count over 15 minutes. Math B: `($A > 1000) && ($C == 0)`. | Material outstanding scan demand with no observed result-storage progress. |
| [SecureBuildExternalImageScanMetricsMissing](https://monitoring.repldev.com/alerting/grafana/sb-ext-scan-metrics-missing-prod/view)<br>UID `sb-ext-scan-metrics-missing-prod` | Warning; `for=0s` | Prometheus A: number of expected backlog tiers missing samples over 10 minutes, filtered to **> 0**; threshold B: `A > 0`. | Backlog telemetry is incomplete, weakening the other scan alerts. |

Exact PromQL A for **BacklogHigh**:

```promql
sum(securebuild_external_image_scan_backlog{job="securebuild-worker"}) > 10000
```

Exact PromQL A for **BacklogCritical**:

```promql
sum(securebuild_external_image_scan_backlog{job="securebuild-worker"}) > 25000
```

Both sums include every tier, including `never_scanned`, and any other series matching the job selector. As described in the [backlog inventory](#external-image-vulnerability-scans), tiers can overlap by digest and include work already running or in failure backoff. These thresholds apply to the configured sum, not a guaranteed count of distinct waiting images. The 30-minute warning period requires sustained threshold breach; it is not a 30-minute moving average.

Exact queries for **ProcessingStalled**:

```promql
# A — datasource prometheus
sum(securebuild_external_image_scan_backlog{job="securebuild-worker"})
```

```logql
# C — datasource loki
sum(count_over_time({service_name="securebuild-worker",env="prod"} |= "listener/update-external-image-scan-status.go:" |= "stored scan result" [15m])) or vector(0)
```

Grafana math expression B is `($A > 1000) && ($C == 0)`. The [stored-result log inventory](#stored-external-image-scan-results) identifies both exact call sites, their fields, storage semantics, and a verified Loki example. These are architecture-level events, not unique completed digests. The caller-path filter depends on the [log format](#log-format-and-loki-labels) and source filename.

`or vector(0)` makes an empty matching-log result count as zero. Thus missing logs can trigger the stalled condition even if scans are succeeding; a Loki query error is handled separately by `KeepLast`. Running jobs alone do not establish completion. The query uses stored-result logs rather than [`securebuild_external_image_scan_succeeded_total`](#external-image-vulnerability-scans), which the normal builder path does not emit. The 15-minute absence window must coexist with backlog above 1,000 for another 5 minutes of evaluations before firing.

Exact PromQL A for **MetricsMissing**:

```promql
(5 - (count(count by (tier) (count_over_time(securebuild_external_image_scan_backlog{job="securebuild-worker",tier=~"never_scanned|active|recent|stale|inactive"}[10m]))) or vector(0))) > 0
```

This counts how many of the five expected tier labels have any samples in the preceding 10 minutes, subtracts from five, and returns a positive missing-tier count. If all series are absent, the fallback yields five missing tiers. One sample per tier anywhere in that window suffices; it does not require every worker replica to report or detect incorrect gauge values. The [minute reporting cadence](#external-image-vulnerability-scans) provides context for that 10-minute tolerance.

All scan-group datasource queries are instant queries with a configured relative range of 900 seconds; the explicit `[15m]` and `[10m]` selectors determine their log-count and sample-presence windows. Grafana's configured relative range does not turn the backlog instant queries into averages.

The rule annotations point to the [external-image scan dashboard](https://monitoring.repldev.com/d/sb-external-image-scans): panel 1 for both backlog rules and panel 3 for stalled processing. All four reference an [external monitoring-repository runbook](https://github.com/replicatedhq/replicated-monitoring/blob/main/docs/securebuild-external-image-scan-metrics.md#responding-to-alerts). These are references retrieved from the alert configuration; the dashboard queries and external runbook content were not audited here. For local diagnostic context, use [scan capacity, running, and failure metrics](#external-image-vulnerability-scans) and the [CMX credit alert](#securebuild-cmx-credits-prod).

### Refreshing the alert inventory

Use `alerting_manage_rules` with `operation="list"` and `rule_group` set to either group name above, then `operation="get"` with each returned `rule_uid`. Read the full `data` query models, `condition`, `for`, no-data/error handling, labels, and annotations rather than relying on a rule title or rendered alert description. Rendered annotations can retain historical values and are not a current metric query.

The group evaluation intervals were verified with read-only `grafana_api_request` calls (`method="GET"`) to:

```text
/api/v1/provisioning/folder/ffq0j8zaypo1sa/rule-groups/securebuild-cmx-credits-prod
/api/v1/provisioning/folder/ffq0j8zaypo1sa/rule-groups/securebuild-external-image-scans-prod
```

Re-list rules to discover additions or removals, and update this section's review date when refreshing. For an operational investigation, query the underlying metrics/logs for the relevant time window instead of treating this configuration snapshot as evidence that an alert is currently firing or resolved.

## Other existing diagnostic surfaces and gaps

- **Runtime metrics:** [otel.go](../pkg/telemetry/otel.go) starts Go runtime instrumentation (memory, GC, goroutines, etc.); [datadog.go](../pkg/telemetry/datadog.go) enables Datadog runtime metrics. Their exact exported series are dependency/backend-defined, outside the application metric list above.
- **Logs:** [logger.go](../pkg/logger/logger.go) writes structured fields in a custom console format to stdout, with level set from worker `LogLevel`. Queue status logs contain `channel`, `total`, `in_flight`, `available`, and `oldest_message_created_at` when present; only `total` is emitted as a metric. Scan/SBOM logs add digest, architecture/platform, machine, generation, retry, and failure details depending on the path. The logger does not automatically attach trace IDs, and the OTel setup has no log exporter; log ingestion depends on deployment configuration.
- **Cache snapshots:** the minute reporters write `securebuild-scan-capacity-cache.json` and `securebuild-sbom-download-capacity-cache.json` under the worker's `os.TempDir()`. These expose cache readiness, counts, and directory entries for investigating capacity discrepancies. See the cache `DumpToFile` methods.
- **Profiling:** [runWorker](../cmd/cli/run.go) optionally serves Go pprof on `0.0.0.0:6060` when `PProfEnabled` is true.
- **Coverage limits:** there is no explicit application metric here for end-to-end submission-to-result latency, oldest queue age, or general package/image build success and failure. Many background loops started in `runWorker` have logs and database spans but no dedicated application span. Handler and polling durations alone cannot supply those business outcomes.

## Keeping this provenance map current

Search emission sites as well as constants; a defined instrument may not be emitted on the active production path:

```sh
rg -n 'telemetry\.(StartSpan|WithSpan|Gauge|Increment|Count)' cmd pkg
rg -n 'MetricExternalImage|TagChannel|TagScanTier' pkg/telemetry
rg -n 'stored scan result|failed to provision VM|failed to handle provision vms|bad request:|unexpected status code:' pkg
```

When adding an entry, record its unit of work (queue row, digest, architecture, directory, or generation), labels, reporting cadence, and whether it measures dispatch, execution, collection, or publication. For alert-related logs, also record the level, literal message or upstream error origin, fields, exact emitters, and consuming rule; distinguish source-confirmed paths from live-observed examples. Those distinctions are necessary to turn this inventory into reliable dashboards and follow-up investigations.
