# Nix-native local SecureBuild CLI

This spike adds a local build path to the existing `securebuild` CLI. Nix is
the build engine and the package/image definition format. The local path does
not invoke Melange, APKO, `apk`, or an Alpine/Wolfi package repository.

It is deliberately separate from the production worker pipeline. Local builds
do not use the SecureBuild API, database, queues, publishing, or registry
orchestration. The existing remote commands continue to work unchanged.

## Check the environment

```sh
nix run path:.#securebuild -- local doctor
```

The doctor checks that the `nix` executable and its default store are usable.
The CLI deliberately uses the host's Nix executable so it matches the running
daemon and store configuration. The flake inputs that determine build contents
are pinned by this repository's `flake.lock`.

## Build a package locally

Build the default package from the current flake:

```sh
nix run path:.#securebuild -- local package
```

Build a named output:

```sh
nix run path:.#securebuild -- local package .#securebuild
```

The output is a symlink named `result` pointing to an immutable Nix store path.
Use `--out-link` to choose another link or `--out-link ''` to create no link:

```sh
nix run path:.#securebuild -- local package .#securebuild \
  --out-link .securebuild/package
```

For local `.` and `.#name` references, the CLI uses an explicit `path:` flake
reference. This includes untracked working-tree files in a spike build instead
of silently using only files known to Git.

## Run declared tests

```sh
nix run path:.#securebuild -- local check
```

This runs `nix flake check`. The flake exposes the CLI derivation as a check,
and its Nix build runs `go test ./securebuild-cmd/...`.

By default the CLI prevents lock-file changes with
`--no-update-lock-file --no-write-lock-file`. Pass `--update-lock-file` only
when intentionally refreshing inputs. Pure evaluation is also the default;
`--impure` is available as an explicit escape hatch.

## Build an image locally

On Linux:

```sh
nix run path:.#securebuild -- local image
```

The flake's `securebuild-image` output uses
`nixpkgs.dockerTools.buildLayeredImage`. It assembles the image directly from
the SecureBuild CLI's Nix closure and CA certificates. There is no base image,
Dockerfile, APKO configuration, or APK installation step.

The output is a `result-image` symlink to the image archive in `/nix/store`.
Choose a different output link with:

```sh
nix run path:.#securebuild -- local image .#securebuild-image \
  --out-link .securebuild/securebuild-image
```

Container outputs are Linux derivations. A macOS machine therefore needs a
configured Linux Nix builder, and can select the Linux output explicitly:

```sh
nix run path:.#securebuild -- local image \
  .#packages.aarch64-linux.securebuild-image
```

Use `x86_64-linux` instead when targeting that platform.

## Runtime packages

The image currently declares only these top-level runtime contents:

```nix
contents = [ securebuild pkgs.cacert ];
```

Nix includes the complete referenced runtime closure automatically. Compilers
and other build-only dependencies do not enter the image just because they were
needed to compile the CLI. If the application later requires Bash, Git, or
another executable at runtime, that dependency should be added explicitly.

Nix package outputs are store paths rather than `.apk` files. The Nix-native
equivalent of an APK repository is a signed Nix binary cache; container images
can still be published to an OCI registry.

## Remote builds still work

These API-backed commands are unchanged:

```sh
nix run path:.#securebuild -- build package --package-family-name go --tag 1.24.13
nix run path:.#securebuild -- build image --image-name go --tag 1.24.13
```

## Scope of this spike

This is a complete Nix-native implementation of the new local CLI path, but it
does not yet migrate SecureBuild's production data model and workers. The
existing server still understands Melange YAML, APKO YAML, APK repositories,
and their associated build records. A production migration would replace those
with locked flake references, Nix output metadata, binary-cache publishing, and
OCI publication from Nix image outputs.
