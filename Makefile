# Default target
.PHONY: help
help:
	@echo "SecureBuild Service - Available Make Targets:"
	@echo ""
	@echo "Development:"
	@echo "  build-worker        - Build worker with embedded builder binaries"
	@echo "  build-worker-release - Build worker for linux/amd64 and linux/arm64 (release)"
	@echo "  build-builder  - Build builder binaries for Linux x86_64 and aarch64"
	@echo "  run-worker     - Run the worker service"
	@echo "  run-oci-proxy  - Run the OCI proxy service"
	@echo "  run-apk-proxy  - Run the APK proxy service"
	@echo ""
	@echo "Database:"
	@echo "  migrate        - Run database migrations using schemahero"
	@echo ""
	@echo "Testing:"
	@echo "  test-unit                   - Run all unit tests (Go + securebuild-www + securebuild-app)"
	@echo "  test-unit-go                - Run Go unit tests only"
	@echo "  test-integration-oci-proxy  - Run OCI proxy integration tests"
	@echo "  test-integration-apk-proxy       - Run APK proxy integration tests"
	@echo "  test-integration-worker          - Run worker integration tests"
	@echo ""
	@echo "E2E Testing:"
	@echo "  For E2E tests, use npm scripts in the e2e/ directory:"
	@echo "    cd e2e && npm run test:app        - Run app E2E tests (CI/PR mode)"
	@echo "    cd e2e && npm run test:app:ui     - Run app tests in interactive UI mode"
	@echo ""
	@echo "Deployment:"
	@echo "  release        - Create a new release using Dagger"
	@echo "  release-www    - Release securebuild-www using Dagger"
	@echo "  release-docs   - Release securebuild-docs using Dagger"
	@echo ""

# All Go source files and module files. Used for binary dependencies.
GO_SOURCES := $(shell find . -type f -name '*.go')
GO_MODULE_FILES := go.mod go.sum

# Disable CGO for all Go builds to create static binaries
export CGO_ENABLED=0

# Build version info (set at build time; release workflow overrides VERSION and GIT_SHA)
VERSION_PACKAGE := github.com/securebuildhq/securebuild/pkg/buildversion
VERSION ?= 0.0.0-dev
GIT_SHA ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_TIME ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
BUILD_LDFLAGS := -X $(VERSION_PACKAGE).version=$(VERSION) -X $(VERSION_PACKAGE).gitSHA=$(GIT_SHA) -X $(VERSION_PACKAGE).buildTime=$(BUILD_TIME)

.PHONY: migrate
migrate:
	@echo "Running migrations..."
	rm -rf db/plan
	mkdir -p db/plan
	schemahero plan --driver postgres --spec-file db/schema/tables --out ./db/plan/plan.yaml --uri postgres://postgres:password@localhost:15432/securebuild --seed-data
	schemahero apply --driver postgres --ddl ./db/plan/plan.yaml --uri postgres://postgres:password@localhost:15432/securebuild

.PHONY: create-fake-builder
create-fake-builder:
	@touch pkg/builder/builder-linux-amd64
	@touch pkg/builder/builder-linux-arm64

.PHONY: test-unit-go
test-unit-go: create-fake-builder
	@go test -v -short ./pkg/... ./cmd/...

.PHONY: test-integration-oci-proxy
test-integration-oci-proxy: create-fake-builder
	@echo "Running OCI proxy integration tests..."
	@go test -v ./integration/ociproxy/...

.PHONY: test-integration-apk-proxy
test-integration-apk-proxy: create-fake-builder
	@go test -v ./integration/apkproxy/...

.PHONY: test-integration-worker
test-integration-worker: create-fake-builder
	@echo "Running worker integration tests..."
	@go test -v ./integration/worker/...

.PHONY: test-unit
test-unit: test-unit-go
	@echo "Running securebuild-www unit tests..."
	@cd securebuild-www && npm ci && npm test
	@echo "Running securebuild-app unit tests..."
	@cd securebuild-app && npm ci && npm test
	@echo "All unit tests passed!"

.PHONY: release
release:
	dagger call release \
		--version patch \
		--github-token env:GITHUB_TOKEN \
		--doppler-key env:DOPPLER_KEY_SECUREBUILD_PROD \
		--progress plain

.PHONY: release-www
release-www:
	dagger call release-www \
		--doppler-key env:DOPPLER_KEY_SECUREBUILD_PROD \
		--progress plain \
		--version 20250609-142925

.PHONY: release-docs
release-docs:
	dagger call release-docs \
		--doppler-key env:DOPPLER_KEY_SECUREBUILD_PROD \
		--progress plain \
		--version 20250609-142925

pkg/builder/builder-linux-amd64: $(GO_SOURCES) $(GO_MODULE_FILES)
	GOOS=linux GOARCH=amd64 go build -o pkg/builder/builder-linux-amd64 builder-cmd/main.go

pkg/builder/builder-linux-arm64: $(GO_SOURCES) $(GO_MODULE_FILES)
	GOOS=linux GOARCH=arm64 go build -o pkg/builder/builder-linux-arm64 builder-cmd/main.go

.PHONY: build-builder
build-builder: pkg/builder/builder-linux-amd64 pkg/builder/builder-linux-arm64

bin/worker: pkg/builder/builder-linux-amd64 pkg/builder/builder-linux-arm64 $(GO_SOURCES) $(GO_MODULE_FILES)
	go build -ldflags "$(BUILD_LDFLAGS)" -o bin/worker cmd/main.go

.PHONY: build-worker
build-worker: bin/worker

# Cross-compiled worker binaries for release (linux/amd64 and linux/arm64).
# Embeds both builder binaries so the worker can build for either arch.
# Set VERSION and GIT_SHA in CI (e.g. VERSION=1.2.3 GIT_SHA=abc1234 make build-worker-release).
.PHONY: build-worker-release
build-worker-release: build-worker-release-amd64 build-worker-release-arm64

# Build worker for a single arch (for parallel CI; set VERSION and GIT_SHA in CI).
.PHONY: build-worker-release-amd64 build-worker-release-arm64
build-worker-release-amd64: pkg/builder/builder-linux-amd64 pkg/builder/builder-linux-arm64
	@echo "Building worker for linux/amd64..."
	GOOS=linux GOARCH=amd64 go build -ldflags "$(BUILD_LDFLAGS)" -o bin/securebuild-worker-linux-amd64 cmd/main.go

build-worker-release-arm64: pkg/builder/builder-linux-amd64 pkg/builder/builder-linux-arm64
	@echo "Building worker for linux/arm64..."
	GOOS=linux GOARCH=arm64 go build -ldflags "$(BUILD_LDFLAGS)" -o bin/securebuild-worker-linux-arm64 cmd/main.go

.PHONY: run-worker
run-worker: build-worker
	./bin/worker run

.PHONY: run-oci-proxy
run-oci-proxy: build-worker
	./bin/worker oci-proxy

.PHONY: run-apk-proxy
run-apk-proxy: build-worker
	./bin/worker apk-proxy

.PHONY: build-autoimg
build-autoimg:
	go build -o bin/autoimg autoimg-cmd/main.go

.PHONY: run-autoimg
run-autoimg: build-autoimg
	./bin/autoimg

.PHONY: clean-worker
clean-worker:
	rm -f ./bin/worker
