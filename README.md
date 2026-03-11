# SecureBuild

SecureBuild delivers **zero-CVE container images** built from source. Images are rebuilt in isolated environments with full SBOMs, vulnerability scanning, and cryptographic signing. 

This repository contains the core services and application:

- **Worker** – Orchestrates builds, runs the builder for packages and images, and executes jobs.
- **Builder** – Builds APK packages and container images (Melange, apko, etc.) for linux/amd64 and linux/arm64.
- **OCI proxy** – Serves container images from the SecureBuild registry.
- **APK proxy** – Serves APK packages from the package library.
- **securebuild-app** – Next.js application for the SecureBuild product (teams, images, builds, API keys).

**Development:** A Nix flake provides the dev environment (Go, Node, SchemaHero, apko, melange, syft, Dagger, etc.). Use `nix develop` or [direnv](https://direnv.net/) with `use flake` in `.envrc` to enter it.

Run `make help` for build and development targets.
