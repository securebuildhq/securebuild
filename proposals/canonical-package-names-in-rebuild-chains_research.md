# Research: Constraint-Aware Provider Selection for Rebuild Chains

## Question

When several packages provide the same virtual package name, which consumers should be included in an automatic rebuild chain?

The required rules are:

1. An unpinned dependency is assigned to the latest available provider version.
2. A pinned dependency is assigned to the latest available provider version satisfying the pin.
3. A consumer is rebuilt only when the updated concrete package is the selected provider under those rules.

For example, both `go-1.25` and `go-1.26` can provide `go`. An unpinned `go` dependency belongs in the `go-1.26` chain when `go-1.26` is the latest provider. A `go~1.25` dependency belongs in the `go-1.25` chain even while `go-1.26` exists.

## Confirmed production evidence

The current rows for `schemahero-0.25` contain:

| package | version | release | stored dependency name | stored resolved package |
|---|---:|---:|---|---|
| `schemahero-0.25` | `0.25.1` | `2` | `go` | `go-1.26` |
| `schemahero-0.25` | `0.25.1` | `1` | `go` | `go-1.26` |
| `schemahero-0.25` | `0.25.0` | `0` | `go` | `go-1.26` |

These rows show that `go-1.26` was the selected provider when the dependency metadata was written. They do not, by themselves, prove that `go-1.26` must remain the selected provider after the provider set changes.

## Current dependency ingestion

Package import compiles the Melange YAML and obtains runtime and build-time dependency strings. Before writing them, `getParentDependencies` calls `GetPackageInfoWithParentRedirection`. That function calls `ParsePackageName`, which uses APKO’s `ResolvePackageNameVersionPin` and returns only `ParsedConstraint.Name`.

As a result:

```text
go          -> go
go~1.25     -> go
go=1.25.7-r0 -> go
```

The operator and version are lost before `WritePackageVersionBuildDependencies` or `WritePackageVersionRuntimeDependencies` runs.

The dependency tables currently store:

- the unversioned requested name;
- the concrete provider package ID selected during import;
- optionally, a concrete provider package-version ID recorded after a successful build.

They do not store the original dependency selector. Therefore existing rows cannot distinguish an unpinned dependency from an exact, compatible, lower-bound, or upper-bound constraint.

Relevant files:

- `pkg/package/import.go`
- `pkg/package/dependency.go`
- `db/schema/tables/package-version-dependency-buildtime.yaml`
- `db/schema/tables/package-version-dependency-runtime.yaml`

## Current provides ingestion

`ExtractProvidesFromMelangeYAML` parses each `provides` entry but retains only `ParsedConstraint.Name`. `package_version_provides` consequently records that a package provides `go`, but not the version it provides.

For the common declaration:

```yaml
provides:
  - go=${{package.full-version}}
```

the compiled selector contains the capability version used by the APK solver, but the database drops it. Existing provider selection compensates by comparing the owning package version. That works when the provided version equals the package version, but it is not a general representation of APK `provides` semantics.

Relevant files:

- `pkg/package/provides.go`
- `db/schema/tables/package-version-provides.yaml`

## Current provider selection

`resolveDependencyPackageID` performs provider selection while writing dependency rows:

1. Prefer a package whose concrete name exactly matches the dependency name.
2. Otherwise, find all package versions with a matching `package_version_provides.provides_name`.
3. Sort candidates by semantic version and APK release.
4. For an unpinned selector, choose the latest candidate.
5. For a pinned selector, choose the latest candidate satisfying APKO’s `ParsedConstraint.SatisfiedBy`.
6. Normalize subpackage candidates to their parent package ID.

The selection algorithm largely expresses the requested rules, but it runs only when dependency metadata is written. Its result is a snapshot. If a newer provider package is introduced later, old consumer rows remain attached to the former provider until those consumers are imported or rebuilt again.

There are two additional fidelity gaps:

- Exact-name packages are preferred before comparing their versions with virtual providers. That may differ from repository solver behavior when both forms are candidates.
- Virtual-provider pins are evaluated against the owning package version because the provided capability version is not stored.

## Current rebuild graph

Patch updates enqueue `build_package_chain` using a concrete root package ID and package-version ID. The handler loads the root’s concrete name and calls `GetPackageDependencyMap`.

`GetPackageDependencyMap` reads dependency rows for all historical package versions and creates edges keyed by `depends_on_package_name`:

```text
requested dependency name -> dependent package name
```

For SchemaHero this produces:

```text
go -> schemahero-0.25
```

The chain starts at:

```text
go-1.26
```

The names do not match, so SchemaHero is omitted. Keying the edge by the stored resolved package ID would fix this individual incident, but it would not implement the required rules after a newer provider appears. The stored ID may then be stale.

Relevant files:

- `pkg/listener/package-family-update-check.go`
- `pkg/listener/build-package-chain.go`
- `pkg/package/dependency.go`
- `pkg/buildgraph/build_ordering.go`
- `pkg/package/rebuild_chain.go`

## Active versus historical consumer specifications

The graph query currently unions dependencies from every package version. This can violate constraint-aware selection even after selectors are preserved. For example:

```text
old SchemaHero spec: go~1.25
new SchemaHero spec: go~1.26
```

If both rows contribute edges, SchemaHero is rebuilt from both Go chains even though only the latest SchemaHero spec will be copied into the new release. Rebuild eligibility must be calculated from the active package version—the version that `CreateNewReleaseForLatestPackageVersion` would use—not from the union of historical specs.

The existing `GetLatestPackageVersion` logic selects the highest semantic version and then the highest APK release. That is the appropriate starting definition of the active consumer spec because rebuild-chain execution creates the next release from that latest version.

## Available versus merely recorded provider versions

APKO and Melange resolve dependencies from repository contents. A package-version row can exist before a successful build publishes it, so “latest database row” is not necessarily “latest available provider.”

For chain construction, provider candidates should be:

- successfully built package versions already available to builders; plus
- the root package version that the current chain is about to build.

Including the root version lets the graph model the repository state expected after the root link succeeds. Excluding other failed or never-built versions avoids assigning consumers to artifacts that builders cannot select.

The `execution` table records successful package builds. Exact publication parity should be verified because execution success is being used as the database proxy for repository availability.

## Build-completion metadata

After a successful consumer build, `update-build-package-status.go` attempts to populate `depends_on_package_version_id`. It looks up dependencies by exact package name. A virtual dependency such as `go` has no package row named `go`, so this path does not reliably record the provider version actually selected by the builder.

Constraint-aware graph construction should not depend on this field. Separately, the field should be updated using the same provider-selection model or, preferably, actual build output if the builder exposes the resolved APK set.

## Existing test coverage and gaps

- `pkg/package/dependency_test.go` covers candidate ordering and APKO constraint satisfaction in isolation.
- `pkg/buildgraph/build_ordering_test.go` covers traversal and cycles after an adjacency map has been built.
- The package-family integration suite checks that patch versions enqueue a chain message, but not which links are created.
- The build-queue integration suite starts from pre-created links.

Missing coverage includes:

- preserving dependency selectors during import;
- preserving provided capability versions;
- choosing between multiple providers of one virtual name;
- re-evaluating the preferred provider after a newer provider appears;
- separating unpinned and pinned consumers;
- excluding historical consumer constraints;
- excluding unavailable provider versions;
- persisting the resulting concrete-provider chain links.

## Conclusion

The initial canonical-name query correction is insufficient. Correct rebuild eligibility requires the same information used by package resolution: the complete consumer selector, the provided capability version, the current set of available providers, and the active consumer spec. The graph must select a preferred provider dynamically and attach the consumer only to that concrete provider’s node.
