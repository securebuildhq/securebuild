# Proposal: Constraint-Aware Provider Selection in Rebuild Chains

Research: [canonical-package-names-in-rebuild-chains_research.md](canonical-package-names-in-rebuild-chains_research.md)

## TL;DR

Preserve complete dependency and `provides` selectors in the database, then calculate each active consumer’s preferred concrete provider whenever a rebuild chain is created. An unpinned selector such as `go` maps only to the latest available Go provider; a pinned selector such as `go~1.25` maps only to the latest available provider satisfying that constraint. The reverse graph uses the selected provider’s canonical package name, so updates rebuild exactly the consumers that APKO/Melange are expected to resolve to that provider. This replaces the proposed static use of `depends_on_package_id`, which can become stale as new providers are added.

## The problem

Multiple concrete packages can provide the same virtual package:

```text
go-1.25 --provides--> go
go-1.26 --provides--> go
```

Consumers can express different intent:

```text
schemahero-0.25: go          # unpinned
consumer-a:       go~1.25    # compatible-version pin
consumer-b:       go=1.26.5  # exact pin
```

Automatic rebuild chains must follow two selection rules:

1. An unpinned consumer rebuilds only for the latest available provider version.
2. A pinned consumer rebuilds only for the latest available provider version satisfying its pin.

The current system cannot reliably enforce these rules:

- dependency ingestion strips version operators and versions before persistence;
- `provides` ingestion strips provided capability versions;
- the stored provider package ID is selected only when the consumer metadata is written and can become stale;
- the rebuild graph keys edges by the requested virtual name, while chains start from concrete package names;
- dependency rows from historical consumer versions are unioned into the graph.

The original SchemaHero incident is one manifestation: its `go` edge was not reachable from `go-1.26`. Simply changing that edge to use the stored `go-1.26` ID fixes the incident but fails once a newer Go provider becomes preferred.

## Prototype / design

### Persist selectors without losing intent

Store the compiled selector strings alongside the existing parsed names:

```text
dependency_spec = "go~1.25"
depends_on_package_name = "go"

provides_spec = "go=1.25.7-r0"
provides_name = "go"
```

The full string is necessary because APKO’s public `ParsedConstraint` exposes the name and version but not a serializable public operator. Retaining the exact compiled selector also protects compatibility with parser behavior.

### Build a provider index

At graph construction time, load eligible provider capabilities from:

1. Concrete package names, treated as implicit capabilities at the package version.
2. `package_version_provides`, using the persisted provided capability selector/version.

Normalize subpackage providers to the parent package that must be rebuilt, while retaining the subpackage capability version for constraint evaluation.

Provider eligibility is limited to:

- package versions with a successful build; and
- the root package version named by the current `build_package_chain` event.

This approximates the repository visible to builders after the root link succeeds. The implementation spike must verify that successful execution is an accurate publication signal.

### Select one preferred provider per active dependency

For each dependency in the latest package version of each top-level consumer:

1. Parse `dependency_spec` with `ResolvePackageNameVersionPin`.
2. Find eligible concrete-name and virtual-provider candidates for the parsed name.
3. Discard candidates whose capability version does not satisfy the selector.
4. Sort by APK version semantics, then APK release.
5. Select exactly one preferred concrete provider package.
6. Add `selected provider canonical name -> consumer canonical name` to the reverse graph.

Tie-breaking for candidates with identical capability version and release must be deterministic. The implementation should first reproduce repository priority if that information is available. If it is not represented in the database, prefer an exact package-name candidate and then canonical package name as a stable final tie-breaker, and emit a warning for the ambiguity.

### Resulting behavior

Assume the latest available providers are `go-1.25@1.25.9` and `go-1.26@1.26.5`:

| Consumer selector | Selected provider | Rebuilt for `go-1.25` | Rebuilt for `go-1.26` |
|---|---|---:|---:|
| `go` | `go-1.26` | no | yes |
| `go~1.25` | `go-1.25` | yes | no |
| `go=1.26.5` | `go-1.26` | no | yes |
| `go<1.26` | `go-1.25` | yes | no |

When `go-1.27` becomes the latest available provider, an unpinned consumer moves to `go-1.27` without needing to be re-imported first. A `go~1.26` consumer remains attached to `go-1.26`.

```text
active consumer dependency specs
              |
              v
constraint-aware provider selection <--- eligible concrete/provided capabilities
              |
              v
selected concrete provider -> consumer edges
              |
              v
BuildDAG(root concrete package) -> rebuild_chain links
```

