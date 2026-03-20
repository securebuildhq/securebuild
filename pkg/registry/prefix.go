// Package registry provides shared normalization helpers for OSS registry
// image prefixes. These utilities ensure consistent handling of registry
// prefixes when constructing image references and matching URLs.
package registry

import "strings"

// NormalizePrefix trims leading/trailing whitespace and removes a single
// trailing slash if present.
func NormalizePrefix(raw string) string {
	s := strings.TrimSpace(raw)
	s = strings.TrimSuffix(s, "/")
	return s
}

// ImageRef joins the normalized prefix and image name with a slash.
// This is the canonical way to build "{prefix}/{imageName}".
func ImageRef(prefix, imageName string) string {
	return NormalizePrefix(prefix) + "/" + imageName
}

// ImageRefWithTag returns an image reference with a tag,
// in the form "{prefix}/{imageName}:{tag}".
func ImageRefWithTag(prefix, imageName, tag string) string {
	return ImageRef(prefix, imageName) + ":" + tag
}

// ImageRefWithDigest returns an image reference with a digest,
// in the form "{prefix}/{imageName}@{digest}".
func ImageRefWithDigest(prefix, imageName, digest string) string {
	return ImageRef(prefix, imageName) + "@" + digest
}

// HostFromPrefix extracts the host[:port] portion from a prefix by returning
// the first path component. For example:
//
//	"ghcr.io/acme/securebuild" -> "ghcr.io"
//	"localhost:5000"            -> "localhost:5000"
func HostFromPrefix(prefix string) string {
	p := NormalizePrefix(prefix)
	if i := strings.Index(p, "/"); i >= 0 {
		return p[:i]
	}
	return p
}

// PrefixMatches reports whether url starts with the normalized prefix followed
// by a slash, or equals the normalized prefix exactly.
func PrefixMatches(url, prefix string) bool {
	p := NormalizePrefix(prefix)
	return url == p || strings.HasPrefix(url, p+"/")
}
