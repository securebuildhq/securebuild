package util

// NullIfEmpty returns nil if the string is empty, otherwise returns the string.
// Use this when inserting into nullable text columns where NULL (not empty string)
// has semantic meaning (e.g. presence of git_remote indicates a linked package).
func NullIfEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
