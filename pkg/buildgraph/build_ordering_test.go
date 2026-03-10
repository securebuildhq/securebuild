package buildgraph

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestBuildDAG(t *testing.T) {
	tests := []struct {
		name          string
		deps          map[string][]string
		entry         string
		expectedNodes []string
		expectedEdges []Edge
	}{
		{
			name: "simple linear chain",
			deps: map[string][]string{
				"a": {"b"},
				"b": {"c"},
				"c": {},
			},
			entry:         "a",
			expectedNodes: []string{"a", "b", "c"},
			expectedEdges: []Edge{
				{From: "a", To: "b"},
				{From: "b", To: "c"},
			},
		},
		{
			name: "single node",
			deps: map[string][]string{
				"a": {},
			},
			entry:         "a",
			expectedNodes: []string{"a"},
			expectedEdges: nil,
		},
		{
			name: "diamond dependency",
			deps: map[string][]string{
				"a": {"b", "c"},
				"b": {"d"},
				"c": {"d"},
				"d": {},
			},
			entry:         "a",
			expectedNodes: []string{"a", "b", "c", "d"},
			expectedEdges: []Edge{
				{From: "a", To: "b"},
				{From: "a", To: "c"},
				{From: "b", To: "d"},
				{From: "c", To: "d"},
			},
		},
		{
			name: "chat test",
			deps: map[string][]string{
				"A": {"B"},
				"B": {"C", "D", "E"},
				"C": {"A", "F"},
				"D": {},
				"E": {},
				"F": {},
			},
			entry:         "A",
			expectedNodes: []string{"A", "B", "C", "D", "E", "F", "A#2", "B#2", "C#2"},
			expectedEdges: []Edge{
				{From: "A", To: "B"},
				{From: "B", To: "C"},
				{From: "C", To: "A#2"},
				{From: "A#2", To: "B#2"},
				{From: "B#2", To: "C#2"},
				{From: "B#2", To: "D"},
				{From: "B#2", To: "E"},
				{From: "C#2", To: "F"},
			},
		},
		{
			name: "cycle requiring two builds",
			deps: map[string][]string{
				"a": {"b"},
				"b": {"c"},
				"c": {"a"},
			},
			entry:         "a",
			expectedNodes: []string{"a", "b", "c", "a#2", "b#2", "c#2"},
			expectedEdges: []Edge{
				{From: "a", To: "b"},
				{From: "b", To: "c"},
				{From: "c", To: "a#2"},
				{From: "a#2", To: "b#2"},
				{From: "b#2", To: "c#2"},
			},
		},
		{
			name: "cycle requiring two builds, reverse alphabetical order",
			deps: map[string][]string{
				"c": {"b"},
				"b": {"a"},
				"a": {"c"},
			},
			entry:         "c",
			expectedNodes: []string{"c", "b", "a", "c#2", "b#2", "a#2"},
			expectedEdges: []Edge{
				{From: "c", To: "b"},
				{From: "b", To: "a"},
				{From: "a", To: "c#2"},
				{From: "c#2", To: "b#2"},
				{From: "b#2", To: "a#2"},
			},
		},
		{
			name: "self-loop",
			deps: map[string][]string{
				"a": {"a"},
			},
			entry:         "a",
			expectedNodes: []string{"a", "a#2"},
			expectedEdges: []Edge{
				{From: "a", To: "a#2"},
			},
		},
		{
			name: "self loop with entry and tail",
			deps: map[string][]string{
				"a":    {"self"},
				"self": {"self", "b"},
				"b":    {},
			},
			entry:         "a",
			expectedNodes: []string{"a", "b", "self", "self#2"},
			expectedEdges: []Edge{
				{From: "a", To: "self"},
				{From: "self", To: "self#2"},
				{From: "self#2", To: "b"},
			},
		},
		{
			name: "delayed cycle requiring two builds",
			deps: map[string][]string{
				"a": {"b"},
				"b": {"c", "e"},
				"c": {"d"},
				"d": {"b"},
				"e": {},
			},
			entry:         "a",
			expectedNodes: []string{"a", "b", "c", "d", "e", "b#2", "c#2", "d#2"},
			expectedEdges: []Edge{
				{From: "a", To: "b"},
				{From: "b", To: "c"},
				{From: "c", To: "d"},
				{From: "d", To: "b#2"},
				{From: "b#2", To: "c#2"},
				{From: "c#2", To: "d#2"},
				{From: "b#2", To: "e"},
			},
		},
		{
			name: "two cycles requiring two builds",
			deps: map[string][]string{
				"a":    {"c1.0", "c2.0"},
				"c1.0": {"c1.1"},
				"c1.1": {"c1.2"},
				"c1.2": {"c1.3"},
				"c1.3": {"c1.0"},
				"c2.0": {"c2.1"},
				"c2.1": {"c2.0"},
			},
			entry:         "a",
			expectedNodes: []string{"a", "c1.0", "c1.1", "c1.2", "c1.3", "c2.0", "c2.1", "c1.0#2", "c1.1#2", "c1.2#2", "c1.3#2", "c2.0#2", "c2.1#2"},
			expectedEdges: []Edge{
				{From: "a", To: "c1.0"},
				{From: "c1.0", To: "c1.1"},
				{From: "c1.1", To: "c1.2"},
				{From: "c1.2", To: "c1.3"},
				{From: "c1.3", To: "c1.0#2"},
				{From: "c1.0#2", To: "c1.1#2"},
				{From: "c1.1#2", To: "c1.2#2"},
				{From: "c1.2#2", To: "c1.3#2"},
				{From: "a", To: "c2.0"},
				{From: "c2.0", To: "c2.1"},
				{From: "c2.1", To: "c2.0#2"},
				{From: "c2.0#2", To: "c2.1#2"},
			},
		},
		{
			name: "two cycles requiring two builds, with tail",
			deps: map[string][]string{
				"a":    {"c1.0", "c2.0"},
				"c1.0": {"c1.1"},
				"c1.1": {"c1.2", "f"},
				"c1.2": {"c1.3"},
				"c1.3": {"c1.0"},
				"c2.0": {"c2.1"},
				"c2.1": {"c2.0", "f"},
				"f":    {},
			},
			entry:         "a",
			expectedNodes: []string{"a", "c1.0", "c1.1", "c1.2", "c1.3", "c2.0", "c2.1", "f", "c1.0#2", "c1.1#2", "c1.2#2", "c1.3#2", "c2.0#2", "c2.1#2"},
			expectedEdges: []Edge{
				{From: "a", To: "c1.0"},
				{From: "a", To: "c2.0"},
				{From: "c1.0", To: "c1.1"},
				{From: "c1.1", To: "c1.2"},
				{From: "c1.2", To: "c1.3"},
				{From: "c1.3", To: "c1.0#2"},
				{From: "c1.0#2", To: "c1.1#2"},
				{From: "c1.1#2", To: "c1.2#2"},
				{From: "c1.1#2", To: "f"},
				{From: "c1.2#2", To: "c1.3#2"},
				{From: "c2.0", To: "c2.1"},
				{From: "c2.1", To: "c2.0#2"},
				{From: "c2.0#2", To: "c2.1#2"},
				{From: "c2.1#2", To: "f"},
			},
		},
		{
			name: "two cycles requiring two builds, with tail of another cycle",
			deps: map[string][]string{
				"a":    {"c1.0", "c2.0"},
				"c1.0": {"c1.1"},
				"c1.1": {"c1.2", "f"},
				"c1.2": {"c1.3"},
				"c1.3": {"c1.0"},
				"c2.0": {"c2.1"},
				"c2.1": {"c2.0", "f"},
				"f":    {"f.0"},
				"f.0":  {"f.1"},
				"f.1":  {"f.2"},
				"f.2":  {"f.0"},
			},
			entry:         "a",
			expectedNodes: []string{"a", "c1.0", "c1.1", "c1.2", "c1.3", "c2.0", "c2.1", "f", "f.0", "f.1", "f.2", "c1.0#2", "c1.1#2", "c1.2#2", "c1.3#2", "c2.0#2", "c2.1#2", "f.0#2", "f.1#2", "f.2#2"},
			expectedEdges: []Edge{
				{From: "a", To: "c1.0"},
				{From: "a", To: "c2.0"},
				{From: "c1.0", To: "c1.1"},
				{From: "c1.1", To: "c1.2"},
				{From: "c1.2", To: "c1.3"},
				{From: "c1.3", To: "c1.0#2"},
				{From: "c1.0#2", To: "c1.1#2"},
				{From: "c1.1#2", To: "c1.2#2"},
				{From: "c1.1#2", To: "f"},
				{From: "c1.2#2", To: "c1.3#2"},
				{From: "c2.0", To: "c2.1"},
				{From: "c2.1", To: "c2.0#2"},
				{From: "c2.0#2", To: "c2.1#2"},
				{From: "c2.1#2", To: "f"},
				{From: "f", To: "f.0"},
				{From: "f.0", To: "f.1"},
				{From: "f.1", To: "f.2"},
				{From: "f.2", To: "f.0#2"},
				{From: "f.0#2", To: "f.1#2"},
				{From: "f.1#2", To: "f.2#2"},
			},
		},
		{
			name: "two intersecting cycles",
			deps: map[string][]string{
				"a":     {"left", "right"},
				"left":  {"cross"},
				"right": {"cross"},
				"cross": {"left", "right"},
			},
			entry:         "a",
			expectedNodes: []string{"a", "left", "cross", "right", "left#2", "cross#2", "right#2"},
			expectedEdges: []Edge{
				{From: "a", To: "left"},
				{From: "a", To: "right"},
				{From: "left", To: "cross"},
				{From: "right", To: "cross"},
				{From: "cross", To: "left#2"},
				{From: "cross", To: "right#2"},
				{From: "left#2", To: "cross#2"},
				{From: "right#2", To: "cross#2"},
			},
		},
		{
			name: "parallel loops",
			deps: map[string][]string{
				"a":     {"left", "right"},
				"left":  {"cross"},
				"right": {"cross"},
				"cross": {"a"},
			},
			entry:         "a",
			expectedNodes: []string{"a", "left", "cross", "right", "a#2", "left#2", "cross#2", "right#2"},
			expectedEdges: []Edge{
				{From: "a", To: "left"},
				{From: "a", To: "right"},
				{From: "left", To: "cross"},
				{From: "right", To: "cross"},
				{From: "cross", To: "a#2"},
				{From: "a#2", To: "left#2"},
				{From: "a#2", To: "right#2"},
				{From: "left#2", To: "cross#2"},
				{From: "right#2", To: "cross#2"},
			},
		},
		{
			name: "three independent chains",
			deps: map[string][]string{
				"a":   {"1.0", "2.0", "3.0"},
				"1.0": {"1.1"},
				"1.1": {"1.2"},
				"1.2": {},
				"2.0": {"2.1"},
				"2.1": {"2.2"},
				"2.2": {},
				"3.0": {"3.1"},
				"3.1": {"3.2"},
				"3.2": {},
			},
			entry: "a",
			expectedNodes: []string{
				"a",
				"1.0", "1.1", "1.2",
				"2.0", "2.1", "2.2",
				"3.0", "3.1", "3.2",
			},
			expectedEdges: []Edge{
				{From: "a", To: "1.0"},
				{From: "a", To: "2.0"},
				{From: "a", To: "3.0"},
				{From: "1.0", To: "1.1"},
				{From: "1.1", To: "1.2"},
				{From: "2.0", To: "2.1"},
				{From: "2.1", To: "2.2"},
				{From: "3.0", To: "3.1"},
				{From: "3.1", To: "3.2"},
			},
		},
		{
			name: "three independent chains with irrelevant dependencies",
			deps: map[string][]string{
				"a":   {"1.0", "2.0", "3.0"},
				"1.0": {"1.1"},
				"1.1": {"1.2"},
				"1.2": {},
				"2.0": {"2.1"},
				"2.1": {"2.2"},
				"2.2": {},
				"3.0": {"3.1"},
				"3.1": {"3.2"},
				"3.2": {},
				"4.0": {"1.0"},
				"5.0": {"2.0"},
				"6.0": {"3.0"},
			},
			entry: "a",
			expectedNodes: []string{
				"a",
				"1.0", "1.1", "1.2",
				"2.0", "2.1", "2.2",
				"3.0", "3.1", "3.2",
			},
			expectedEdges: []Edge{
				{From: "a", To: "1.0"},
				{From: "a", To: "2.0"},
				{From: "a", To: "3.0"},
				{From: "1.0", To: "1.1"},
				{From: "1.1", To: "1.2"},
				{From: "2.0", To: "2.1"},
				{From: "2.1", To: "2.2"},
				{From: "3.0", To: "3.1"},
				{From: "3.1", To: "3.2"},
			},
		},
		{
			name: "three independent chains, starting from the first chain",
			deps: map[string][]string{
				"a":   {"1.0", "2.0", "3.0"},
				"1.0": {"1.1"},
				"1.1": {"1.2"},
				"1.2": {},
				"2.0": {"2.1"},
				"2.1": {"2.2"},
				"2.2": {},
				"3.0": {"3.1"},
				"3.1": {"3.2"},
				"3.2": {},
			},
			entry: "1.0",
			expectedNodes: []string{
				"1.0", "1.1", "1.2",
			},
			expectedEdges: []Edge{
				{From: "1.0", To: "1.1"},
				{From: "1.1", To: "1.2"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resultNodes, resultEdges := BuildDAG(tt.deps, tt.entry)
			require.ElementsMatch(t, tt.expectedNodes, resultNodes)
			require.ElementsMatch(t, tt.expectedEdges, resultEdges)
		})
	}
}

func TestCollectReachable(t *testing.T) {
	tests := []struct {
		name     string
		deps     map[string][]string
		start    string
		expected map[string]bool
	}{
		{
			name: "single node",
			deps: map[string][]string{
				"a": {},
			},
			start: "a",
			expected: map[string]bool{
				"a": true,
			},
		},
		{
			name: "linear chain",
			deps: map[string][]string{
				"a": {"b"},
				"b": {"c"},
				"c": {},
			},
			start: "a",
			expected: map[string]bool{
				"a": true,
				"b": true,
				"c": true,
			},
		},
		{
			name: "diamond structure",
			deps: map[string][]string{
				"a": {"b", "c"},
				"b": {"d"},
				"c": {"d"},
				"d": {},
			},
			start: "a",
			expected: map[string]bool{
				"a": true,
				"b": true,
				"c": true,
				"d": true,
			},
		},
		{
			name: "cycle",
			deps: map[string][]string{
				"a": {"b"},
				"b": {"c"},
				"c": {"a"},
			},
			start: "a",
			expected: map[string]bool{
				"a": true,
				"b": true,
				"c": true,
			},
		},
		{
			name: "disconnected graph",
			deps: map[string][]string{
				"a": {"b"},
				"b": {},
				"c": {"d"},
				"d": {},
			},
			start: "a",
			expected: map[string]bool{
				"a": true,
				"b": true,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := collectReachable(tt.deps, tt.start)
			require.Equal(t, tt.expected, result)
		})
	}
}

func TestReduceEdges(t *testing.T) {
	tests := []struct {
		name     string
		edges    []Edge
		expected []Edge
	}{
		{
			name:     "empty edges",
			edges:    []Edge{},
			expected: []Edge{},
		},
		{
			name: "single edge",
			edges: []Edge{
				{From: "A", To: "B"},
			},
			expected: []Edge{
				{From: "A", To: "B"},
			},
		},
		{
			name: "two independent edges",
			edges: []Edge{
				{From: "A", To: "B"},
				{From: "C", To: "D"},
			},
			expected: []Edge{
				{From: "A", To: "B"},
				{From: "C", To: "D"},
			},
		},
		{
			name: "simple transitive reduction",
			edges: []Edge{
				{From: "A", To: "B"},
				{From: "B", To: "C"},
				{From: "A", To: "C"}, // redundant: A->C can be reached via A->B->C
			},
			expected: []Edge{
				{From: "A", To: "B"},
				{From: "B", To: "C"},
			},
		},
		{
			name: "diamond pattern with redundant edge",
			edges: []Edge{
				{From: "A", To: "B"},
				{From: "A", To: "C"},
				{From: "B", To: "D"},
				{From: "C", To: "D"},
				{From: "A", To: "D"}, // redundant: A->D can be reached via A->B->D or A->C->D
			},
			expected: []Edge{
				{From: "A", To: "B"},
				{From: "A", To: "C"},
				{From: "B", To: "D"},
				{From: "C", To: "D"},
			},
		},
		{
			name: "longer chain with multiple redundant edges",
			edges: []Edge{
				{From: "A", To: "B"},
				{From: "B", To: "C"},
				{From: "C", To: "D"},
				{From: "A", To: "C"}, // redundant: A->C via A->B->C
				{From: "A", To: "D"}, // redundant: A->D via A->B->C->D
				{From: "B", To: "D"}, // redundant: B->D via B->C->D
			},
			expected: []Edge{
				{From: "A", To: "B"},
				{From: "B", To: "C"},
				{From: "C", To: "D"},
			},
		},
		{
			name: "no redundancy - all edges necessary",
			edges: []Edge{
				{From: "A", To: "B"},
				{From: "A", To: "C"},
				{From: "B", To: "D"},
				{From: "C", To: "E"},
			},
			expected: []Edge{
				{From: "A", To: "B"},
				{From: "A", To: "C"},
				{From: "B", To: "D"},
				{From: "C", To: "E"},
			},
		},
		{
			name: "complex graph with mixed redundancy",
			edges: []Edge{
				{From: "A", To: "B"},
				{From: "A", To: "C"},
				{From: "B", To: "D"},
				{From: "C", To: "D"},
				{From: "D", To: "E"},
				{From: "A", To: "D"}, // redundant: A->D via A->B->D or A->C->D
				{From: "B", To: "E"}, // redundant: B->E via B->D->E
				{From: "C", To: "E"}, // redundant: C->E via C->D->E
			},
			expected: []Edge{
				{From: "A", To: "B"},
				{From: "A", To: "C"},
				{From: "B", To: "D"},
				{From: "C", To: "D"},
				{From: "D", To: "E"},
			},
		},
		{
			name: "multiple paths with one redundant",
			edges: []Edge{
				{From: "A", To: "B"},
				{From: "A", To: "C"},
				{From: "B", To: "D"},
				{From: "C", To: "D"},
				{From: "A", To: "E"}, // redundant: A->E via A->B->D->E or A->C->D->E
				{From: "D", To: "E"}, // not redundant - D->E is necessary
			},
			expected: []Edge{
				{From: "A", To: "B"},
				{From: "A", To: "C"},
				{From: "B", To: "D"},
				{From: "C", To: "D"},
				{From: "D", To: "E"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := reduceEdges(tt.edges)
			require.ElementsMatch(t, tt.expected, result)
		})
	}
}
