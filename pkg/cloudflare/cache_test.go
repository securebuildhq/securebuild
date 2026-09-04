package cloudflare

import "testing"

func TestSplitPurgeURLs(t *testing.T) {
	urls := make([]string, 251)
	batches := splitPurgeURLs(urls, 100)
	if len(batches) != 3 {
		t.Fatalf("got %d batches, want 3", len(batches))
	}
	want := []int{100, 100, 51}
	for i := range batches {
		if len(batches[i]) != want[i] {
			t.Fatalf("batch %d has %d URLs, want %d", i, len(batches[i]), want[i])
		}
	}
}
