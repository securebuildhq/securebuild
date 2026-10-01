# Repository guidance

See [CLAUDE.md](CLAUDE.md) for existing development conventions, build commands, and commit-signing requirements.

## Worker telemetry and observability

When the user asks about securebuild-worker telemetry, metrics, spans, traces, critical logs, Grafana alert rules, or related operational behavior, start with the [telemetry and observability provenance map](docs/securebuild-worker-telemetry-provenance.md). Use its table of contents to read the relevant sections.

The map connects signals to their code definitions, explains their business meaning and counting units, links alerts to their metric/log inputs, and documents read-only Grafana MCP access patterns.

For questions about current or historical behavior in practice, use the documented Grafana queries when access is available. Distinguish source-code semantics and recorded configuration from live observations; include the query, time window, and relevant labels or trace IDs. If access is unavailable, say so rather than treating missing data as zero activity.

Keep Prometheus labels bounded. Do not add image digests, request/trace IDs, scan-generation IDs, arbitrary image references, or raw error messages as metric labels or dynamic metric names. Put per-image and per-operation identifiers in span attributes and structured log fields, not Loki stream labels. If a request proposes unbounded metric dimensions, explain the series-growth cost and propose a trace/log-based alternative that meets the investigative need before implementing it. See [telemetry design guardrails](docs/securebuild-worker-telemetry-provenance.md#telemetry-design-guardrails) for rationale and examples.
