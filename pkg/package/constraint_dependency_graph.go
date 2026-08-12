package sbpackage

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"

	apkopackage "chainguard.dev/apko/pkg/apk/apk"
	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/package/types"
	"github.com/securebuildhq/securebuild/pkg/persistence"
)

// DependencyGraphDiagnostics describes decisions made while resolving the
// active package dependency graph.
type DependencyGraphDiagnostics struct {
	Dependencies       int
	Pinned             int
	Unpinned           int
	Unresolved         int
	Ambiguous          int
	MissingSelectors   int
	StoredProviderMove int
}

type providerCandidate struct {
	CapabilityName    string
	CapabilityVersion string
	PackageID         string
	PackageName       string
	PackageVersionID  string
	ExactName         bool
}

type activeDependency struct {
	ConsumerName     string
	Selector         string
	RequestedName    string
	StoredProvider   string
	PackageVersion   string
	PackageRelease   int
	PackageVersionID string
}

func apkVersionString(version string, release int) string {
	if strings.HasSuffix(version, fmt.Sprintf("-r%d", release)) {
		return version
	}
	return fmt.Sprintf("%s-r%d", version, release)
}

func compareAPKVersions(left, right string) int {
	lv, leftErr := apkopackage.ParseVersion(left)
	rv, rightErr := apkopackage.ParseVersion(right)
	switch {
	case leftErr == nil && rightErr == nil:
		return apkopackage.CompareVersions(lv, rv)
	case leftErr == nil:
		return 1
	case rightErr == nil:
		return -1
	default:
		return strings.Compare(left, right)
	}
}

func selectPreferredProvider(candidates []providerCandidate, selector string) (providerCandidate, bool, error) {
	constraint := apkopackage.ResolvePackageNameVersionPin(selector)
	matching := make([]providerCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		if candidate.CapabilityName != constraint.Name {
			continue
		}
		version, err := apkopackage.ParseVersion(candidate.CapabilityVersion)
		if err != nil {
			continue
		}
		satisfied, err := constraint.SatisfiedBy(version)
		if err != nil {
			return providerCandidate{}, false, fmt.Errorf("evaluate selector %q against %q: %w", selector, candidate.CapabilityVersion, err)
		}
		if satisfied {
			matching = append(matching, candidate)
		}
	}
	if len(matching) == 0 {
		return providerCandidate{}, false, fmt.Errorf("no available provider satisfies %q: %w", selector, ErrPackageNotFound)
	}

	sort.SliceStable(matching, func(i, j int) bool {
		if comparison := compareAPKVersions(matching[i].CapabilityVersion, matching[j].CapabilityVersion); comparison != 0 {
			return comparison > 0
		}
		if matching[i].ExactName != matching[j].ExactName {
			return matching[i].ExactName
		}
		if matching[i].PackageName != matching[j].PackageName {
			return matching[i].PackageName < matching[j].PackageName
		}
		return matching[i].PackageVersionID < matching[j].PackageVersionID
	})

	ambiguous := len(matching) > 1 &&
		compareAPKVersions(matching[0].CapabilityVersion, matching[1].CapabilityVersion) == 0 &&
		matching[0].ExactName == matching[1].ExactName
	return matching[0], ambiguous, nil
}

// GetConstraintAwarePackageDependencyMap resolves each dependency in the active
// package spec to the latest available concrete provider satisfying its selector.
// A successful execution is the availability signal; rootPackageVersionID is
// also eligible because this graph describes repository state after the root build.
func GetConstraintAwarePackageDependencyMap(ctx context.Context, rootPackageVersionID string) (map[string][]string, DependencyGraphDiagnostics, error) {
	db := persistence.MustGetPooledPostgresSession(ctx)
	defer db.Release()

	activeVersionIDs, err := listActiveTopLevelPackageVersionIDs(ctx, db)
	if err != nil {
		return nil, DependencyGraphDiagnostics{}, err
	}

	dependencies, err := listActiveDependencies(ctx, db, activeVersionIDs)
	if err != nil {
		return nil, DependencyGraphDiagnostics{}, err
	}

	providerIndex, err := listAvailableProviders(ctx, db, rootPackageVersionID)
	if err != nil {
		return nil, DependencyGraphDiagnostics{}, err
	}

	graphSets := make(map[string]map[string]struct{})
	diagnostics := DependencyGraphDiagnostics{}
	for _, dependency := range dependencies {
		diagnostics.Dependencies++
		selector := dependency.Selector
		if selector == "" {
			selector = dependency.RequestedName
			diagnostics.MissingSelectors++
		}
		parsed := apkopackage.ResolvePackageNameVersionPin(selector)
		if parsed.Version == "" {
			diagnostics.Unpinned++
		} else {
			diagnostics.Pinned++
		}

		selected, ambiguous, err := selectPreferredProvider(providerIndex[parsed.Name], selector)
		if err != nil {
			diagnostics.Unresolved++
			continue
		}
		if ambiguous {
			diagnostics.Ambiguous++
		}
		if dependency.StoredProvider != "" && dependency.StoredProvider != selected.PackageID {
			diagnostics.StoredProviderMove++
		}
		if graphSets[selected.PackageName] == nil {
			graphSets[selected.PackageName] = make(map[string]struct{})
		}
		graphSets[selected.PackageName][dependency.ConsumerName] = struct{}{}
	}

	graph := make(map[string][]string, len(graphSets))
	for provider, consumers := range graphSets {
		for consumer := range consumers {
			graph[provider] = append(graph[provider], consumer)
		}
		sort.Strings(graph[provider])
	}
	for _, consumers := range graph {
		for _, consumer := range consumers {
			if _, ok := graph[consumer]; !ok {
				graph[consumer] = []string{}
			}
		}
	}
	return graph, diagnostics, nil
}

