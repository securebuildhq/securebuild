package main

import (
	"fmt"
	"os"

	"github.com/securebuildhq/securebuild/securebuild-cmd/cli"
)

func main() {
	if err := cli.RootCmd().Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
