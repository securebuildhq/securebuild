{
  description = "Dev env with Go 1.25+";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable"; # Go 1.25+
  inputs.dagger.url = "github:dagger/nix";
  inputs.dagger.inputs.nixpkgs.follows = "nixpkgs";

  outputs = { self, nixpkgs, dagger }:
    let
      forAllSystems = f: {
        x86_64-darwin = f "x86_64-darwin";
        aarch64-darwin = f "aarch64-darwin";
        x86_64-linux = f "x86_64-linux";
        aarch64-linux = f "aarch64-linux";
      };
      securebuildCliGoMod = builtins.toFile "securebuild-cli.go.mod" ''
        module github.com/securebuildhq/securebuild

        go 1.25.5

        require (
          github.com/spf13/cobra v1.10.2
          github.com/spf13/viper v1.21.0
          github.com/stretchr/testify v1.11.1
        )

        require (
          github.com/davecgh/go-spew v1.1.2-0.20180830191138-d8f796af33cc // indirect
          github.com/fsnotify/fsnotify v1.9.0 // indirect
          github.com/go-viper/mapstructure/v2 v2.5.0 // indirect
          github.com/inconshreveable/mousetrap v1.1.0 // indirect
          github.com/pelletier/go-toml/v2 v2.3.1 // indirect
          github.com/pmezard/go-difflib v1.0.1-0.20181226105442-5d4384ee4fb2 // indirect
          github.com/sagikazarmark/locafero v0.11.0 // indirect
          github.com/sourcegraph/conc v0.3.1-0.20240121214520-5f936abd7ae8 // indirect
          github.com/spf13/afero v1.15.0 // indirect
          github.com/spf13/cast v1.10.0 // indirect
          github.com/spf13/pflag v1.0.10 // indirect
          github.com/subosito/gotenv v1.6.0 // indirect
          go.yaml.in/yaml/v3 v3.0.4 // indirect
          golang.org/x/sys v0.45.0 // indirect
          golang.org/x/text v0.37.0 // indirect
          gopkg.in/yaml.v3 v3.0.1 // indirect
        )
      '';
      mkSecurebuild = pkgs:
        pkgs.buildGoModule {
          pname = "securebuild";
          version = self.shortRev or self.dirtyShortRev or "dev";

          # Keep the derivation focused on the public CLI. The repository also
          # contains services and web applications that are not part of this
          # artifact.
          src = pkgs.lib.cleanSourceWith {
            src = ./.;
            filter = path: type:
              let
                relative = pkgs.lib.removePrefix (toString ./. + "/") (toString path);
              in
                relative == ""
                || relative == "go.mod"
                || relative == "go.sum"
                || relative == "securebuild-cmd"
                || pkgs.lib.hasPrefix "securebuild-cmd/" relative;
          };

          subPackages = [ "securebuild-cmd" ];
          env.CGO_ENABLED = 0;
          ldflags = [ "-s" "-w" ];

          checkPhase = ''
            runHook preCheck
            go test ./securebuild-cmd/...
            runHook postCheck
          '';

          # The service-level module has hundreds of dependencies that are not
          # reachable from this client. Use the CLI-specific module graph and
          # the compiler supplied by the locked nixpkgs revision.
          postPatch = ''
            cp ${securebuildCliGoMod} go.mod
          '';

          vendorHash = "sha256-UIZAc9g1LbKd2qODHciFS5xNyh7Antq+HDjtU7B0mOQ=";

          postInstall = ''
            mv "$out/bin/securebuild-cmd" "$out/bin/securebuild"
          '';

          meta = {
            description = "SecureBuild CLI for local and remote builds";
            mainProgram = "securebuild";
          };
        };
    in {
      packages = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          securebuild = mkSecurebuild pkgs;
        in
          {
            inherit securebuild;
            default = securebuild;
          }
          // pkgs.lib.optionalAttrs pkgs.stdenv.isLinux {
            # This image is assembled directly from Nix store closures. There
            # is intentionally no base image, Dockerfile, Alpine, or apk step.
            securebuild-image = pkgs.dockerTools.buildLayeredImage {
              name = "securebuild-cli";
              tag = "nix";
              contents = [ securebuild pkgs.cacert ];
              config = {
                Entrypoint = [ "/bin/securebuild" ];
                Env = [ "SSL_CERT_FILE=/etc/ssl/certs/ca-bundle.crt" ];
                Labels = {
                  "org.opencontainers.image.title" = "SecureBuild CLI";
                  "org.opencontainers.image.description" = "SecureBuild CLI assembled directly from a Nix closure";
                };
              };
            };
          });

      checks = forAllSystems (system: {
        # buildGoModule's checkPhase runs the securebuild-cmd test suite.
        securebuild-cli = self.packages.${system}.securebuild;
      });

      apps = forAllSystems (system: {
        securebuild = {
          type = "app";
          program = "${self.packages.${system}.securebuild}/bin/securebuild";
        };
        default = self.apps.${system}.securebuild;
      });

      devShells = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          
          # Define SchemaHero package
          schemahero = pkgs.stdenv.mkDerivation rec {
            pname = "schemahero";
            version = "0.23.0-beta.9";

            src = pkgs.fetchurl (
              if pkgs.stdenv.isDarwin then {
                url = "https://github.com/schemahero/schemahero/releases/download/v${version}/schemahero_darwin_${if system == "aarch64-darwin" then "arm64" else "amd64"}.tar.gz";
                sha256 = if system == "aarch64-darwin"
                  then "86c1705517bd10827f0abc345e2a9aee01950949fa343817b5209057be15696e"
                  else "2280dce592b54cd86f3e2b805f4068e1adea2c3382ff1a7decab14138c63ab6d";
              } else {
                url = "https://github.com/schemahero/schemahero/releases/download/v${version}/schemahero_linux_${if system == "aarch64-linux" then "arm64" else "amd64"}.tar.gz";
                sha256 = if system == "aarch64-linux"
                  then "eac470fb0efff2f9c24ba4ca80e313557d6bc13933d35d0e00d7f32c51248a1e"
                  else "b4c092470d7552ae7723b30a42d592629425a2024da921e5466b8b3f2701178d";
              }
            );

            sourceRoot = ".";

            installPhase = ''
              mkdir -p $out/bin
              cp schemahero $out/bin/schemahero
              chmod +x $out/bin/schemahero
            '';
          };

          # Define apko package pinned to v0.27.6 (same version as builder pool)
          apko = pkgs.stdenv.mkDerivation rec {
            pname = "apko";
            version = "0.27.6";

            src = pkgs.fetchurl (
              if pkgs.stdenv.isDarwin then {
                url = "https://github.com/chainguard-dev/apko/releases/download/v${version}/apko_${version}_darwin_${if system == "aarch64-darwin" then "arm64" else "amd64"}.tar.gz";
                sha256 = if system == "aarch64-darwin"
                  then "4d8a2f467e38b51921281b741b76ac0655fca87f6941053ebef3cd357073299a"
                  else "42f67b05744193aaff0dc7e12be116058d9b58efeef433378017b1eed3e7c475";
              } else {
                url = "https://github.com/chainguard-dev/apko/releases/download/v${version}/apko_${version}_linux_${if system == "aarch64-linux" then "arm64" else "amd64"}.tar.gz";
                sha256 = if system == "aarch64-linux"
                  then "57819c462ce3d3fd28c23e7202496b96f6a49a1a3c6ad9023a76106369f86de3"
                  else "51eee131027515f3b8ea082ec0b9805830536dec92f3d9489da75f85a1c0c037";
              }
            );

            dontBuild = true;
            dontConfigure = true;

            sourceRoot = ".";

            installPhase = ''
              mkdir -p $out/bin
              cp apko_${version}_${if pkgs.stdenv.isDarwin then "darwin" else "linux"}_${if pkgs.stdenv.isAarch64 then "arm64" else "amd64"}/apko $out/bin/apko
              chmod +x $out/bin/apko
            '';
          };

          # Define melange package pinned to v0.43.3 (matching go.mod)
          melange = pkgs.stdenv.mkDerivation rec {
            pname = "melange";
            version = "0.43.3";

            src = pkgs.fetchurl (
              if pkgs.stdenv.isDarwin then {
                url = "https://github.com/chainguard-dev/melange/releases/download/v${version}/melange_${version}_darwin_${if system == "aarch64-darwin" then "arm64" else "amd64"}.tar.gz";
                sha256 = if system == "aarch64-darwin"
                  then "99e6bb96b8dc34a851837b738b8a9c125b36affdc02d9131b20394add5d0762b"
                  else "f6c8ca68f28b9131e2b32981e81048e4ab17fbef87a27bbbc9d7633aee908149";
              } else {
                url = "https://github.com/chainguard-dev/melange/releases/download/v${version}/melange_${version}_linux_${if system == "aarch64-linux" then "arm64" else "amd64"}.tar.gz";
                sha256 = if system == "aarch64-linux"
                  then "ca8e52e181d437fb34e24cc54685cd9f12eef868d9aef5f2d337b17842247d38"
                  else "874e6aa7709233b2730884dd01fd4ad20c6269593611b3f7f9c2cc6ddc686a72";
              }
            );

            dontBuild = true;
            dontConfigure = true;

            sourceRoot = ".";

            installPhase = ''
              mkdir -p $out/bin
              cp melange_${version}_${if pkgs.stdenv.isDarwin then "darwin" else "linux"}_${if pkgs.stdenv.isAarch64 then "arm64" else "amd64"}/melange $out/bin/melange
              chmod +x $out/bin/melange
            '';
          };

          # Define syft package pinned to v1.42.1
          syft = pkgs.stdenv.mkDerivation rec {
            pname = "syft";
            version = "1.42.1";

            src = pkgs.fetchurl (
              if pkgs.stdenv.isDarwin then {
                url = "https://github.com/anchore/syft/releases/download/v${version}/syft_${version}_darwin_${if system == "aarch64-darwin" then "arm64" else "amd64"}.tar.gz";
                sha256 = if system == "aarch64-darwin"
                  then "b83cdcbd1b4c55505abd359c25c5903d94b99be47e6f98572bf96927b7b47e45"
                  else "1e52e39d24a4eaec94329e0f3283c448e2ee8f79dc03e5f1e405d324b7ae4e1c";
              } else {
                url = "https://github.com/anchore/syft/releases/download/v${version}/syft_${version}_linux_${if system == "aarch64-linux" then "arm64" else "amd64"}.tar.gz";
                sha256 = if system == "aarch64-linux"
                  then "dfc9ac5fffa8fea95b4f84b427e200dbb2bd9bd0bbf2760d1a9369715b60a91d"
                  else "989ded4e772810f93de6ccdc4512f79a6dabb5fb2dd2a9ffc72a80c955e6125a";
              }
            );

            dontBuild = true;
            dontConfigure = true;

            sourceRoot = ".";

            installPhase = ''
              mkdir -p $out/bin
              cp syft $out/bin/syft
              chmod +x $out/bin/syft
            '';
          };

          # Define Colima package
          colima = pkgs.stdenv.mkDerivation rec {
            pname = "colima";
            version = "0.9.1";

            src = if pkgs.stdenv.isAarch64
              then pkgs.fetchurl {
                url = "https://github.com/abiosoft/colima/releases/download/v${version}/colima-Darwin-arm64";
                sha256 = "sha256-qejCZtPuhfw1TuXeQET+6ZJT4aTpi2Tkyrec2z2tNTk=";
              }
              else pkgs.fetchurl {
                url = "https://github.com/abiosoft/colima/releases/download/v${version}/colima-Darwin-x86_64";
                sha256 = "sha256-2Q79QxcT1NtXogg/v0FUxXxj1+WiKSFwyOqon7Lj7+0=";
              };

            dontUnpack = true;
            dontBuild = true;
            dontConfigure = true;

            installPhase = ''
              mkdir -p $out/bin
              cp $src $out/bin/colima
              chmod +x $out/bin/colima
            '';

            meta = with pkgs.lib; {
              description = "Container runtimes on macOS with minimal setup";
              homepage = "https://github.com/abiosoft/colima";
              license = licenses.mit;
              platforms = platforms.darwin;
            };
          };

        in {
          default = pkgs.mkShell {
            buildInputs = [
              pkgs.go          # Go 1.25+
              pkgs.nodejs_24
              pkgs.docker
              pkgs.git
              pkgs.postgresql  # Provides pg_isready
              pkgs.grype
              apko
              melange
              syft
              dagger.packages.${system}.dagger
              schemahero
            ] ++ pkgs.lib.optionals pkgs.stdenv.isDarwin [
              # macOS-specific packages (not needed on Linux VMs)
              colima
              pkgs.lima
              pkgs.qemu
            ];

            shellHook = ''
              # Ensure go install path is available
              export GOBIN="$HOME/go/bin"

              # Create directories if they don't exist
              mkdir -p "$GOBIN"

              # Prepend to PATH
              export PATH="$GOBIN:$PATH"
              
              # Install grype-db if not already installed
              if ! command -v grype-db &> /dev/null; then
                echo "📦 Installing grype-db..."
                GOBIN=$GOBIN go install github.com/anchore/grype-db/cmd/grype-db@latest
              fi
              
              # Helper function to check and display tool status
              check_tool() {
                local name="$1"
                shift
                if output=$("$@" 2>&1); then
                  echo "✅ $name $output"
                else
                  echo "❌ $name failed"
                  echo "$output" >&2
                fi
              }
              
              # Display tool status
              check_tool "Go" go version
              check_tool "Node" node --version
              check_tool "Docker" docker --version
              check_tool "Git" git --version
              check_tool "PostgreSQL" psql --version
              check_tool "Dagger" dagger version
              check_tool "SchemaHero" schemahero version
              check_tool "Grype" grype version
              check_tool "Apko" apko version
              check_tool "Melange" melange version
              check_tool "Syft" syft version
              if grype_version=$(grype-db version 2>&1 | grep '^Version:' | awk '{print $2}'); then
                echo "✅ Grype-DB $grype_version"
              else
                echo "❌ Grype-DB failed"
              fi
              echo "ℹ️  Vunnel runs in container (ghcr.io/anchore/vunnel)"
            '' + pkgs.lib.optionalString pkgs.stdenv.isDarwin ''
              if colima_version=$(colima version 2>&1 | head -n1); then
                echo "✅ Colima $colima_version"
              else
                echo "❌ Colima failed"
              fi
            '';
          };
        });
    };
}
