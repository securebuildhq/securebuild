# securebuild-api integration tests

The suite uses **real HTTP requests** (no module mocking): Testcontainers
PostgreSQL + a local Docker `registry:3.0.0` (Testcontainers) + a real Next.js
dev server on a random port. A tiny scratch image is pushed to the local
registry at setup; the create path resolves its digest from it — zero external
dependencies. No worker runs; scan/SBOM data is pre-seeded via YAML.

## Run

```bash
npm run test:integration
```

Requires Docker (for Testcontainers) and `schemahero` on PATH (schema + seed
data are applied via SchemaHero from `db/schema/tables`).

## Test flow

- **Create** (`create.test.ts`): `POST /external-image` → 201 + digest, then
  `GET /external-image?sha=<digest>` → status fields (`sbom_status='pending'`).
- **Read** (`scan.test.ts`): against the seeded "existing" image —
  `GET /scan`, `POST /scan`, `POST /scan-summary`, `GET /sbom` (by digest and
  image_url). Validates shape, not values.
- **Auth** (both files): missing/invalid token → 401 on every endpoint.
