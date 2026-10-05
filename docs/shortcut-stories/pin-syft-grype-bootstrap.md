# Pin and verify Syft and Grype installations

## Proposed Shortcut metadata

- Type: Bug
- Team: SecureBuild
- Project: SecureBuild
- Suggested labels: `vulnerability-scanning`, `supply-chain`, `security`, `builder-pool`

## Summary

Stop executing Anchore's mutable `main/install.sh` scripts when provisioning
builders. Install the Syft and Grype versions selected by SecureBuild from
versioned release archives whose signed checksum manifests have been verified.

## Problem

SecureBuild currently bootstraps scanner tools from mutable upstream installer
URLs in the CMX builder setup, local builder setup, and development worker
image. The downloaded script is executed immediately. A newly provisioned
builder can therefore receive different code without a SecureBuild change or
release.

The resulting binary is not verified against authenticated release metadata.
An upstream branch or delivery compromise could execute arbitrary code on
machines that process registry credentials and security scan data.

Relevant call sites currently include:

- `pkg/builder/pool.go`
- `pkg/builder/pool_install_local.go`
- `Dockerfile.repldev-worker`

## User impact

Scans are not reproducible by SecureBuild version, scanner changes can reach production without review, and compromise of the upstream bootstrap path could affect scan workers and the credentials they use.

## Scope

- Use the pinned Syft and Grype module versions from `go.mod` as the single
  authoritative version source.
- Have the SecureBuild worker download the matching immutable release archive,
  checksum manifest, and Sigstore verification material for the target builder
  architecture.
- Verify the checksum manifest against Anchore's expected GitHub Actions release
  identity, then verify the archive's full SHA-256 from that authenticated
  manifest. Do not maintain hardcoded per-artifact SHA values in application
  source.
- Extract locally and transfer only the verified binary to CMX builders. Reuse
  the same installer for the local builder backend.
- Remove the separate Syft and Grype installation behavior from
  `Dockerfile.repldev-worker` so development uses the same versions and trust
  policy.
- If a binary already exists, skip installation only when its reported version
  exactly matches the required version.
- Fail builder initialization before the machine enters the ready pool if
  download, signature, checksum, extraction, transfer, or version validation
  fails.
- Emit structured logs containing the installed tool and version.

## Acceptance criteria

1. No SecureBuild scanner installation path downloads or executes `anchore/*/main/install.sh`.
2. The installed Syft and Grype versions come from the corresponding pinned
   modules in `go.mod`; production, local, and repldev paths do not define
   independent versions.
3. The worker verifies Anchore's signed checksum manifest before trusting the
   archive checksum, and verifies the archive before extracting or transferring
   its binary.
4. No full per-platform artifact SHA needs to be manually hardcoded or updated
   in SecureBuild source.
5. An invalid signature, unexpected signing identity, checksum mismatch,
   unsupported platform, unsafe archive, transfer failure, or installed-version
   mismatch prevents the builder from entering the ready pool.
6. A matching existing installation is reused; a mismatched installation is
   replaced and revalidated.
7. Bootstrap logs identify the installed tool versions without exposing
   credentials.
8. Automated tests cover valid installation, amd64 and arm64 selection, invalid
   signature, unexpected identity, checksum mismatch, unsafe archive, and wrong
   installed version.

## Technical notes

Relevant implementation areas include:

- `pkg/builder/pool.go`
- `pkg/builder/pool_install_local.go`
- `Dockerfile.repldev-worker`
- builder readiness and telemetry code

Anchore publishes signed checksum metadata for its releases. Pin the expected
release-workflow certificate identity and OIDC issuer as the trust root; obtain
the artifact's full SHA-256 from the verified manifest rather than duplicating
release hashes in the repository.

Download and verification should happen in the worker process. CMX machines
should receive only the already verified binary, reducing their bootstrap
network and execution surface.

## Out of scope

- Changing Grype database ownership or refresh policy.
- Changing vulnerability matching semantics.
- Moving scan execution to Vandoor.
- Building a new CMX base image unless chosen as the smallest implementation.
- Automatically upgrading Syft or Grype independently of a reviewed
  SecureBuild dependency change.
