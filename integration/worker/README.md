# Worker Integration Tests

Integration tests for the worker's PostgreSQL LISTEN/NOTIFY queue processing. Tests use selective listener registration to verify individual event handlers in isolation without triggering downstream handlers.

## Architecture

```
┌─────────────────────────────────────────────────┐
│ Test                                            │
├─────────────────────────────────────────────────┤
│                                                 │
│  1. StartCreatePackageListener(ctx, l)          │
│     └── Processes create_package events         │
│                                                 │
│  2. l.AddHandler("build_package", testHandler)  │
│     └── Captures events but doesn't process     │
│                                                 │
│  3. EnqueueWork("create_package", payload)      │
│     ├── INSERT INTO work_queue                  │
│     └── pg_notify("create_package", id)         │
│                                                 │
│  4. create_package handler runs                 │
│     ├── Creates package + version               │
│     └── EnqueueWork("build_package", ...)       │
│         └── pg_notify("build_package", id)      │
│                                                 │
│  5. Test listener receives build_package        │
│     └── Channel receives payload                │
│                                                 │
└─────────────────────────────────────────────────┘
```

## Error Handling

The test verifies the happy path where the handler succeeds. If the create_package handler fails, the test would timeout waiting for the build_package event (after 2 seconds) and fail with "Timeout waiting for build_package event". The test does not verify error handling - it expects the handler to succeed and asserts that:
- The build_package event is received
- Package and package_version records are created
- The create_package record is deleted (returns pgx.ErrNoRows)
# External Image Integration Tests

Integration tests for external image SBOM generation and vulnerability scanning workflows. These tests use the **actual handler code** with mocked SBOM/scan operations to verify complete state transitions through the real workflow.

## Architecture

The tests use actual handler code with mocked dependencies:

```
┌─────────────────────────────────────────────────────────────┐
│ Test: Uses Real Handler Code with Mocked Operations         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  1. AddExternalImage() + InitializeScanStatusPendingSbom()  │
│     ├── Simulates monitor detecting new image               │
│     ├── Creates status: pending_sbom             │
│                                                               │
│  2. HandleExternalImageSbom(payload) [REAL HANDLER]         │
│     ├── Calls SetScanStatusGeneratingSbom internally        │
│     ├── Fetches SBOM via mocked fetchSBOMFunc               │
│     ├── Calls InitializeScanStatusQueued      │
│                                                               │
│  3. RunScanForDigest(digest) [REAL HANDLER]                 │
│     ├── Calls SetScanStatusRunning internally               │
│     ├── Executes scan via mocked scanExternalImageFunc      │
│     └── Calls SetExternalImageScanStatus with results       │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

**Key Benefits:**
- Tests exercise the actual code paths that production uses
- State transitions happen through real handler logic
- Only expensive operations (registry fetch, Grype scan) are mocked
- Verifies correct error handling and edge cases

## Status Progression

The tests verify the complete status lifecycle:

### Happy Path
```
pending_sbom → generating_sbom → queued → running → succeeded
```

### Failure Path
```
pending_sbom → generating_sbom → queued → running → failed
```

## Key Features

### 1. **Real Handler Code**
The tests call actual handler functions:
- `HandleExternalImageSbom()` - Real SBOM handler that manages all status transitions
- `RunScanForDigest()` - Real scan handler that executes vulnerability scanning
- All status update logic runs through production code paths

### 2. **Mocked Operations**
Only expensive external operations are mocked:
- **SBOM Fetching**: `fetchSBOMFunc` returns mock `[]sbom.SBOMResult`
- **Vulnerability Scanning**: `scanExternalImageFunc` returns mock scan results
- Both mocks can be configured per-test to simulate different scenarios

### 3. **State Transition Verification**
Tests verify the complete workflow:
- Status transitions happen correctly through handler logic
- Timestamps are set appropriately by handler code
- Architecture-specific statuses are managed correctly
- Cleanup logic removes status rows for non-existent architectures
- Error handling works as expected (failed scans recorded properly)

## Test Cases

### TestExternalImageScanStatusTransitions
Verifies the complete happy path using real handler code:
1. Add external image and initialize `pending_sbom` status
2. Call `HandleExternalImageSbom()` which:
   - Sets status to `generating_sbom`
   - Fetches SBOM (mocked to return x86_64 only)
   - Sets status to `queued` for x86_64
   - Cleans up aarch64 status row
3. Call `RunScanForDigest()` which:
   - Sets status to `running`
   - Executes scan (mocked)
   - Sets status to `succeeded` with results
4. Verify all timestamps and status fields are correct

### TestExternalImageScanFailure
Verifies failure handling using real handler code:
1. Add external image and initialize `pending_sbom` status
2. Call `HandleExternalImageSbom()` to process SBOM
3. Call `RunScanForDigest()` with mocked scan that returns error
4. Verify handler records `failed` status with error message
5. Verify completion timestamp is set even on failure

### TestExternalImageMultiArchWorkflow
Verifies multi-architecture handling:
1. Add external image and initialize `pending_sbom` status
2. Call `HandleExternalImageSbom()` with mock returning both x86_64 and aarch64
3. Verify both architectures transition to `queued`
4. Call `RunScanForDigest()` with mock returning results for both archs
5. Verify both architectures reach `succeeded` status

## Running Tests

```bash
# Run all external image integration tests
make test-integration-externalimage

# Or run directly with go test
go test -v ./integration/externalimage/

# Skip in short mode (these are integration tests)
go test -short ./integration/externalimage/
# Output: "Skipping integration test in short mode"
```

## Test Data

### Seed Data (`testdata/seed-data/`)
- `securebuild-team.yaml` - Test team for external image access

### Mock Data
- Mock SBOM: Minimal JSON structure with empty artifacts
- Mock Scan Results: Sample vulnerability counts

## Differences from Production

1. **SBOM Fetching**: Production fetches from registry, tests use `fetchSBOMFunc` mock
2. **Vulnerability Scanning**: Production runs Grype, tests use `scanExternalImageFunc` mock
3. **Handler Code**: Tests use the **same handlers** as production (`HandleExternalImageSbom`, `RunScanForDigest`)
4. **Speed**: Tests complete in ~15 seconds instead of minutes
5. **No Network**: Tests don't require registry or internet access

## What IS Tested

These tests verify the **real production code paths**:
- ✅ Handler logic and control flow
- ✅ State transition logic (pending_sbom → generating_sbom → queued → running → succeeded/failed)
- ✅ Timestamp management (created_at, updated_at, scan_attempted_at, scan_completed_at)
- ✅ Architecture-specific status tracking
- ✅ Cleanup logic for non-existent architectures
- ✅ Error handling and failure recording
- ✅ Multi-architecture image support
- ✅ Database updates and queries

## What's NOT Tested

Only the external dependencies are mocked:
- ❌ Actual SBOM fetching from registries (tested separately)
- ❌ Actual Grype vulnerability scanning (tested in unit tests)
- ❌ Authentication with external registries
- ❌ Image manifest parsing
- ❌ Network failure scenarios

For end-to-end API testing including actual scan results, see:
- `securebuild-www/integration/api/v1/external-image/scan.test.ts`
