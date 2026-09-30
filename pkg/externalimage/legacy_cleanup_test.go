package externalimage

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
)

type legacyCleanupTestStore struct {
	objects   map[string]int64
	deleteErr error
	deleted   []string
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
	c := legacyScanCleanupCandidate{digest: "sha256:abc", arch: "x86_64", generationID: "new", state: "selected"}
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
	complete := func(context.Context, []legacyScanCleanupCandidate) error { completeCalls++; return metadataErr }
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
	for _, mode := range []string{"missing generation", "unselected", "legacy key", "canceled"} {
		t.Run(mode, func(t *testing.T) {
			c, store := legacyCleanupFixture()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			switch mode {
			case "missing generation":
				c.generationID = ""
			case "unselected":
				c.state = "validated"
			case "legacy key":
				c.rawKey = rawResultKey(c.digest, c.arch)
			case "canceled":
				cancel()
			}
			err := deleteLegacyScanBatch(ctx, store, []legacyScanCleanupCandidate{c}, func(context.Context, []legacyScanCleanupCandidate) error {
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
func TestLegacyCleanupCheckpointsWholeBatchWithoutInspectingObjects(t *testing.T) {
	c, store := legacyCleanupFixture()
	other := c
	other.digest = "sha256:other"
	other.rawKey = generationRawResultKey(other.digest, other.arch, other.generationID)
	other.detailsKey = generationParsedResultsDetailsKey(other.digest, other.arch, other.generationID)
	// Neither the replacement nor legacy objects for the second row are in the
	// fake store: cleanup trusts publication and deletes absent keys successfully.
	completed := 0
	require.NoError(t, deleteLegacyScanBatch(context.Background(), store, []legacyScanCleanupCandidate{c, other}, func(_ context.Context, batch []legacyScanCleanupCandidate) error {
		completed++
		require.Equal(t, []legacyScanCleanupCandidate{c, other}, batch)
		return nil
	}))
	require.Equal(t, 1, completed)
	require.Len(t, store.deleted, 4)
	require.Equal(t, map[string]int64{c.rawKey: 10, c.detailsKey: 20, sbomKey(c.digest, c.arch): 9}, store.objects)
}
