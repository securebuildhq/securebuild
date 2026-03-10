package testutil

import (
	"fmt"
	"os"
	"path/filepath"
)

// FindProjectRoot walks up from current directory to find go.mod
func FindProjectRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}

	for dir != "/" {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir, nil
		}
		dir = filepath.Dir(dir)
	}

	return "", fmt.Errorf("could not find project root (go.mod)")
}
