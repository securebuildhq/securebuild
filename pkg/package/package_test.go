package sbpackage

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/testutil"
	"github.com/stretchr/testify/assert"
)

func Test_compileMelangeYAML(t *testing.T) {
	tests := []struct {
		name            string
		melangeYAML     string
		want            string
		wantErr         bool
		wantErrContains string
	}{
		{
			name: "tailsscale",
			melangeYAML: `package:
  name: tailscale
  version: "1.82.5"
  epoch: 1
  description: The easiest, most secure way to use WireGuard and 2FA.
  copyright:
    - license: BSD-3-Clause
  dependencies:
    runtime:
      - merged-usrsbin
      - securebuild-baselayout

environment:
  contents:
    packages:
      - bash
      - busybox
      - ca-certificates-bundle
      - curl
      - go

pipeline:
  - uses: git-checkout
    with:
      expected-commit: e4d64c6faf827a308ec20b39651225178e6743c0
      repository: https://github.com/tailscale/tailscale
      tag: v${{package.version}}

  - uses: go/bump
    with:
      deps: |-
        golang.org/x/oauth2@v0.27.0
        github.com/gorilla/csrf@v1.7.3
        golang.org/x/net@v0.38.0

  - runs: |
      ./build_dist.sh tailscale.com/cmd/containerboot
      ./build_dist.sh tailscale.com/cmd/${{package.name}}
      ./build_dist.sh tailscale.com/cmd/${{package.name}}d

  - runs: |
      install -Dm755 containerboot "${{targets.destdir}}"/usr/bin/containerboot
      install -Dm755 ${{package.name}} "${{targets.destdir}}"/usr/bin/${{package.name}}
      install -Dm755 ${{package.name}}d "${{targets.destdir}}"/usr/bin/${{package.name}}d

  - uses: strip

subpackages:
  - name: ${{package.name}}-compat
    description: "Compatability package to provide parity with upstream Tailscale binary locations"
    pipeline:
      - runs: |
          mkdir -p "${{targets.subpkgdir}}"/usr/local/bin
          mkdir -p "${{targets.subpkgdir}}"/usr/local/sbin
          ln -sf /usr/bin/containerboot "${{targets.subpkgdir}}"/usr/local/bin/containerboot
          ln -sf /usr/bin/${{package.name}} "${{targets.subpkgdir}}"/usr/local/bin/${{package.name}}
          ln -sf /usr/bin/${{package.name}}d "${{targets.subpkgdir}}"/usr/local/sbin/${{package.name}}d
    dependencies:
      runtime:
        - merged-usrsbin
        - securebuild-baselayout

update:
  enabled: true
  github:
    identifier: tailscale/tailscale
    strip-prefix: v

test:
  environment:
    contents:
      packages:
        - ${{package.name}}-compat
  pipeline:
    - name: Verify Tailscale Version
      runs: |
        # Package tests
        tailscale version
        tailscale --version
        tailscale --help
        tailscaled --version
        tailscaled --help

        # Compat validity tests
        stat /usr/local/bin/containerboot
        stat /usr/local/bin/tailscale
        stat /usr/local/sbin/tailscaled
        /usr/local/bin/tailscale --version
        /usr/local/sbin/tailscaled --version
    - name: Containerboot Test
      runs: |
        containerboot &
        sleep 2
    - name: Tailscale Daemon Test
      runs: |
        tailscaled -tun=userspace-networking -socket=tailscaled.socket &
        sleep 2
        tailscale --socket=tailscaled.socket status | grep -q 'Logged out.'`,
			want:            `{"package":{"name":"tailscale","version":"1.82.5","epoch":1,"description":"The easiest, most secure way to use WireGuard and 2FA.","commit":"unknown","copyright":[{"license":"BSD-3-Clause"}],"dependencies":{"runtime":["merged-usrsbin","securebuild-baselayout"]},"checks":{},"cpe":{},"resources":{}},"environment":{"contents":{"packages":["bash","busybox","ca-certificates-bundle","curl","go","git","git","gobump","binutils","scanelf"]},"entrypoint":{},"accounts":{"users":[{"username":"build","uid":1000,"gid":1000}],"groups":[{"groupname":"build","gid":1000,"members":["build"]}]},"environment":{"CARGO_HOME":"/var/cache/melange/cargo","COMPOSER_CACHE_DIR":"/var/cache/melange/composer","GOMODCACHE":"/var/cache/melange/gomodcache","GOPATH":"/home/build/.cache/go","HOME":"/home/build","PIP_CACHE_DIR":"/var/cache/melange/pip","UV_CACHE_DIR":"/var/cache/melange/uv","npm_config_cache":"/var/cache/melange/npm"}},"capabilities":{},"pipeline":[{"uses":"git-checkout","with":{"expected-commit":"e4d64c6faf827a308ec20b39651225178e6743c0","repository":"https://github.com/tailscale/tailscale","tag":"v1.82.5"},"pipeline":[{"runs":"#!/bin/sh\nset -eu\nmsg() { echo \"[git checkout]\" \"$@\"; }\nfail() {\n\tmsg FAIL \"$@\"\n\texit 1\n}\nvr() {\n\tmsg \"execute:\" \"$@\"\n\t\"$@\"\n}\nretry_with_backoff() {\n\tlocal max_retries=$1\n\tlocal initial_backoff=$2\n\tlocal max_backoff=$3\n\tshift 3\n\tlocal attempt=0\n\tlocal backoff=$initial_backoff\n\n\twhile [ $attempt -le \"$max_retries\" ]; do\n\t\tif [ $attempt -gt 0 ]; then\n\t\t\tmsg \"Retry attempt $attempt/$max_retries after ${backoff}s backoff...\"\n\t\tfi\n\n\t\tif \"$@\"; then\n\t\t\treturn 0\n\t\tfi\n\n\t\tattempt=$((attempt + 1))\n\t\tif [ $attempt -gt \"$max_retries\" ]; then\n\t\t\tmsg \"All $max_retries retry attempts exhausted\"\n\t\t\treturn 1\n\t\tfi\n\n\t\tlocal jitter=0\n\t\tif [ -n \"$RANDOM\" ]; then\n\t\t\tjitter=$((RANDOM % (backoff + 1)))\n\t\telse\n\n\t\t\tjitter=$((($$ * attempt) % (backoff + 1)))\n\t\tfi\n\n\t\tlocal sleep_time=$((backoff + jitter))\n\t\tmsg \"Waiting ${sleep_time}s before retry (backoff: ${backoff}s, jitter: ${jitter}s)...\"\n\t\tsleep $sleep_time\n\n\t\tbackoff=$((backoff * 2))\n\t\tif [ $backoff -gt \"$max_backoff\" ]; then\n\t\t\tbackoff=$max_backoff\n\t\tfi\n\tdone\n\n\treturn 1\n}\nprocess_cherry_picks() {\n\tlocal cpicksf=\"$1\" count=0\n\tlocal fetched_branches=\"\"\n\tlocal sdate=${SOURCE_DATE_EPOCH:-0}\n\tif [ \"$sdate\" -lt 315532800 ]; then\n\t\tmsg \"Setting commit date to Jan 1, 1980 (SOURCE_DATE_EPOCH found ${SOURCE_DATE_EPOCH})\"\n\t\tsdate=315532800\n\tfi\n\tif [ -z \"$cpicksf\" ]; then\n\t\treturn 0\n\tfi\n\tif [ ! -f \"$cpicksf\" ]; then\n\t\tmsg \"cherry picks input '$cpicksf' is not a file\"\n\t\treturn 1\n\tfi\n\n\tlocal line=\"\" branch=\"\" hash=\"\" comment=\"\" unshallow_arg is_shallow\n\twhile IFS= read -r line; do\n\n\t\tline=${line%%#*}\n\t\t[ -z \"$line\" ] \u0026\u0026 continue\n\n\t\tif ! echo \"$line\" | grep -q ':'; then\n\t\t\tmsg \"Invalid format, expected '[branch/]commit: comment'. Found: $line\"\n\t\t\treturn 1\n\t\tfi\n\n\t\tbranch=${line%%:*}\n\t\tcomment=${line#*:}\n\t\tcomment=$(\n\t\t\tset -f\n\t\t\techo \"$comment\"\n\t\t)\n\n\t\tif [ -z \"$comment\" ]; then\n\t\t\tmsg \"Empty comment for cherry-pick: $line\"\n\t\t\treturn 1\n\t\tfi\n\n\t\thash=${branch##*/}\n\n\t\t[ \"$branch\" != \"$hash\" ] \u0026\u0026 branch=${branch%/*} || branch=\"\"\n\n\t\tunshallow_arg=\"\"\n\t\tis_shallow=$(git rev-parse --is-shallow-repository)\n\t\tif [ \"$is_shallow\" == \"true\" ]; then\n\t\t\tunshallow_arg=\"--unshallow\"\n\t\tfi\n\n\t\tif [ -n \"$branch\" ]; then\n\t\t\tcase \" $fetched_branches \" in\n\t\t\t*\" $branch \"*) ;;\n\t\t\t*)\n\t\t\t\tvr git fetch $unshallow_arg origin \"$branch:$branch\" || {\n\t\t\t\t\tmsg \"failed to fetch branch $branch\"\n\t\t\t\t\treturn 1\n\t\t\t\t}\n\t\t\t\tfetched_branches=\"$fetched_branches $branch \"\n\t\t\t\t;;\n\t\t\tesac\n\t\tfi\n\n\t\tvr env \\\n\t\t\tGIT_COMMITTER_DATE=\"@$sdate\" \\\n\t\t\tgit cherry-pick -x \"$hash\" || {\n\t\t\tmsg \"failed to cherry-pick $hash from branch $branch\"\n\t\t\treturn 1\n\t\t}\n\n\t\tmsg \"Cherry-picked $hash from $branch with comment: $comment\"\n\n\t\tcount=$((count + 1))\n\tdone \u003c\"$cpicksf\"\n\n\tif [ $count -gt 0 ]; then\n\t\tmsg \"applied $count cherry-pick(s). head is now $(git rev-parse HEAD)\"\n\tfi\n}\nmain() {\n\tlocal repo=$1 dest=${2:-.} depth=${3:-\"unset\"} branch=$4\n\tlocal tag=$5 expcommit=$6 recurse=${7:-false}\n\tlocal cherry_pick=\"$8\" sparse_paths=\"$9\"\n\tlocal max_retries=\"${10:-3}\" initial_backoff=\"${11:-2}\" max_backoff=\"${12:-60}\"\n\tlocal shallow_submodules=\"${13:-false}\" submodule_jobs=\"${14:-1}\"\n\tmsg \"repo='$repo' dest='$dest' depth='$depth' branch='$branch'\" \\\n\t\t\"tag='$tag' expcommit='$expcommit' recurse='$recurse'\" \\\n\t\t\"sparse_paths='$sparse_paths' max_retries='$max_retries'\" \\\n\t\t\"initial_backoff='$initial_backoff' max_backoff='$max_backoff'\" \\\n\t\t\"shallow_submodules='$shallow_submodules' submodule_jobs='$submodule_jobs'\"\n\n\tcase \"$recurse\" in\n\ttrue | false) : ;;\n\t*) fail \"recurse must be true or false, not '$recurse'\" ;;\n\tesac\n\tcase \"$shallow_submodules\" in\n\ttrue | false) : ;;\n\t*) fail \"shallow_submodules must be true or false, not '$shallow_submodules'\" ;;\n\tesac\n\n\t[ -n \"$repo\" ] || fail \"repository not provided\"\n\n\tif [ -z \"$branch\" ] \u0026\u0026 [ -z \"$tag\" ]; then\n\t\tmsg \"Warning: you have not specified a branch or tag.\"\n\telif [ -n \"$branch\" ] \u0026\u0026 [ -n \"$tag\" ]; then\n\t\tfail \"both branch ($branch) and tag ($tag) are specified.\"\n\tfi\n\n\t[ -n \"$expcommit\" ] ||\n\t\tmsg \"Warning: no expected-commit\"\n\n\tlocal flags=\"\" depthflag=\"\" dest_fullpath=\"\" workdir=\"\"\n\tlocal remote=\"origin\" rcfile=\"\" rc=\"\" quiet=\"--quiet\"\n\tflags=\"--config=advice.detachedHead=false\"\n\t[ -n \"$branch\" ] \u0026\u0026 flags=\"$flags --branch=$branch\"\n\t[ -n \"$tag\" ] \u0026\u0026 flags=\"$flags --branch=$tag\"\n\tif [ \"$recurse\" = \"true\" ]; then\n\t\tflags=\"$flags --recurse-submodules --jobs=$submodule_jobs\"\n\t\t[ \"$shallow_submodules\" = \"true\" ] \u0026\u0026 flags=\"$flags --shallow-submodules\"\n\tfi\n\t[ -n \"$sparse_paths\" ] \u0026\u0026 flags=\"$flags --sparse --filter=blob:none\"\n\n\tif [ \"$depth\" = \"unset\" ]; then\n\t\tdepth=1\n\t\tif [ -n \"$branch\" ] \u0026\u0026 [ -n \"$expcommit\" ]; then\n\n\t\t\tdepth=-1\n\t\tfi\n\tfi\n\n\t[ \"$depth\" = \"-1\" ] || depthflag=\"--depth=$depth\"\n\n\tworkdir=$(mktemp -d)\n\trcfile=$(mktemp)\n\tmkdir -p \"$dest\"\n\tdest_fullpath=$(realpath \"$dest\")\n\n\tvr git config --global --add safe.directory \"$workdir\"\n\tvr git config --global --add safe.directory \"$dest_fullpath\"\n\n\tmsg \"Attempting git clone with retry (max_retries=$max_retries, initial_backoff=${initial_backoff}s, max_backoff=${max_backoff}s)\"\n\n\tretry_with_backoff \"$max_retries\" \"$initial_backoff\" \"$max_backoff\" \\\n\t\tgit clone $quiet \"--origin=$remote\" \\\n\t\t\"--config=user.name=Melange Build\" \\\n\t\t\"--config=user.email=melange-build@cgr.dev\" \\\n\t\t$flags \\\n\t\t${depthflag:+\"$depthflag\"} \"$repo\" \"$workdir\" ||\n\t\tfail \"git clone failed after $max_retries retries\"\n\n\tvr cd \"$workdir\"\n\n\tif [ -n \"$sparse_paths\" ]; then\n\t\tmsg \"Configuring sparse-checkout with paths: $sparse_paths\"\n\t\tvr git sparse-checkout set --cone \"$sparse_paths\" ||\n\t\t\tfail \"failed to configure sparse-checkout --filter=blob:none\"\n\tfi\n\n\tmsg \"tar -c . | tar -C \\\"$dest_fullpath\\\" -x\"\n\t(\n\t\ttar -c .\n\t\techo $? \u003e\"$rcfile\"\n\t) | tar -C \"$dest_fullpath\" -x --no-same-owner\n\n\tread rc \u003c\"$rcfile\" || fail \"failed to read rc file\"\n\t[ \"$rc\" -eq 0 ] || fail \"tar creation in $workdir failed\"\n\n\trm -rf \"$workdir\"\n\tvr cd \"$dest_fullpath\"\n\tvr git config --global --add safe.directory \"$dest_fullpath\"\n\n\tlocal foundcommit=\"\" tagobj=\"\"\n\tif [ -z \"$tag\" ]; then\n\t\tfoundcommit=$(git rev-parse --verify HEAD)\n\t\tif [ -n \"$expcommit\" ] \u0026\u0026 [ \"$expcommit\" != \"$foundcommit\" ]; then\n\t\t\tif [ \"$depth\" = \"-1\" ]; then\n\t\t\t\tmsg \"expected commit $expcommit on ${branch:-HEAD},\" \\\n\t\t\t\t\t\"got $foundcommit, performing reset\"\n\t\t\t\tvr git reset --hard \"$expcommit\"\n\t\t\telse\n\t\t\t\tfail \"expected commit $expcommit on ${branch:-HEAD},\" \\\n\t\t\t\t\t\"got $foundcommit, set depth to -1 to attempt a reset\"\n\t\t\tfi\n\t\tfi\n\t\tmsg \"tip of ${branch:-HEAD} is commit $foundcommit\"\n\t\tprocess_cherry_picks \"$cherry_pick\" || fail \"failed to apply cherry-pick\"\n\t\treturn 0\n\tfi\n\n\tvr git fetch $quiet $remote \"${depthflag:-\"$depthflag\"}\" --no-tags \\\n\t\t\"+refs/tags/$tag:refs/$remote/tags/$tag\"\n\tvr git checkout $quiet \"$remote/tags/$tag\"\n\n\tfoundcommit=$(git rev-parse --verify HEAD)\n\tif [ -z \"$expcommit\" ] || [ \"$expcommit\" = \"$foundcommit\" ]; then\n\t\tmsg \"tag $tag is $foundcommit\"\n\telse\n\n\t\ttagobj=$(git rev-parse --verify --end-of-options \\\n\t\t\t\"refs/$remote/tags/$tag\")\n\t\tif [ \"$expcommit\" != \"$tagobj\" ]; then\n\t\t\t[ \"$tagobj\" != \"$expcommit\" ] \u0026\u0026\n\t\t\t\tmsg \"tag object hash was $tagobj\"\n\t\t\tfail \"Expected commit $expcommit for $tag, found $foundcommit\"\n\t\tfi\n\n\t\tmsg \"Warning: The provided expected-commit ($expcommit)\"\n\t\tmsg \"was the hash of the annotated tag object for $tag.\"\n\t\tmsg \"Update to set expected-commit to $foundcommit\"\n\tfi\n\n\tprocess_cherry_picks \"$cherry_pick\" ||\n\t\tfail \"failed to apply cherry-pick\"\n\n\treturn 0\n}\ncpickf=$(mktemp) || {\n\techo \"failed mktemp\"\n\texit 1\n}\ncat \u003e\"$cpickf\" \u003c\u003c\"END_CHERRY_PICKS\"\n\nEND_CHERRY_PICKS\nmain \\\n\t\"https://github.com/tailscale/tailscale\" \".\" \\\n\t\"unset\" \"\" \\\n\t\"v1.82.5\" \"e4d64c6faf827a308ec20b39651225178e6743c0\" \\\n\t\"false\" \"$cpickf\" \\\n\t\"\" \\\n\t\"3\" \"2\" \\\n\t\"60\" \\\n\t\"false\" \"1\"\nrm -f \"$cpickf\"\n"}]},{"uses":"go/bump","with":{"deps":"golang.org/x/oauth2@v0.27.0\ngithub.com/gorilla/csrf@v1.7.3\ngolang.org/x/net@v0.38.0"},"pipeline":[{"runs":"cd \".\"\ngobump --packages \"golang.org/x/oauth2@v0.27.0\ngithub.com/gorilla/csrf@v1.7.3\ngolang.org/x/net@v0.38.0\" --replaces \"\" --tidy=true --show-diff=false --go-version= --compat= --work=false\n"}]},{"runs":"./build_dist.sh tailscale.com/cmd/containerboot\n./build_dist.sh tailscale.com/cmd/tailscale\n./build_dist.sh tailscale.com/cmd/tailscaled\n"},{"runs":"install -Dm755 containerboot \"/home/build/melange-out/tailscale\"/usr/bin/containerboot\ninstall -Dm755 tailscale \"/home/build/melange-out/tailscale\"/usr/bin/tailscale\ninstall -Dm755 tailscaled \"/home/build/melange-out/tailscale\"/usr/bin/tailscaled\n"},{"uses":"strip","pipeline":[{"runs":"scanelf --recursive --nobanner --osabi --etype \"ET_DYN,ET_EXEC\" . |\n\twhile read type osabi filename; do\n\n\t\t[ \"$osabi\" != \"STANDALONE\" ] || continue\n\n\t\tstrip -g \"${filename}\" || [ ! -e \"$filename\" ]\n\tdone\n","working-directory":"/home/build/melange-out/tailscale"}]}],"subpackages":[{"name":"tailscale-compat","pipeline":[{"runs":"mkdir -p \"/home/build/melange-out/tailscale-compat\"/usr/local/bin\nmkdir -p \"/home/build/melange-out/tailscale-compat\"/usr/local/sbin\nln -sf /usr/bin/containerboot \"/home/build/melange-out/tailscale-compat\"/usr/local/bin/containerboot\nln -sf /usr/bin/tailscale \"/home/build/melange-out/tailscale-compat\"/usr/local/bin/tailscale\nln -sf /usr/bin/tailscaled \"/home/build/melange-out/tailscale-compat\"/usr/local/sbin/tailscaled\n"}],"dependencies":{"runtime":["merged-usrsbin","securebuild-baselayout"]},"description":"Compatability package to provide parity with upstream Tailscale binary locations","commit":"unknown","checks":{}}],"update":{"enabled":true,"github":{"identifier":"tailscale/tailscale","strip-prefix":"v"}},"test":{"environment":{"contents":{"packages":["tailscale","tailscale-compat"]},"entrypoint":{},"accounts":{"users":[{"username":"build","uid":1000,"gid":1000}],"groups":[{"groupname":"build","gid":1000,"members":["build"]}]}},"pipeline":[{"name":"Verify Tailscale Version","runs":"tailscale version\ntailscale --version\ntailscale --help\ntailscaled --version\ntailscaled --help\nstat /usr/local/bin/containerboot\nstat /usr/local/bin/tailscale\nstat /usr/local/sbin/tailscaled\n/usr/local/bin/tailscale --version\n/usr/local/sbin/tailscaled --version\n"},{"name":"Containerboot Test","runs":"containerboot \u0026\nsleep 2\n"},{"name":"Tailscale Daemon Test","runs":"tailscaled -tun=userspace-networking -socket=tailscaled.socket \u0026\nsleep 2\ntailscale --socket=tailscaled.socket status | grep -q 'Logged out.'\n"}]}}`,
			wantErr:         false,
			wantErrContains: "",
		},
		{
			name: "custom pipeline - test/hello",
			melangeYAML: `package:
  name: test-pkg
  version: 1.0.0
  epoch: 0
  description: Test package using custom pipeline

pipeline:
  - uses: test/hello
    with:
      message: "Testing custom pipeline"`,
			want:            `{"package":{"name":"test-pkg","version":"1.0.0","epoch":0,"description":"Test package using custom pipeline","commit":"unknown","dependencies":{},"checks":{},"cpe":{},"resources":{}},"environment":{"contents":{},"entrypoint":{},"accounts":{"users":[{"username":"build","uid":1000,"gid":1000}],"groups":[{"groupname":"build","gid":1000,"members":["build"]}]},"environment":{"CARGO_HOME":"/var/cache/melange/cargo","COMPOSER_CACHE_DIR":"/var/cache/melange/composer","GOMODCACHE":"/var/cache/melange/gomodcache","GOPATH":"/home/build/.cache/go","HOME":"/home/build","PIP_CACHE_DIR":"/var/cache/melange/pip","UV_CACHE_DIR":"/var/cache/melange/uv","npm_config_cache":"/var/cache/melange/npm"}},"capabilities":{},"pipeline":[{"uses":"test/hello","with":{"message":"Testing custom pipeline"},"pipeline":[{"runs":"echo \"Testing custom pipeline\"\necho \"This is a test pipeline for SecureBuild tests\"\n"}]}],"update":{"enabled":false}}`,
			wantErr:         false,
			wantErrContains: "",
		},
		{
			name: "non-existent pipeline - should fail",
			melangeYAML: `package:
  name: test-pkg
  version: 1.0.0
  epoch: 0
  description: Test package using non-existent pipeline

pipeline:
  - uses: nonexistent/pipeline
    with:
      foo: bar`,
			want:            "",
			wantErr:         true,
			wantErrContains: "unable to load pipeline",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Initialize context with test params
			ctx, err := param.Init(param.InitSourceEnvironment, map[string]string{
				"PIPELINE_DIR": testutil.SetupTestPipelineDir(t),
			})
			if err != nil {
				t.Fatalf("Failed to initialize params: %v", err)
			}
			got, err := CompileMelangeYAML(ctx, []byte(tt.melangeYAML))
			if (err != nil) != tt.wantErr {
				t.Errorf("CompileMelangeYAML() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			// Validate error message if we expect an error
			if tt.wantErr && tt.wantErrContains != "" {
				assert.ErrorContains(t, err, tt.wantErrContains)
				return
			}

			// Skip JSON validation if we expect an error
			if tt.wantErr {
				return
			}

			j, err := json.Marshal(got)
			if err != nil {
				t.Errorf("marshal melange yaml: %v", err)
				return
			}
			if !reflect.DeepEqual(string(j), tt.want) {
				t.Errorf("CompileMelangeYAML() = %v, want %v", string(j), tt.want)
			}
		})
	}
}

func Test_bumpReleaseInMelangeYAML(t *testing.T) {
	tests := []struct {
		name        string
		melangeYAML string
		release     int
		want        string
		wantErr     bool
	}{
		{
			name: "update epoch from 20 to 21",
			melangeYAML: `package:
  name: tini
  version: 0.19.0
  epoch: 20
  description: A tiny but valid init for containers`,
			release: 21,
			want: `package:
  name: tini
  version: 0.19.0
  epoch: 21
  description: A tiny but valid init for containers`,
			wantErr: false,
		},
		{
			name: "preserve whitespace with different indentation",
			melangeYAML: `package:
  name: test
    epoch: 5
  version: 1.0.0`,
			release: 10,
			want: `package:
  name: test
    epoch: 10
  version: 1.0.0`,
			wantErr: false,
		},
		{
			name: "no epoch field",
			melangeYAML: `package:
  name: test
  version: 1.0.0`,
			release: 1,
			want:    "",
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := bumpReleaseInMelangeYAML(context.TODO(), tt.melangeYAML, tt.release)
			if (err != nil) != tt.wantErr {
				t.Errorf("bumpReleaseInMelangeYAML() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if got != tt.want {
				t.Errorf("bumpReleaseInMelangeYAML() = %v, want %v", got, tt.want)
			}
		})
	}
}

func Test_changeVersionInMelangeYAML(t *testing.T) {
	tests := []struct {
		name        string
		melangeYAML string
		version     string
		commit      string
		want        string
		wantErr     bool
	}{
		{
			name: "update version and commit",
			melangeYAML: `package:
  name: cloudflared
  version: "2025.6.0"
  epoch: 0
  description: Cloudflare Tunnel client
  copyright:
    - license: Apache-2.0

environment:
  contents:
    packages:
      - busybox
      - ca-certificates-bundle
      - securebuild-baselayout

pipeline:
  - uses: git-checkout
    with:
      repository: https://github.com/cloudflare/cloudflared
      tag: ${{package.version}}
      expected-commit: f8d12c9d398fc7ff73671db160b300230349f47b

  - uses: go/build
    with:
      packages: ./cmd/cloudflared
      output: cloudflared
      ldflags: -extldflags=-static -X "main.Version=${{package.version}}"

update:
  enabled: true
  github:
    identifier: cloudflare/cloudflared

test:
  environment:
    contents:
      packages:
        - bash
        - coreutils
        - curl
        - grep
        - procps
        - netcat-openbsd
  pipeline:
    - name: "Verify binary existence and permissions"
      runs: |
        test -x /usr/bin/cloudflared
    - name: "Check version output"
      runs: |
        cloudflared --version
    - name: "Verify help command"
      runs: |
        cloudflared --help
        cloudflared tunnel --help
    - name: "Test quick tunnel creation"
      uses: test/daemon-check-output
      with:
        start: cloudflared tunnel --url localhost:8080/
        timeout: 30
        expected_output: |
          Thank you for trying Cloudflare Tunnel
          Your quick Tunnel has been created! Visit it at
          https://.*trycloudflare.com
        error_strings: |
          panic:
          FATAL
          failed to create tunnel
          certificate error
          connection refused
`,
			version: "2025.6.1",
			commit:  "64fdc52855eb284c402ff7680a3b23bd0a0b6582",
			want: `package:
  name: cloudflared
  version: "2025.6.1"
  epoch: 0
  description: Cloudflare Tunnel client
  copyright:
    - license: Apache-2.0

environment:
  contents:
    packages:
      - busybox
      - ca-certificates-bundle
      - securebuild-baselayout

pipeline:
  - uses: git-checkout
    with:
      repository: https://github.com/cloudflare/cloudflared
      tag: ${{package.version}}
      expected-commit: 64fdc52855eb284c402ff7680a3b23bd0a0b6582

  - uses: go/build
    with:
      packages: ./cmd/cloudflared
      output: cloudflared
      ldflags: -extldflags=-static -X "main.Version=${{package.version}}"

update:
  enabled: true
  github:
    identifier: cloudflare/cloudflared

test:
  environment:
    contents:
      packages:
        - bash
        - coreutils
        - curl
        - grep
        - procps
        - netcat-openbsd
  pipeline:
    - name: "Verify binary existence and permissions"
      runs: |
        test -x /usr/bin/cloudflared
    - name: "Check version output"
      runs: |
        cloudflared --version
    - name: "Verify help command"
      runs: |
        cloudflared --help
        cloudflared tunnel --help
    - name: "Test quick tunnel creation"
      uses: test/daemon-check-output
      with:
        start: cloudflared tunnel --url localhost:8080/
        timeout: 30
        expected_output: |
          Thank you for trying Cloudflare Tunnel
          Your quick Tunnel has been created! Visit it at
          https://.*trycloudflare.com
        error_strings: |
          panic:
          FATAL
          failed to create tunnel
          certificate error
          connection refused
`,
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := changeVersionInMelangeYAML(context.TODO(), tt.melangeYAML, tt.version, tt.commit)
			if (err != nil) != tt.wantErr {
				t.Errorf("changeVersionInMelangeYAML() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if got != tt.want {
				t.Errorf("changeVersionInMelangeYAML() = %v, want %v", got, tt.want)
			}
		})
	}
}
