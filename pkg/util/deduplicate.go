package util

func Deduplicate[T comparable](input []T) []T {
	seen := make(map[T]bool)
	var result []T
	for _, dep := range input {
		if !seen[dep] {
			seen[dep] = true
			result = append(result, dep)
		}
	}
	return result
}