## New Subagents / Commands

No new development subagents will be created.

A one-time CLI migration command will be added to backfill dependency and `provides` selectors from stored Melange YAML. This is an operational command, not an agent command.

## Database

Add the complete selector to each dependency table and the complete provided capability selector to `package_version_provides`.

The first deployment keeps these columns nullable for compatibility during backfill.

```yaml
database: securebuild
name: package_version_dependency_buildtime
schema:
  postgres:
    columns:
      - name: dependency_spec
        type: text
        constraints:
          notNull: false
```

```yaml
database: securebuild
name: package_version_dependency_runtime
schema:
  postgres:
    columns:
      - name: dependency_spec
        type: text
        constraints:
          notNull: false
```

```yaml
database: securebuild
name: package_version_provides
schema:
  postgres:
    columns:
      - name: provides_spec
        type: text
        constraints:
          notNull: false
```

No new index is required for the first version. Provider selection will load candidates in bounded queries and group them in Go; existing primary-key and `package_version_provides` indexes support the joins. Query plans and row counts must be recorded before rollout.

After all writers are upgraded and backfill validation reports no missing selectors for valid Melange specs, a later schema checkpoint may make the new columns non-null. That hardening is deliberately separate so rollback remains safe during adoption.

The existing columns remain:

- `depends_on_package_name` and `provides_name` support indexed/grouped lookup.
- `depends_on_package_id` remains the provider selected when the row was written and can be used for diagnostics, but not as the source of truth for future graph selection.
- `depends_on_package_version_id` remains build-observation metadata and is not used to decide future rebuild eligibility.

## Implementation plan

### Selector persistence

Modify `pkg/package/import.go`:

- Replace the string-only parent-dependency transformation with a structured value containing the original compiled selector, parsed name, and any parent-build normalization.
- Do not discard the version operator or version before writing dependencies.

Modify `pkg/package/dependency.go`:

- Accept structured dependency selectors in the runtime and build-time writers.
- Populate `dependency_spec` and the existing parsed-name/provider fields.
- Keep APKO’s parser as the constraint authority.

Modify `pkg/package/provides.go`:

- Extend `ProvidesEntry` with the full compiled selector.
- Populate `provides_spec` while retaining `provides_name`.

Modify the three SchemaHero table definitions:

- `db/schema/tables/package-version-dependency-buildtime.yaml`
- `db/schema/tables/package-version-dependency-runtime.yaml`
- `db/schema/tables/package-version-provides.yaml`

### Constraint-aware graph construction

Modify `pkg/package/dependency.go`:

- Replace static adjacency construction with a function that accepts the root package-version ID.
- Select only the latest package version for each dependent package.
- Load dependency selectors for those active versions.
- Load eligible concrete and virtual provider candidates.
- Resolve every dependency selector to one preferred concrete parent package.
- Deduplicate the resulting provider-to-consumer edges.
- Return diagnostics for unresolved and ambiguous selectors.

Modify `pkg/listener/build-package-chain.go`:

- Pass the root package-version ID into graph construction.
- Log counts for unpinned selections, pinned selections, unresolved selectors, ambiguous ties, and selected-provider changes from the stored provider ID.
- Preserve the existing root-only fallback only when there are genuinely no selected dependents.

No changes are expected in `pkg/buildgraph/build_ordering.go`, `pkg/package/rebuild_chain.go`, or `pkg/buildqueue/buildqueue.go`; they continue operating on concrete package names.

### Build-observation metadata

Modify `pkg/listener/update-build-package-status.go`:

- Stop assuming every dependency has an exact package row with the requested name.
- Resolve virtual dependencies through the shared provider-selection helper when recording `depends_on_package_version_id`, or use the builder’s resolved package output if available.
- Treat this field as observed metadata, not future graph policy.

### Backfill command

Add a migration function in `pkg/package` and a CLI entry under `cmd/cli`:

- Select package versions that still have missing selector data.
- Compile each stored Melange YAML.
- Re-extract runtime dependencies, build-time dependencies, and provides.
- Match and populate new selector columns transactionally per package version.
- Report malformed YAML, unmatched rows, and progress.
- Support dry-run; reruns naturally skip selector rows already populated.

Do not enqueue builds or mutate package versions during backfill.

### Pseudocode

