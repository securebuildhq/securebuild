# SecureBuild Roadmap

This document outlines the current direction and planned improvements for SecureBuild. Priorities may shift based on community feedback and contributor capacity.

## Current state

- **Build pipeline:** Worker-orchestrated builds using Melange and apko; APK and OCI image builds for linux/amd64 and linux/arm64; SBOM generation (Syft) and vulnerability scanning (Grype) integrated into the pipeline; package (APK index) signing.
- **Distribution:** OCI proxy and APK proxy for serving images and packages; SecureOS distribution identity and vulnerability feed; SecureOS available as a [Vunnel provider](https://github.com/anchore/vunnel) for Grype/grype-db.
- **Application:** Next.js admin app for visibility into packages, images, and build and scan data.

## Near-term

- **Documentation and onboarding:** Clearer guides for self-hosted or open source adoption, development, and contribution.
- **Build toolchain:** Security hardening and reliability improvements in the Melange/apko build pipeline.
- **Builder types:** Options for different builder backends (e.g. local, cloud, VM) to suit different deployment and scale needs.
- **Admin authentication:** More authentication options in the admin site (e.g. additional IdPs, SSO, or auth methods).
- **Backing image registry:** More options for the backing image registry (e.g. alternative registries or storage backends).

## Longer-term / exploration

- **Additional vulnerability scanners:** Support for Trivy, Snyk, and other scanners alongside Grype for SecureOS-based images.
