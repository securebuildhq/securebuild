//go:build linux

// When building for Linux (worker running on Linux or for release), we only embed Linux builder binaries.
// All remote VMs (static/cmx) accessed over SSH are assumed to be Linux and use these binaries.
package builder

import (
	_ "embed"
	"runtime"
)

// Linux builder binaries — always included so remote VMs (SSH) get the correct Linux builder.
//
//go:embed builder-linux-amd64
var embeddedBuilderLinuxAMD64 []byte

//go:embed builder-linux-arm64
var embeddedBuilderLinuxARM64 []byte

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
// On Linux this is the Linux builder for current arch.
func GetEmbeddedBuilderForRuntime() []byte {
	if runtime.GOARCH == "amd64" {
		return embeddedBuilderLinuxAMD64
	}
	return embeddedBuilderLinuxARM64
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
