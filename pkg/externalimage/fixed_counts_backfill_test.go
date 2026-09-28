package externalimage

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

func TestRunFixedCountsBackfill(t *testing.T) {
	candidates := []fixedCountsBackfillCandidate{
		{Digest: "sha256:aaa", Arch: "x86_64", ParsedResults: `{"critical":2,"total":2}`},
		{Digest: "sha256:bbb", Arch: "aarch64", ParsedResults: `{"counts":{"high":1,"total":1}}`},
	}
	details := map[string]string{
		"sha256:aaa/x86_64":  `{"counts":{"critical":2,"high":0,"medium":0,"low":0,"total":2},"fixed_counts":{"critical":1,"high":0,"medium":0,"low":0,"total":1}}`,
		"sha256:bbb/aarch64": `{"counts":{"critical":0,"high":1,"medium":0,"low":0,"total":1},"fixed_counts":{"critical":0,"high":0,"medium":0,"low":0,"total":0}}`,
	}

	listCalls := 0
	lister := func(context.Context, string, string, int) ([]fixedCountsBackfillCandidate, error) {
		listCalls++
		if listCalls == 1 {
			return candidates, nil
		}
		return nil, nil
	}
	loader := func(_ context.Context, digest, arch string) (string, error) {
		return details[digest+"/"+arch], nil
	}
	updated := map[string]string{}
	updater := func(_ context.Context, candidate fixedCountsBackfillCandidate, summary string) (bool, error) {
		updated[candidate.Digest+"/"+candidate.Arch] = summary
		return true, nil
	}

	result, err := runFixedCountsBackfill(context.Background(), FixedCountsBackfillOptions{BatchSize: 100}, lister, loader, updater)
	if err != nil {
		t.Fatalf("runFixedCountsBackfill failed: %v", err)
	}
	if result.Candidates != 2 || result.Updated != 2 || result.Failed != 0 {
		t.Fatalf("unexpected result: %+v", result)
	}
	if len(updated) != 2 {
		t.Fatalf("expected two updates, got %d", len(updated))
	}

	var summary map[string]json.RawMessage
	if err := json.Unmarshal([]byte(updated["sha256:bbb/aarch64"]), &summary); err != nil {
		t.Fatalf("unmarshal updated summary: %v", err)
	}
	if _, ok := summary["fixed_counts"]; !ok {
		t.Fatalf("zero fixed counts must still be persisted: %s", updated["sha256:bbb/aarch64"])
	}
}

func TestRunFixedCountsBackfillDryRun(t *testing.T) {
	listCalls := 0
	lister := func(context.Context, string, string, int) ([]fixedCountsBackfillCandidate, error) {
		listCalls++
		if listCalls == 1 {
			return []fixedCountsBackfillCandidate{{Digest: "sha256:aaa", Arch: "x86_64"}}, nil
		}
		return nil, nil
	}
	loader := func(context.Context, string, string) (string, error) {
		return `{"counts":{"total":1},"fixed_counts":{"total":0}}`, nil
	}
	updater := func(context.Context, fixedCountsBackfillCandidate, string) (bool, error) {
		t.Fatal("dry run must not update PostgreSQL")
		return false, nil
	}

	result, err := runFixedCountsBackfill(context.Background(), FixedCountsBackfillOptions{DryRun: true, BatchSize: 100}, lister, loader, updater)
	if err != nil {
		t.Fatalf("dry run failed: %v", err)
	}
	if result.Candidates != 1 || result.WouldUpdate != 1 || result.Updated != 0 {
		t.Fatalf("unexpected dry-run result: %+v", result)
	}
}

func TestRunFixedCountsBackfillDoesNotOverwriteConcurrentScan(t *testing.T) {
	listCalls := 0
	lister := func(context.Context, string, string, int) ([]fixedCountsBackfillCandidate, error) {
		listCalls++
		if listCalls == 1 {
			return []fixedCountsBackfillCandidate{{Digest: "sha256:aaa", Arch: "x86_64"}}, nil
		}
		return nil, nil
	}
	loader := func(context.Context, string, string) (string, error) {
		return `{"counts":{"total":1},"fixed_counts":{"total":1}}`, nil
	}
	updater := func(context.Context, fixedCountsBackfillCandidate, string) (bool, error) {
		return false, nil
	}

	result, err := runFixedCountsBackfill(context.Background(), FixedCountsBackfillOptions{BatchSize: 100}, lister, loader, updater)
	if err == nil {
		t.Fatal("expected a concurrent update to require a rerun")
	}
	if result.SkippedConcurrent != 1 || result.Updated != 0 {
		t.Fatalf("unexpected concurrent-update result: %+v", result)
	}
}

func TestRunFixedCountsBackfillReportsInvalidDetails(t *testing.T) {
	listCalls := 0
	lister := func(context.Context, string, string, int) ([]fixedCountsBackfillCandidate, error) {
		listCalls++
		if listCalls == 1 {
			return []fixedCountsBackfillCandidate{
				{Digest: "sha256:missing", Arch: "x86_64"},
				{Digest: "sha256:error", Arch: "aarch64"},
			}, nil
		}
		return nil, nil
	}
	loader := func(_ context.Context, digest, _ string) (string, error) {
		if digest == "sha256:error" {
			return "", errors.New("object not found")
		}
		return `{"counts":{"total":1}}`, nil
	}
	updater := func(context.Context, fixedCountsBackfillCandidate, string) (bool, error) {
		t.Fatal("invalid details must not be written")
		return false, nil
	}

	result, err := runFixedCountsBackfill(context.Background(), FixedCountsBackfillOptions{BatchSize: 100}, lister, loader, updater)
	if err == nil {
		t.Fatal("expected invalid details to fail the command")
	}
	if result.Failed != 2 || result.Updated != 0 {
		t.Fatalf("unexpected failure result: %+v", result)
	}
}
