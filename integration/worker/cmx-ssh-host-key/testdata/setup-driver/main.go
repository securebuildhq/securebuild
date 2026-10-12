// This helper exercises complete setup with worker-style Go build metadata,
// which anchors the installed Grype and Syft versions. Go test binaries omit it.
package main

import (
	"context"
	"errors"
	"fmt"
	"os"

	_ "github.com/securebuildhq/securebuild/pkg/anchore"
	"github.com/securebuildhq/securebuild/pkg/anchoretool"
	"github.com/securebuildhq/securebuild/pkg/builder"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
)

func main() {
	if len(os.Args) == 2 && os.Args[1] == "versions" {
		for _, tool := range []anchoretool.Tool{anchoretool.Grype, anchoretool.Syft} {
			version, err := anchoretool.Version(tool)
			if err != nil {
				panic(err)
			}
			fmt.Printf("%s:%s\n", tool.Name, version)
		}
		return
	}
	if len(os.Args) != 3 {
		panic("expected database URI and VM ID")
	}
	ctx := context.WithValue(context.Background(), param.ParamContextKey, &param.Param{
		DBURI: os.Args[1], BuildBackend: "cmx", APKPublicKeyData: "Zml4dHVyZSBwdWJsaWMga2V5",
	})
	if err := persistence.InitPostgres(ctx); err != nil {
		panic(err)
	}
	defer persistence.ClosePool(ctx)
	err := builder.InstallBuildEnv(ctx, os.Args[2])
	switch {
	case err == nil:
		fmt.Println("setup-result:ready")
	case errors.Is(err, builder.ErrMachineNotFound):
		fmt.Println("setup-result:missing_machine")
	case errors.Is(err, builder.ErrSSHHostKeyVerification):
		fmt.Println("setup-result:ssh_identity_failure")
	default:
		fmt.Printf("setup-result:unexpected_error: %v\n", err)
	}
}
