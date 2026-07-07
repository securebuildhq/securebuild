package githubsync

import (
	"testing"
)

func TestGetPrefix(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"postgres", "postgres", "po"},
		{"bzip2", "bzip2", "bz"},
		{"nginx", "nginx", "ng"},
		{"go", "go", "go"},
		{"a", "a", "a"},
		{"uppercase", "PostgreSQL", "po"},
		{"mixed case", "NginX", "ng"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := getPrefix(tt.input)
			if result != tt.expected {
				t.Errorf("getPrefix(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestGetVersion(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"standard version", "1.0.8", "1.0.8"},
		{"three parts", "15.2.3", "15.2.3"},
		{"with release suffix -r1", "1.0.8-r1", "1.0.8"},
		{"with release suffix -r2", "1.36.1-r2", "1.36.1"},
		{"with release suffix -r10", "2.0.0-r10", "2.0.0"},
		{"two parts", "2.4", "2.4"},
		{"single part", "3", "3"},
		{"large version", "123.456.789", "123.456.789"},
		{"version with v prefix", "v1.2.3", "1.2.3"},
		{"git version", "0.0_git20250305", "0.0_git20250305"},
		{"date-based version", "20240722.0", "20240722.0"},
		{"prerelease -rc (not revision)", "1.0.0-rc1", "1.0.0-rc1"},
		{"build metadata", "1.0.0+build.123", "1.0.0+build.123"},
		{"complex prerelease and build", "1.2.3+XYZ----123", "1.2.3+XYZ----123"},
		{"with v prefix and git", "v0.0_git20250305", "0.0_git20250305"},
		{"v prefix with revision", "v1.36.1-r1", "1.36.1"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := getVersion(tt.input)
			if result != tt.expected {
				t.Errorf("getVersion(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestGeneratePackageFile(t *testing.T) {
	tests := []struct {
		name         string
		pkg          PackageVersion
		expectedPath string
	}{
		{
			name: "standard package",
			pkg: PackageVersion{
				ID:          "pkg-123",
				PackageName: "bzip2-1.0",
				FamilyName:  "bzip2",
				Version:     "1.0.8",
				MelangeYaml: "package:\n  name: bzip2\n",
			},
			expectedPath: "packages/b/bz/bzip2/1.0.8/melange.yaml",
		},
		{
			name: "postgres package",
			pkg: PackageVersion{
				ID:          "pkg-456",
				PackageName: "postgres-15",
				FamilyName:  "postgres",
				Version:     "15.2.1",
				MelangeYaml: "package:\n  name: postgres\n",
			},
			expectedPath: "packages/p/po/postgres/15.2.1/melange.yaml",
		},
		{
			name: "short name package",
			pkg: PackageVersion{
				ID:          "pkg-789",
				PackageName: "go-1.21",
				FamilyName:  "go",
				Version:     "1.21.0",
				MelangeYaml: "package:\n  name: go\n",
			},
			expectedPath: "packages/g/go/go/1.21.0/melange.yaml",
		},
		{
			name: "path traversal attempt in family name",
			pkg: PackageVersion{
				ID:          "pkg-sec",
				PackageName: "malicious",
				FamilyName:  "../../../etc/passwd",
				Version:     "1.0.0",
				MelangeYaml: "package:\n  name: malicious\n",
			},
			expectedPath: "packages/_/__/___etc_passwd/1.0.0/melange.yaml",
		},
		{
			name: "version with prerelease",
			pkg: PackageVersion{
				ID:          "pkg-special",
				PackageName: "test",
				FamilyName:  "test",
				Version:     "1.0.0-rc1",
				MelangeYaml: "package:\n  name: test\n",
			},
			expectedPath: "packages/t/te/test/1.0.0-rc1/melange.yaml",
		},
		{
			name: "complex version with build metadata",
			pkg: PackageVersion{
				ID:          "pkg-complex",
				PackageName: "complex",
				FamilyName:  "complex",
				Version:     "1.2.3+XYZ----123",
				MelangeYaml: "package:\n  name: complex\n",
			},
			expectedPath: "packages/c/co/complex/1.2.3+XYZ----123/melange.yaml",
		},
		{
			name: "version with special characters gets sanitized",
			pkg: PackageVersion{
				ID:          "pkg-sanitize",
				PackageName: "sanitize",
				FamilyName:  "sanitize",
				Version:     "1.0.0-beta.11+exp.sha.5114f85",
				MelangeYaml: "package:\n  name: sanitize\n",
			},
			expectedPath: "packages/s/sa/sanitize/1.0.0-beta.11+exp.sha.5114f85/melange.yaml",
		},
		{
			name: "single letter package name",
			pkg: PackageVersion{
				ID:          "pkg-single",
				PackageName: "a-1.0",
				FamilyName:  "a",
				Version:     "1.0.0",
				MelangeYaml: "package:\n  name: a\n",
			},
			expectedPath: "packages/a/a/a/1.0.0/melange.yaml",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := generatePackageFile(tt.pkg)
			if err != nil {
				t.Errorf("generatePackageFile() unexpected error: %v", err)
			}
			if result.Path != tt.expectedPath {
				t.Errorf("generatePackageFile() path = %q, want %q", result.Path, tt.expectedPath)
			}
			if result.Content != tt.pkg.MelangeYaml {
				t.Errorf("generatePackageFile() content mismatch")
			}
		})
	}
}

func TestGeneratePackageAdditionalFile(t *testing.T) {
	tests := []struct {
		name         string
		packageName  string
		filename     string
		expectedPath string
	}{
		{
			name:         "patch file",
			packageName:  "bzip2",
			filename:     "bzip2-man-links.patch",
			expectedPath: "packages/b/bz/bzip2/1.0.0/bzip2-man-links.patch",
		},
		{
			name:         "config file",
			packageName:  "nginx",
			filename:     "nginx.conf",
			expectedPath: "packages/n/ng/nginx/1.0.0/nginx.conf",
		},
		{
			name:         "file in subdirectory",
			packageName:  "bzip2",
			filename:     "subdir/keyring.pub",
			expectedPath: "packages/b/bz/bzip2/1.0.0/subdir/keyring.pub",
		},
		{
			name:         "file in nested subdirectory",
			packageName:  "nginx",
			filename:     "configs/nginx/nginx.conf",
			expectedPath: "packages/n/ng/nginx/1.0.0/configs/nginx/nginx.conf",
		},
		{
			name:         "path traversal attempt in subdirectory",
			packageName:  "bzip2",
			filename:     "../../../etc/passwd",
			expectedPath: "packages/b/bz/bzip2/1.0.0/etc/passwd",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := generatePackageAdditionalFile(PackageVersion{
				ID:          "pkg-123",
				PackageName: tt.packageName,
				FamilyName:  tt.packageName,
				Version:     "1.0.0",
				MelangeYaml: "package:\n  name: " + tt.packageName + "\n",
			}, tt.filename, "content")
			if err != nil {
				t.Fatalf("generatePackageAdditionalFile() error = %v", err)
			}
			if result.Path != tt.expectedPath {
				t.Errorf("generatePackageAdditionalFile() path = %q, want %q", result.Path, tt.expectedPath)
			}
		})
	}
}

func TestGenerateImageFile(t *testing.T) {
	tests := []struct {
		name         string
		img          ImageAPKOVersion
		expectedPath string
	}{
		{
			name: "golang image with version tag",
			img: ImageAPKOVersion{
				ID:        "img-123",
				ImageName: "golang",
				Tag:       "1.25.2",
				APKOYAML:  "contents:\n  packages:\n    - go\n",
			},
			expectedPath: "images/g/go/golang/1.25.2.apko.yaml",
		},
		{
			name: "postgres image with latest tag",
			img: ImageAPKOVersion{
				ID:        "img-456",
				ImageName: "postgres",
				Tag:       "latest",
				APKOYAML:  "contents:\n  packages:\n    - postgresql\n",
			},
			expectedPath: "images/p/po/postgres/latest.apko.yaml",
		},
		{
			name: "python image with version tag",
			img: ImageAPKOVersion{
				ID:        "img-789",
				ImageName: "python",
				Tag:       "3.11",
				APKOYAML:  "contents:\n  packages:\n    - python\n",
			},
			expectedPath: "images/p/py/python/3.11.apko.yaml",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, _, err := generateImageFile(tt.img)
			if err != nil {
				t.Errorf("generateImageFile() unexpected error: %v", err)
			}
			if result.Path != tt.expectedPath {
				t.Errorf("generateImageFile() path = %q, want %q", result.Path, tt.expectedPath)
			}
			if result.Content != tt.img.APKOYAML {
				t.Errorf("generateImageFile() content mismatch")
			}
		})
	}
}

func TestSanitizeName(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"normal filename", "test.patch", "test.patch"},
		{"with path traversal", "../../../etc/passwd", "___etc_passwd"},
		{"with slashes", "path/to/file.txt", "path_to_file.txt"},
		{"with backslashes", "path\\to\\file.txt", "path_to_file.txt"},
		{"with special chars", "file@#$%.txt", "file____.txt"},
		{"alphanumeric with dash", "test-file-123.patch", "test-file-123.patch"},

		// Test valid characters: alphanumeric, dash, underscore, dot, plus
		{"with plus sign", "package-1.0.0+build123", "package-1.0.0+build123"},
		{"with underscores", "test_file_name.txt", "test_file_name.txt"},
		{"all valid chars", "pkg-1.2.3+build_456.yaml", "pkg-1.2.3+build_456.yaml"},
		{"mixed valid and invalid", "file@name+1.0_test.patch", "file_name+1.0_test.patch"},
		{"plus with spaces", "version + build info", "version_+_build_info"},
		{"multiple plus signs", "a+b+c+d", "a+b+c+d"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := sanitizeName(tt.input)
			if result != tt.expected {
				t.Errorf("sanitizeName(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestExtractFamilyName(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		// Basic examples from function comment
		{"bzip2 with version", "bzip2-1.0.8", "bzip2"},
		{"postgres with version", "postgres-15.2", "postgres"},
		{"linux-headers with version", "linux-headers-6.6", "linux-headers"},

		// Multiple dashes in family name
		{"multi-dash package", "x11-libs-libX11-1.8.6", "x11-libs-libX11"},

		// Edge cases - no version
		{"no version", "package", "package"},
		{"dash but no digit", "package-dev", "package-dev"},
		{"empty string", "", ""},

		// Version patterns
		{"single digit", "go-1", "go"},
		{"semantic version", "ruby-3.2.2", "ruby"},
		{"version with zero", "test-0", "test"},

		// Real-world examples
		{"alpine package", "alpine-base-3.18.2", "alpine-base"},
		{"package with number in name", "gtk3-3.24.38", "gtk3"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := extractFamilyName(tt.input)
			if result != tt.expected {
				t.Errorf("extractFamilyName(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}
