package main

import (
	"fmt"
	"os"

	"github.com/securebuildhq/securebuild/cmd/cli"
)

func main() {

	if err := cli.RootCmd().Execute(); err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
}
