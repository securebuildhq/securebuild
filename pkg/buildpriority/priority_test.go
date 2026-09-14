package buildpriority

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestVersionKey(t *testing.T) {
	var fixtures struct {
		OrderedGroups [][]string
		Invalid       []string
		Golden        []struct{ Version, Key string }
	}
	data, err := os.ReadFile("testdata/version-keys.json")
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(data, &fixtures))
	previous := ""
	for _, group := range fixtures.OrderedGroups {
		key := VersionKey(group...)
		require.Greater(t, key, previous, "version %s", group[0])
		for _, version := range group {
			require.Equal(t, key, VersionKey(version))
		}
		previous = key
	}
	for _, version := range fixtures.Invalid {
		require.Empty(t, VersionKey(version), version)
	}
	for _, golden := range fixtures.Golden {
		require.Equal(t, golden.Key, VersionKey(golden.Version))
	}
	require.Equal(t, VersionKey("1.10.0"), VersionKey("latest", "1.9.0", "1.10", "1.8.0"))
	require.Empty(t, VersionKey())
}