```text
function BuildConstraintAwareDependencyMap(rootPackageVersionID):
    activeConsumers = latest package version for every top-level package
    dependencies = selectors belonging to activeConsumers

    eligibleProviderVersions = successful package versions
    eligibleProviderVersions += rootPackageVersionID

    providerIndex = index concrete names and provides specs

    graph = empty map
    diagnostics = empty counters

    for dependency in dependencies:
        selector = parse(dependency.dependency_spec)
        candidates = providerIndex[selector.name]
        matching = candidates satisfying selector

        if matching is empty:
            record unresolved selector
            continue

        selected = highest capability version and APK release
        selected = deterministic tie-break(selected)
        provider = selected parent build package
        graph[provider.name].add(dependency.consumer.name)

    return graph, diagnostics
```

### APIs, events, and toggles

- No public API or Swagger/OpenAPI changes.
- The `build_package_chain` event schema is unchanged; it already carries the root package-version ID required for selection.
- No entitlement change.
- The worker always uses the constraint-aware graph. If an active dependency is
  missing its persisted selector, chain creation fails closed and instructs the
  operator to run the selector migration rather than treating a former pin as
  unpinned.

## Testing

### Unit tests

Extend `pkg/package/dependency_test.go` with table-driven cases for:

- unpinned selection across `go-1.25` and `go-1.26`;
- compatible, exact, lower-bound, and upper-bound constraints;
- selection using provided capability version rather than owning package version;
- semantic version and APK release ordering;
- exact-name and virtual candidates in one candidate set;
- deterministic equal-version ties;
- subpackage-to-parent normalization;
- unavailable candidates;
- inclusion of the pending root version;
- unresolved and malformed selectors.

Add import/provides extraction tests proving that operators and versions survive persistence preparation.

### Integration tests

Use database-backed fixtures with:

- two concrete Go providers that both provide `go`;
- successful versions for both providers;
- one newer pending root version;
- unpinned and pinned consumers;
- an older consumer spec with a different pin;
- build-time and runtime dependencies;
- a subpackage provider;
- a failed/unpublished provider version.

Assert that:

1. An unpinned consumer appears only under the latest eligible provider.
2. A pinned consumer appears only under the latest eligible provider satisfying the pin.
3. A newer provider causes unpinned selection to move without rewriting the consumer row.
4. Historical consumer constraints do not add stale edges.
5. Failed or unpublished provider versions are ignored.
6. The pending root version participates in selection.
7. Persisted rebuild-chain links and dependencies match the selected graph.
8. Runtime and build-time dependencies follow identical selection rules.

### Migration tests

- Dry-run performs no writes.
- Re-running a completed migration is idempotent.
- Mixed old/new rows are handled safely.
- Malformed Melange YAML is reported without losing progress.
- Exact, compatible, and unpinned selectors are recovered correctly.
- Provides templates compile to concrete persisted selectors.

### Performance and compatibility tests

- Benchmark provider indexing and selection using production-scale row counts.
- Record SQL `EXPLAIN (ANALYZE, BUFFERS)` output for active dependencies and eligible providers.
- Compare pre-migration and constraint-aware graph fixtures, grouped by reason for each difference.
- Run all package, listener, buildgraph, and affected worker integration suites.

No browser end-to-end test is required because this is an internal event-driven workflow.

## Backward compatibility

The schema rollout is additive. Old binaries ignore nullable selector columns; new writers populate them.

The new graph reader remains available while backfill is in progress:

- missing `dependency_spec` is counted, logged, and temporarily treated as an unpinned request for the stored dependency name;
- missing `provides_spec` may temporarily use the owning package version, matching current behavior;
- new writes populate both selectors immediately.

The compatibility fallback cannot recover a historical version constraint, so operators should run the selector migration promptly after deployment.

The `build_package_chain` payload, rebuild-chain tables, and build queue contracts do not change.

Behavior changes intentionally when enforcement begins:

- unpinned consumers stop rebuilding for older providers;
- pinned consumers rebuild only for the preferred matching provider;
- consumers no longer inherit edges from historical Melange specs;
- provider preference can move when a newer eligible provider becomes available.

## Migrations

### Forward plan

1. Add nullable selector columns.
2. Deploy dual-writing dependency/provides ingestion and the backfill command.
3. Run the backfill in dry-run mode and review malformed or ambiguous records.
4. Run the backfill; rerun it after correcting any reported failure.
5. Validate selector coverage and compare reconstructed selectors with stored parsed names.
6. Deploy the constraint-aware graph and monitor selection diagnostics.
7. Resolve unexpected selections and verify repository-availability assumptions.
9. Optionally make selector columns non-null in a later schema change.

