# SecureBuild

SecureBuild builds, monitors, and delivers **zero-CVE container images** from verified source code. It continuously tracks upstream patches and automatically rebuilds images when vulnerabilities are fixed — eliminating manual CVE triage and rebuild cycles.

## Key Features

- **Continuous Monitoring** — Real-time tracking of CVE disclosures across open source projects.
- **Automatic Rebuilds** — Images rebuild automatically from verified source code when patches become available.
- **Supply Chain Security** — Build attestations, SBOMs (SPDX and CycloneDX), and cryptographic provenance.
- **CI/CD Integration** — Native webhook support and integrations with GitHub Actions, GitLab CI, and more.

## Architecture

This repository contains the core services and application:

| Component | Description |
|---|---|
| **Worker** | Orchestrates builds, runs the builder for packages and images, and executes jobs. |
| **Builder** | Builds APK packages and container images (Melange, apko) for linux/amd64 and linux/arm64. |
| **OCI proxy** | Serves container images from the SecureBuild registry. |
| **APK proxy** | Serves APK packages from the package library. |
| **securebuild-app** | Next.js application for the SecureBuild product (teams, images, builds, API keys). |

## Getting Started

### Prerequisites

A **Nix flake** (`flake.nix`) provides all required tooling — Go, Node.js, SchemaHero, apko, melange, syft, Dagger, and more.

You also need a **container runtime**: [Docker](https://docs.docker.com/get-docker/), [OrbStack](https://orbstack.dev/), or Colima/Lima on macOS.

### Development Environment

Enter the dev environment using one of:

```bash
# Option 1: Nix directly
nix develop

# Option 2: direnv (auto-loads when you cd into the project)
# Add `use flake` to your .envrc
```

### Build & Run

```bash
make help                # List all available targets

make build-worker        # Build the worker (includes embedded builder binaries)
make run-worker          # Run the worker service
make run-oci-proxy       # Run the OCI proxy
make run-apk-proxy       # Run the APK proxy
make migrate             # Run database migrations (SchemaHero)
```

For the Next.js app:

```bash
cd securebuild-app && npm install
npm run dev              # Runs on port 3000
```

### Testing

```bash
make test-unit                       # All unit tests (Go + TypeScript)
make test-unit-go                    # Go unit tests only
make test-integration-oci-proxy      # OCI proxy integration tests
make test-integration-apk-proxy      # APK proxy integration tests
make test-integration-worker         # Worker integration tests
```

## Documentation

Full documentation is available at **[securebuild.com/docs](https://securebuild.com/docs)**.

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, testing, and how to submit changes.

## Security

To report a security vulnerability, see [SECURITY.md](SECURITY.md).

## License

SecureBuild is licensed under the [Apache License 2.0](LICENSE).
