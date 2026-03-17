//go:build darwin

// When building for Darwin (worker running on Mac), we embed both Linux and Darwin builder binaries.
// Linux binaries are always required: all remote VMs (static/cmx) accessed over SSH are assumed to be Linux.
// Darwin binaries are only used for the local backend when building and running on Mac.
package builder

import (
	_ "embed"
	"runtime"
)

// Linux builder binaries — always included so remote VMs (SSH) get the correct Linux builder.
//go:embed builder-linux-amd64
var embeddedBuilderLinuxAMD64 []byte

//go:embed builder-linux-arm64
var embeddedBuilderLinuxARM64 []byte

// Darwin builder binaries — only for local backend when building and running on Mac.
//go:embed builder-darwin-amd64
var embeddedBuilderDarwinAMD64 []byte

//go:embed builder-darwin-arm64
var embeddedBuilderDarwinARM64 []byte

// GetEmbeddedBuilder returns the embedded Linux builder binary for the specified architecture.
// Used for all remote VMs (static/cmx) over SSH; remote VMs are always assumed to be Linux.
func GetEmbeddedBuilder(architecture string) []byte {
	switch architecture {
	case "x86_64", "amd64":
		return embeddedBuilderLinuxAMD64
	case "aarch64", "arm64":
		return embeddedBuilderLinuxARM64
	default:
		return nil
	}
}

// GetEmbeddedBuilderForRuntime returns the builder binary for the current runtime (GOOS/GOARCH).
// On Darwin this is the Darwin builder, used only for local backend when building and running on Mac.
func GetEmbeddedBuilderForRuntime() []byte {
	if runtime.GOARCH == "amd64" {
		return embeddedBuilderDarwinAMD64
	}
	return embeddedBuilderDarwinARM64
}

// IsBuilderEmbeddedForRuntime returns true if a builder binary is embedded for the current runtime.
func IsBuilderEmbeddedForRuntime() bool {
	return len(GetEmbeddedBuilderForRuntime()) > 0
}

// GetSupportedArchitectures returns a list of architectures for which Linux builder binaries are embedded.
func GetSupportedArchitectures() []string {
	var supported []string
	if len(embeddedBuilderLinuxAMD64) > 0 {
		supported = append(supported, "x86_64")
	}
	if len(embeddedBuilderLinuxARM64) > 0 {
		supported = append(supported, "aarch64")
	}
	return supported
}