### Rollback plan

- Roll back application code normally; additive nullable columns and backfilled data remain harmless.
- Backfill only adds selector values reconstructed from immutable Melange YAML; no reverse data migration is needed.
- Rebuild chains already persisted should be allowed to complete because graph mode is evaluated at chain creation.

### Operational verification

- Track unresolved selectors, ambiguous provider ties, missing selector columns, and provider changes from stored IDs.
- For representative Go updates, inspect the logged provider choice for unpinned and pinned consumers.
- Query `rebuild_chain_link` and `rebuild_chain_dependency` to confirm selected consumers are attached to the expected concrete provider.
- Catch up the original missed SchemaHero rebuild explicitly after enforcement; existing completed chains are not rewritten.

## Trade-offs

This design optimizes for rebuild behavior that follows dependency intent as the provider set evolves.

- Dynamic selection is more expensive than reading a stored provider ID, but it avoids stale provider assignments.
- Persisting full selectors duplicates information present in Melange YAML, but avoids recompiling every package spec during each graph build and preserves parser-ready intent.
- Restricting consumers to their latest package version removes stale edges and matches the version used for a new release, but changes the graph from historical union semantics.
- Using successful execution as repository availability is practical but must be validated against actual publication behavior.
- Exact parity with APKO repository priority may require additional repository metadata. Ambiguous equal-version candidates are surfaced rather than silently hidden.
- The phased rollout is larger than a query-only correction, but it is reversible and supports production comparison before behavior changes.

## Alternative solutions considered

### Use the stored `depends_on_package_id`

Rejected as the final design. It fixes virtual-to-concrete naming for the provider selected at import time but becomes stale when a newer provider appears. It cannot implement automatic movement of unpinned consumers.

### Re-resolve from `depends_on_package_name` only

Rejected because the current column cannot distinguish `go`, `go~1.25`, and `go=1.26.5`. Pinned and unpinned consumers would be treated identically.

### Compile every Melange YAML during every graph build

This avoids schema changes but makes a frequent operational path CPU-heavy and vulnerable to one malformed historical spec. It also requires repeatedly extracting `provides`. Rejected in favor of compiling once at write/backfill time.

### Update all stored provider IDs whenever a provider changes

Viable, but it introduces a global fan-out mutation for every new provider version and still requires persisted constraints. Dynamic graph selection is easier to audit and avoids synchronization races between provider updates and chain creation.

### Delegate selection entirely to builders and rebuild every possible consumer

Rejected because it would rebuild unpinned consumers for every older provider and pinned consumers for providers they cannot use, violating both required rules and creating unnecessary work.

### Refactor the DAG to package IDs

Package-ID nodes would remove name identity ambiguity after provider selection, but they do not solve constraint-aware selection itself. This can be considered separately after the selection model is correct.

## Research

Detailed findings are documented in [canonical-package-names-in-rebuild-chains_research.md](canonical-package-names-in-rebuild-chains_research.md).

Codebase foundations reused by this proposal:

- APKO `ResolvePackageNameVersionPin` and `ParsedConstraint.SatisfiedBy` already implement supported constraint semantics.
- `selectMatchingCandidate` already expresses semantic-version and APK-release preference.
- `resolvePackageIDFromCandidate` already normalizes subpackage providers to parent packages.
- `GetLatestPackageVersion` already identifies the consumer version used as the basis for new releases.
- the chain event already includes the pending root package-version ID.

No external reference is required for the core design. The applicable resolver semantics are supplied by the APKO library already used by the repository.

## Checkpoints (PR plan)

Use multiple PRs so persistence, migration, observation, and enforcement remain independently reviewable and reversible.

1. **Selector persistence**
   - Add nullable SchemaHero columns.
   - Preserve full dependency and provides selectors in new writes.
   - Add extraction and writer tests.

2. **Backfill tooling**
   - Add rerunnable dry-run/backfill command for missing selectors.
   - Add migration tests and validation queries.

3. **Constraint-aware resolver**
   - Add active-consumer and eligible-provider loading.
   - Add provider selection, diagnostics, unit tests, and integration fixtures.
   - Fail closed when active dependency selectors have not been migrated.
   - Add chain-level regression coverage and operational verification.

4. **Optional schema hardening**
   - Make selector columns non-null after every supported writer and row is verified.
