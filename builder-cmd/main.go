package main

import (
	"os"

	"github.com/securebuildhq/securebuild/builder-cmd/cli"
	"github.com/securebuildhq/securebuild/pkg/logger"
)

func main() {
	if err := cli.RootCmd().Execute(); err != nil {
		logger.Error(err)
		os.Exit(1)
	}
}
