# Contributing to SecureBuild

Thank you for your interest in contributing to SecureBuild! Please review our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## Ways to Contribute

- **Bug reports and feature requests** — Open an [issue](https://github.com/securebuildhq/securebuild/issues).
- **Security vulnerabilities** — See [SECURITY.md](SECURITY.md) for responsible disclosure.
- **Code and documentation** — Open a pull request (see [Submitting Changes](#submitting-changes) below).

## Development Setup

The project uses a **Nix flake** for the development environment (Go, Node, SchemaHero, apko, melange, syft, Dagger, vunnel, etc.).

### Prerequisites

You need a **container runtime** for building and running images:
- [Docker](https://docs.docker.com/get-docker/) or a Docker-compatible daemon (Docker Desktop, Colima/Lima on macOS)
- [OrbStack](https://orbstack.dev/) — a lightweight Docker-compatible runtime, especially common on macOS

### Enter the Dev Environment

1. Run `nix develop`, or
2. Use [direnv](https://direnv.net/) with `use flake` in `.envrc` so the environment loads automatically.

### See Available Targets

```bash
make help
```

### Go (worker, builder, proxies)

- **Build worker:** `make build-worker` (builds worker with embedded builder binaries).
- **Run services:** `make run-worker`, `make run-oci-proxy`, `make run-apk-proxy` (each builds first if needed).

### TypeScript (securebuild-app)

- **Install:** `cd securebuild-app && npm install`.
- **Dev server:** `npm run dev` (app on port 3000).

### Database

- **Migrations:** `make migrate` (runs SchemaHero-based migrations).

## Testing

- **Unit tests (all):** `make test-unit` — runs Go unit tests plus securebuild-app tests.
- **Go unit tests only:** `make test-unit-go`.
- **Integration tests:**
  - `make test-integration-oci-proxy`
  - `make test-integration-apk-proxy`
  - `make test-integration-worker`

CI runs tests on pull requests; run the relevant targets locally before submitting.

## Submitting Changes

1. Fork the repository and create a branch from `main`.
2. Make your changes and add tests where applicable.
3. Run the relevant test targets locally (see [Testing](#testing) above).
4. Open a pull request against `main` with a clear description of the change and the problem it solves.

For more details, see the [Development Setup](https://www.securebuild.com/docs/development) and [Contributing](https://www.securebuild.com/docs/contributing) pages in the documentation.
