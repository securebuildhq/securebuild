package externalimage

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type legacyCleanupTestStore struct {
	headHook  func(context.Context, string) error
	objects   map[string]int64
	headErr   error
	deleteErr error
	deleted   []string
}

func (s *legacyCleanupTestStore) objectSize(ctx context.Context, key string) (int64, bool, error) {
	if s.headHook != nil {
		if err := s.headHook(ctx, key); err != nil {
			return 0, false, err
		}
	}
	size, exists := s.objects[key]
	return size, exists, s.headErr
}
func (s *legacyCleanupTestStore) deleteMany(_ context.Context, keys []string) error {
	s.deleted = append(s.deleted, keys...)
	// Model partial success before an error; a retry must tolerate missing keys.
	for i, key := range keys {
		delete(s.objects, key)
		if i == 0 && s.deleteErr != nil {
			return s.deleteErr
		}
	}
	return s.deleteErr
}
func legacyCleanupFixture() (legacyScanCleanupCandidate, *legacyCleanupTestStore) {
	c := legacyScanCleanupCandidate{digest: "sha256:abc", arch: "x86_64", generationID: "new", rawSize: 10, detailsSize: 20}
	c.rawKey = generationRawResultKey(c.digest, c.arch, c.generationID)
	c.detailsKey = generationParsedResultsDetailsKey(c.digest, c.arch, c.generationID)
	return c, &legacyCleanupTestStore{objects: map[string]int64{
		c.rawKey: 10, c.detailsKey: 20,
		rawResultKey(c.digest, c.arch): 7, parsedResultsDetailsKey(c.digest, c.arch): 8,
		sbomKey(c.digest, c.arch): 9,
	}}
}
func TestLegacyCleanupRetriesPartialDeletionAndMetadataFailure(t *testing.T) {
	ctx := context.Background()
	c, store := legacyCleanupFixture()
	completeCalls := 0
	metadataErr := errors.New("database unavailable")
	complete := func(context.Context, legacyScanCleanupCandidate) error { completeCalls++; return metadataErr }
	store.deleteErr = errors.New("one key failed")
	require.Error(t, deleteLegacyScanBatch(ctx, store, []legacyScanCleanupCandidate{c}, complete))
	require.Zero(t, completeCalls, "partial deletion must not be marked complete")
	require.NotContains(t, store.objects, rawResultKey(c.digest, c.arch))
	require.Contains(t, store.objects, parsedResultsDetailsKey(c.digest, c.arch))
	store.deleteErr = nil
	require.ErrorIs(t, deleteLegacyScanBatch(ctx, store, []legacyScanCleanupCandidate{c}, complete), metadataErr)
	metadataErr = nil
	require.NoError(t, deleteLegacyScanBatch(ctx, store, []legacyScanCleanupCandidate{c}, complete))
	require.Equal(t, 2, completeCalls)
	require.Equal(t, map[string]int64{c.rawKey: 10, c.detailsKey: 20, sbomKey(c.digest, c.arch): 9}, store.objects)
}
func TestLegacyCleanupRequiresValidReplacement(t *testing.T) {
	for _, mode := range []string{"missing", "wrong size", "legacy key", "head denied", "canceled"} {
		t.Run(mode, func(t *testing.T) {
			c, store := legacyCleanupFixture()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			switch mode {
			case "missing":
				delete(store.objects, c.detailsKey)
			case "wrong size":
				store.objects[c.detailsKey] = 5
			case "legacy key":
				c.rawKey = rawResultKey(c.digest, c.arch)
			case "head denied":
				store.headErr = errors.New("access denied")
			case "canceled":
				cancel()
			}
			err := deleteLegacyScanBatch(ctx, store, []legacyScanCleanupCandidate{c}, func(context.Context, legacyScanCleanupCandidate) error {
				t.Fatal("must not mark completed")
				return nil
			})
			require.Error(t, err)
			require.Empty(t, store.deleted)
			require.Contains(t, store.objects, rawResultKey(c.digest, c.arch))
			require.Contains(t, store.objects, parsedResultsDetailsKey(c.digest, c.arch))
		})
	}
}
func TestLegacyInventoryCountsOnlyExistingLegacyObjects(t *testing.T) {
	c, store := legacyCleanupFixture()
	objects, bytes, err := inspectLegacyScanObjects(context.Background(), store, c)
	require.NoError(t, err)
	require.EqualValues(t, 2, objects)
	require.EqualValues(t, 15, bytes)
	delete(store.objects, rawResultKey(c.digest, c.arch))
	objects, bytes, err = inspectLegacyScanObjects(context.Background(), store, c)
	require.NoError(t, err)
	require.EqualValues(t, 1, objects)
	require.EqualValues(t, 8, bytes)
	require.Empty(t, store.deleted)
}

func TestLegacyCleanupCheckpointsBeforeValidationBudgetExpires(t *testing.T) {
	c, store := legacyCleanupFixture()
	calls := 0
	store.headHook = func(ctx context.Context, _ string) error {
		calls++
		if calls <= 2 {
			return nil
		}
		<-ctx.Done()
		return ctx.Err()
	}
	ctx, cancel := context.WithTimeout(context.Background(), legacyScanCleanupDeleteReserve+100*time.Millisecond)
	defer cancel()
	completed := 0
	err := deleteLegacyScanBatch(ctx, store, []legacyScanCleanupCandidate{c, c}, func(context.Context, legacyScanCleanupCandidate) error { completed++; return nil })
	require.ErrorIs(t, err, context.DeadlineExceeded)
	require.NoError(t, ctx.Err(), "parent must retain time for deletion and checkpointing")
	require.Equal(t, 1, completed)
	require.NotContains(t, store.objects, rawResultKey(c.digest, c.arch))
	require.Contains(t, store.objects, c.rawKey)
}
