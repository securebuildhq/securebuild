# Contributing to SecureBuild

## Ways to contribute

- **Bug reports and feature requests** – Open an [issue](https://github.com/securebuildhq/securebuild/issues).
- **Code and documentation** – Open a pull request (see [Submitting changes](#submitting-changes) below).

## Development setup

The project uses a **Nix flake** for the development environment (Go, Node, SchemaHero, apko, melange, syft, Dagger, vunnel, etc.).

1. **Enter the dev environment:**
   - Run `nix develop`, or
   - Use [direnv](https://direnv.net/) with `use flake` in `.envrc` so the environment loads automatically.

2. **See available targets:**
   ```bash
   make help
   ```

### Go (worker, builder, proxies)

- **Build worker:** `make build-worker` (builds worker with embedded builder binaries).
- **Run services:** `make run-worker`, `make run-oci-proxy`, `make run-apk-proxy` (each builds first if needed).

### TypeScript (securebuild-app, securebuild-www)

- **Install:** `cd securebuild-app && npm install` (and similarly for `securebuild-www`).
- **Dev server:** `npm run dev` (app on port 3000, www on port 3001).

### Database

- **Migrations:** `make migrate` (runs SchemaHero-based migrations).

## Testing

- **Unit tests (all):** `make test-unit` – runs Go unit tests plus securebuild-www and securebuild-app tests.
- **Go unit tests only:** `make test-unit-go`.
- **Integration tests:**  
  - `make test-integration-oci-proxy`  
  - `make test-integration-apk-proxy`  
  - `make test-integration-worker`

CI runs tests on pull requests; run the relevant targets locally before submitting.
