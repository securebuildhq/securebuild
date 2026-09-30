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
	loader := func(_ context.Context, candidate fixedCountsBackfillCandidate) (string, error) {
		return details[candidate.Digest+"/"+candidate.Arch], nil
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
	loader := func(context.Context, fixedCountsBackfillCandidate) (string, error) {
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
	loader := func(context.Context, fixedCountsBackfillCandidate) (string, error) {
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
	loader := func(_ context.Context, candidate fixedCountsBackfillCandidate) (string, error) {
		if candidate.Digest == "sha256:error" {
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

func TestRunFixedCountsBackfillStopsWhenListingIsCanceled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	lister := func(context.Context, string, string, int) ([]fixedCountsBackfillCandidate, error) {
		cancel()
		return nil, ctx.Err()
	}
	loader := func(context.Context, fixedCountsBackfillCandidate) (string, error) {
		t.Fatal("canceled listing must stop before loading details")
		return "", nil
	}
	updater := func(context.Context, fixedCountsBackfillCandidate, string) (bool, error) {
		t.Fatal("canceled listing must stop before updating summaries")
		return false, nil
	}

	result, err := runFixedCountsBackfill(ctx, FixedCountsBackfillOptions{BatchSize: 100}, lister, loader, updater)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context cancellation, got %v", err)
	}
	if result.Failed != 0 || result.Candidates != 0 {
		t.Fatalf("cancellation must not be counted as a row failure: %+v", result)
	}
}

func TestRunFixedCountsBackfillStopsWhenLoadingIsCanceled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	lister := func(context.Context, string, string, int) ([]fixedCountsBackfillCandidate, error) {
		return []fixedCountsBackfillCandidate{
			{Digest: "sha256:aaa", Arch: "x86_64"},
			{Digest: "sha256:bbb", Arch: "aarch64"},
		}, nil
	}
	loadCalls := 0
	loader := func(context.Context, fixedCountsBackfillCandidate) (string, error) {
		loadCalls++
		cancel()
		return "", ctx.Err()
	}
	updater := func(context.Context, fixedCountsBackfillCandidate, string) (bool, error) {
		t.Fatal("canceled details load must stop before updating summaries")
		return false, nil
	}

	result, err := runFixedCountsBackfill(ctx, FixedCountsBackfillOptions{BatchSize: 100}, lister, loader, updater)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context cancellation, got %v", err)
	}
	if loadCalls != 1 {
		t.Fatalf("expected cancellation to stop the batch after one load, got %d", loadCalls)
	}
	if result.Failed != 0 || result.Candidates != 1 {
		t.Fatalf("cancellation must not be counted as a row failure: %+v", result)
	}
}

func TestRunFixedCountsBackfillStopsWhenUpdatingIsCanceled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	lister := func(context.Context, string, string, int) ([]fixedCountsBackfillCandidate, error) {
		return []fixedCountsBackfillCandidate{
			{Digest: "sha256:aaa", Arch: "x86_64"},
			{Digest: "sha256:bbb", Arch: "aarch64"},
		}, nil
	}
	loader := func(context.Context, fixedCountsBackfillCandidate) (string, error) {
		return `{"counts":{"total":1},"fixed_counts":{"total":1}}`, nil
	}
	updateCalls := 0
	updater := func(context.Context, fixedCountsBackfillCandidate, string) (bool, error) {
		updateCalls++
		cancel()
		return false, ctx.Err()
	}

	result, err := runFixedCountsBackfill(ctx, FixedCountsBackfillOptions{BatchSize: 100}, lister, loader, updater)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context cancellation, got %v", err)
	}
	if updateCalls != 1 {
		t.Fatalf("expected cancellation to stop the batch after one update, got %d", updateCalls)
	}
	if result.Failed != 0 || result.Candidates != 1 || result.Updated != 0 {
		t.Fatalf("cancellation must not be counted as a row failure: %+v", result)
	}
}
