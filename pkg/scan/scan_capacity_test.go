package scan

import (
	"sync"
	"testing"
	"time"

	buildertypes "github.com/securebuildhq/securebuild/pkg/builder/types"
	"github.com/stretchr/testify/require"
)

func TestScanReservationSurvivesRefresh(t *testing.T) {
	c := NewScanCapacityCache()
	b := BuilderForScan{BuilderVM: buildertypes.BuilderVM{ID: "busy"}, HasBuildAssignment: true}
	r := c.tryReserveSlot(b, 16)
	require.NotNil(t, r)
	defer r.Release()
	for range 3 {
		c.SetBuilderScans(b.ID, nil, time.Now())
		require.Nil(t, c.tryReserveSlot(b, 16), "a pending download must retain the busy builder's only slot")
	}
	require.ElementsMatch(t, []string{b.ID}, c.GetBuilderIDs())
	r.Release()
	r.Release()
	require.Zero(t, c.GetTotalScanCount())
	next := c.tryReserveSlot(b, 16)
	require.NotNil(t, next)
	next.Release()
}

func TestScanReservationCommitAndPollRace(t *testing.T) {
	for _, observedBeforeCommit := range []bool{false, true} {
		t.Run(map[bool]string{false: "unobserved", true: "observed"}[observedBeforeCommit], func(t *testing.T) {
			c := NewScanCapacityCache()
			b := BuilderForScan{BuilderVM: buildertypes.BuilderVM{ID: "builder"}}
			r := c.tryReserveSlot(b, 2)
			info := ScanDirInfo{Digest: "sha256:scan", ScanGenerationID: "generation"}
			if observedBeforeCommit {
				c.SetBuilderScans(b.ID, []ScanDirInfo{info}, time.Now())
			}
			pollStarted := time.Now().Add(-time.Second)
			r.Commit(info)
			r.Commit(info)
			r.Release()
			require.Equal(t, 1, c.GetTotalScanCount(), "commit must replace the reservation, not double-count its directory")
			c.SetBuilderScans(b.ID, nil, pollStarted)
			require.Equal(t, 1, c.GetTotalScanCount(), "an older snapshot must not erase a newly launched scan")
			c.SetBuilderScans(b.ID, nil, time.Now())
			require.Zero(t, c.GetTotalScanCount(), "a fresh filesystem snapshot remains authoritative")
		})
	}
}

func TestScanReservationReleaseDoesNotFreeOtherWork(t *testing.T) {
	c := NewScanCapacityCache()
	b := BuilderForScan{BuilderVM: buildertypes.BuilderVM{ID: "builder"}}
	r := c.tryReserveSlot(b, 2)
	c.SetBuilderScans(b.ID, []ScanDirInfo{{Digest: "existing"}}, time.Now())
	r.Release()
	require.Equal(t, 1, c.GetTotalScanCount())
	pending := c.tryReserveSlot(b, 2)
	c.RemoveScan(b.ID, "existing")
	require.Equal(t, 1, c.GetTotalScanCount())
	c.RemoveBuilder(b.ID)
	replacement := c.tryReserveSlot(b, 2)
	pending.Release()
	pending.Commit(ScanDirInfo{Digest: "obsolete"})
	require.Equal(t, 1, c.GetTotalScanCount(), "a removed reservation must not affect a new reservation for the same machine")
	replacement.Release()
	require.Zero(t, c.GetTotalScanCount())
}

func TestConcurrentScanReservationsRespectCapacity(t *testing.T) {
	c := NewScanCapacityCache()
	b := BuilderForScan{BuilderVM: buildertypes.BuilderVM{ID: "builder"}}
	const limit = 4
	var wg sync.WaitGroup
	reserved := make(chan *ScanReservation, 100)
	for range 100 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c.SetBuilderScans(b.ID, nil, time.Now())
			if r := c.tryReserveSlot(b, limit); r != nil {
				reserved <- r
			}
		}()
	}
	wg.Wait()
	close(reserved)
	require.Len(t, reserved, limit)
	require.Equal(t, limit, c.GetTotalScanCount())
	for r := range reserved {
		r.Release()
	}
	require.Zero(t, c.GetTotalScanCount())
}

func TestMissingBuilderSnapshotPreservesLaterDispatches(t *testing.T) {
	c := NewScanCapacityCache()
	b := BuilderForScan{BuilderVM: buildertypes.BuilderVM{ID: "builder"}}
	old := ScanDirInfo{Digest: "existing", ScanGenerationID: "old"}
	c.SetBuilderScans(b.ID, []ScanDirInfo{old}, time.Now())
	snapshot := c.SnapshotBuilderScans()
	pending := c.tryReserveSlot(b, 3)
	launched := c.tryReserveSlot(b, 3)
	require.NotNil(t, pending)
	require.NotNil(t, launched)
	launched.Commit(ScanDirInfo{Digest: "existing", ScanGenerationID: "new"})
	for _, entry := range snapshot[b.ID] {
		c.RemoveSnapshotScan(b.ID, entry)
	}
	require.Equal(t, 2, c.GetTotalScanCount(), "old cleanup must preserve both the replacement scan and pending download")
	require.Equal(t, "new", c.GetScansForBuilder(b.ID)[0].ScanGenerationID)
	// Removing a genuinely missing active scan still leaves pending work owned
	// by its handler, which can release it when dispatch fails.
	for _, entry := range c.SnapshotBuilderScans()[b.ID] {
		c.RemoveSnapshotScan(b.ID, entry)
	}
	require.Equal(t, 1, c.GetTotalScanCount())
	pending.Release()
	require.Zero(t, c.GetTotalScanCount())
}

func TestMissingBuilderSnapshotPreservesCommitOfObservedDirectory(t *testing.T) {
	c := NewScanCapacityCache()
	b := BuilderForScan{BuilderVM: buildertypes.BuilderVM{ID: "builder"}}
	r := c.tryReserveSlot(b, 2)
	info := ScanDirInfo{Digest: "scan", ScanGenerationID: "generation"}
	c.SetBuilderScans(b.ID, []ScanDirInfo{info}, time.Now())
	snapshot := c.SnapshotBuilderScans()
	// The poller observed files during preparation, but the handler committed
	// that same generation after the fleet snapshot began.
	r.Commit(info)
	c.RemoveSnapshotScan(b.ID, snapshot[b.ID][0])
	require.Equal(t, 1, c.GetTotalScanCount())
	r.Release()
	require.Equal(t, 1, c.GetTotalScanCount())
}