// GetPreferredAvailableProviderVersions resolves selectors against one snapshot
// of the available provider set. Unmatched selectors are omitted from the result.
func GetPreferredAvailableProviderVersions(ctx context.Context, selectors []string) (map[string]*types.PackageVersion, error) {
	db := persistence.MustGetPooledPostgresSession(ctx)
	providers, err := listAvailableProviders(ctx, db, "")
	db.Release()
	if err != nil {
		return nil, err
	}
	selectedIDs := make(map[string]string, len(selectors))
	for _, selector := range selectors {
		parsed := apkopackage.ResolvePackageNameVersionPin(selector)
		selected, _, selectErr := selectPreferredProvider(providers[parsed.Name], selector)
		if selectErr == nil {
			selectedIDs[selector] = selected.PackageVersionID
		}
	}
	resolved := make(map[string]*types.PackageVersion, len(selectedIDs))
	for selector, versionID := range selectedIDs {
		version, getErr := GetPackageVersion(ctx, versionID)
		if getErr != nil {
			return nil, fmt.Errorf("get selected provider version %s: %w", versionID, getErr)
		}
		resolved[selector] = version
	}
	return resolved, nil
}

// dbQueryer is the subset implemented by pgxpool.Conn and used here to keep
// graph construction independently testable at the selection layer.
type dbQueryer interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func listActiveTopLevelPackageVersionIDs(ctx context.Context, db dbQueryer) ([]string, error) {
	rows, err := db.Query(ctx, `
		SELECT pv.id, pv.package_id, pv.version, pv.apk_release
		FROM package_version pv
		JOIN package p ON p.id = pv.package_id
		WHERE p.parent_id IS NULL
	`)
	if err != nil {
		return nil, fmt.Errorf("list top-level package versions: %w", err)
	}
	defer rows.Close()

	type versionChoice struct {
		id      string
		version string
		release int
	}
	active := make(map[string]versionChoice)
	for rows.Next() {
		var id, packageID, version string
		var release int
		if err := rows.Scan(&id, &packageID, &version, &release); err != nil {
			return nil, fmt.Errorf("scan top-level package version: %w", err)
		}
		choice, exists := active[packageID]
		if !exists || compareAPKVersions(apkVersionString(version, release), apkVersionString(choice.version, choice.release)) > 0 {
			active[packageID] = versionChoice{id: id, version: version, release: release}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate top-level package versions: %w", err)
	}
	ids := make([]string, 0, len(active))
	for _, choice := range active {
		ids = append(ids, choice.id)
	}
	sort.Strings(ids)
	return ids, nil
}

func listActiveDependencies(ctx context.Context, db dbQueryer, activeVersionIDs []string) ([]activeDependency, error) {
	if len(activeVersionIDs) == 0 {
		return nil, nil
	}
	rows, err := db.Query(ctx, `
		SELECT dependent.name, d.dependency_spec, d.depends_on_package_name,
		       d.depends_on_package_id, pv.id, pv.version, pv.apk_release
		FROM (
			SELECT package_version_id, dependency_spec, depends_on_package_name, depends_on_package_id, depends_on_package_is_external
			FROM package_version_dependency_runtime
			UNION ALL
			SELECT package_version_id, dependency_spec, depends_on_package_name, depends_on_package_id, depends_on_package_is_external
			FROM package_version_dependency_buildtime
		) d
		JOIN package_version pv ON pv.id = d.package_version_id
		JOIN package dependent ON dependent.id = pv.package_id
		WHERE d.package_version_id = ANY($1)
		  AND d.depends_on_package_is_external = false
		  AND dependent.parent_id IS NULL
	`, activeVersionIDs)
	if err != nil {
		return nil, fmt.Errorf("list active dependencies: %w", err)
	}
	defer rows.Close()

	var dependencies []activeDependency
	for rows.Next() {
		var dependency activeDependency
		var selector sql.NullString
		if err := rows.Scan(&dependency.ConsumerName, &selector, &dependency.RequestedName,
			&dependency.StoredProvider, &dependency.PackageVersionID, &dependency.PackageVersion, &dependency.PackageRelease); err != nil {
			return nil, fmt.Errorf("scan active dependency: %w", err)
		}
		if selector.Valid {
			dependency.Selector = selector.String
		}
		dependencies = append(dependencies, dependency)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate active dependencies: %w", err)
	}
	return dependencies, nil
}

func listAvailableProviders(ctx context.Context, db dbQueryer, rootPackageVersionID string) (map[string][]providerCandidate, error) {
	rows, err := db.Query(ctx, `
		WITH eligible AS (
			SELECT pv.id, pv.package_id, p.name AS package_name, pv.version, pv.apk_release
			FROM package_version pv
			JOIN package p ON p.id = pv.package_id
			WHERE p.parent_id IS NULL
			  AND (pv.id = $1 OR EXISTS (
				SELECT 1 FROM execution e
				WHERE e.package_version_id = pv.id AND e.status = 'success'
			  ))
		)
		SELECT e.id, e.package_id, e.package_name, e.version, e.apk_release,
		       pvp.provides_name, pvp.provides_spec
		FROM eligible e
		LEFT JOIN package_version_provides pvp ON pvp.package_version_id = e.id
	`, rootPackageVersionID)
	if err != nil {
		return nil, fmt.Errorf("list available providers: %w", err)
	}
	defer rows.Close()

	index := make(map[string][]providerCandidate)
	seenImplicit := make(map[string]struct{})
	for rows.Next() {
		var versionID, packageID, packageName, version string
		var release int
		var providesName, providesSpec sql.NullString
		if err := rows.Scan(&versionID, &packageID, &packageName, &version, &release, &providesName, &providesSpec); err != nil {
			return nil, fmt.Errorf("scan available provider: %w", err)
		}
		implicitKey := versionID + "\x00" + packageName
		if _, ok := seenImplicit[implicitKey]; !ok {
			seenImplicit[implicitKey] = struct{}{}
			index[packageName] = append(index[packageName], providerCandidate{
				CapabilityName: packageName, CapabilityVersion: apkVersionString(version, release),
				PackageID: packageID, PackageName: packageName, PackageVersionID: versionID, ExactName: true,
			})
		}
		if providesName.Valid {
			capabilityVersion := apkVersionString(version, release)
			if providesSpec.Valid {
				parsed := apkopackage.ResolvePackageNameVersionPin(providesSpec.String)
				if parsed.Version != "" {
					capabilityVersion = parsed.Version
				}
			}
			index[providesName.String] = append(index[providesName.String], providerCandidate{
				CapabilityName: providesName.String, CapabilityVersion: capabilityVersion,
				PackageID: packageID, PackageName: packageName, PackageVersionID: versionID,
			})
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate available providers: %w", err)
	}

	// Every subpackage name is an implicit capability supplied by its parent build.
	subpackageRows, err := db.Query(ctx, `
		WITH eligible AS (
			SELECT pv.id, pv.package_id, p.name AS package_name, pv.version, pv.apk_release
			FROM package_version pv
			JOIN package p ON p.id = pv.package_id
			WHERE p.parent_id IS NULL
			  AND (pv.id = $1 OR EXISTS (
				SELECT 1 FROM execution e
				WHERE e.package_version_id = pv.id AND e.status = 'success'
			  ))
		)
		SELECT e.id, e.package_id, e.package_name, e.version, e.apk_release, child.name
		FROM eligible e
		JOIN package child ON child.parent_id = e.package_id
	`, rootPackageVersionID)
	if err != nil {
		return nil, fmt.Errorf("list available subpackage providers: %w", err)
	}
	defer subpackageRows.Close()
	for subpackageRows.Next() {
		var versionID, packageID, packageName, version, childName string
		var release int
		if err := subpackageRows.Scan(&versionID, &packageID, &packageName, &version, &release, &childName); err != nil {
			return nil, fmt.Errorf("scan available subpackage provider: %w", err)
		}
		index[childName] = append(index[childName], providerCandidate{
			CapabilityName: childName, CapabilityVersion: apkVersionString(version, release),
			PackageID: packageID, PackageName: packageName, PackageVersionID: versionID, ExactName: true,
		})
	}
	if err := subpackageRows.Err(); err != nil {
		return nil, fmt.Errorf("iterate available subpackage providers: %w", err)
	}
	return index, nil
}
