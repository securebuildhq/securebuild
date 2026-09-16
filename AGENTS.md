# SecureBuild development guidance

Follow [CLAUDE.md](CLAUDE.md) for build commands and commit-signing requirements.

## Testing

- Put Go tests that require PostgreSQL, Docker, or SchemaHero under
  `integration/worker/`. CI runs these with `make test-integration-worker`.
  Unit CI runs `go test -v -short ./pkg/... ./cmd/...`; a database test under
  `pkg/` that skips in short mode will never execute in either CI suite.
  Check the Makefile and workflow discovery when adding tests.
- Keep static database seed data in `testdata/seed-data/` SchemaHero fixtures,
  following the existing integration suites. Test actions and state transitions
  belong in the test; large generated datasets can live in SQL fixture files.
- Prefer behavior tests through public entry points: enqueue work, run the
  listener or scheduler, and assert observable results and database state.
  Mock expensive external operations where needed. Avoid tests that only
  recheck Go channel mechanics or mirror implementation details.
- For asynchronous worker tests, wait for the completion update to be persisted
  before canceling the listener or tearing down the database. A handler returning
  does not mean its queue row has been updated yet.
- Run the relevant integration tests without `-short` and check that they ran,
  rather than relying on a successful build or skipped test output.

The CI placement and fixture guidance comes from Dmitriy's
[CI coverage review](https://github.com/securebuildhq/securebuild/pull/181#discussion_r4028403527)
and [fixture review](https://github.com/securebuildhq/securebuild/pull/181#discussion_r4028462040).
See [the worker integration guide](integration/worker/README.md) for setup and examples.
