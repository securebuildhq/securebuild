# APK Proxy Integration Tests

## Overview

This directory contains integration tests for the APK proxy service. The tests validate the complete workflow of uploading and retrieving Alpine APK packages through the proxy.

## Test Architecture

The test suite (`TestAPKProxyHappyPath`) validates the complete package lifecycle with two subtests:

1. **"Publish package"** - Uploads and publishes an APK package
2. **"Withdraw package"** - Removes the package from the repository

### Publish Package Flow

```mermaid
sequenceDiagram
    participant Test as Test Subtest:<br/>Publish package
    participant UploadAPK as cli.UploadAPK
    participant MinIO as MinIO<br/>(Testcontainer)
    participant HandleAddApk as listener.HandleAddApk
    participant DB as PostgreSQL<br/>(Testcontainer)
    participant Proxy as APK Proxy<br/>(localhost:8080)
    participant Client as HTTP Client

    Note over Test,Client: Subtest 1: Publish Package
    Test->>Test: Create minimal APK package (~1KB)
    Test->>UploadAPK: Upload APK with desired filename
    UploadAPK->>MinIO: PUT x86_64/test-package-1.0.0-r0.apk
    UploadAPK->>MinIO: PUT executions/test-execution-id/pkginfo.json

    Test->>HandleAddApk: Process pkginfo and generate APKINDEX
    HandleAddApk->>MinIO: GET executions/test-execution-id/pkginfo.json
    HandleAddApk->>DB: INSERT INTO apk_catalog
    HandleAddApk->>HandleAddApk: Generate and sign APKINDEX
    HandleAddApk->>MinIO: PUT x86_64/APKINDEX.tar.gz

    Test->>Client: Verify APKINDEX contains package
    Client->>Proxy: GET /x86_64/APKINDEX.tar.gz
    Proxy->>MinIO: Fetch APKINDEX from MinIO
    MinIO-->>Proxy: Return APKINDEX.tar.gz
    Proxy-->>Client: Return APKINDEX (200 OK)
    Client->>Client: Extract and verify "P:test-package" present

    Test->>Client: Verify package accessible
    Client->>Proxy: GET /x86_64/test-package-1.0.0-r0.apk
    Proxy->>MinIO: Fetch APK from MinIO
    MinIO-->>Proxy: Return APK data
    Proxy->>DB: Record APK pull in apk_pull table
    Proxy-->>Client: Return APK package (200 OK)
    Client->>Client: Extract control.tar.gz (.PKGINFO)
    Client->>Client: Extract data.tar.gz (usr/share/test/hello.txt)
    Client->>Client: Verify file content matches
```

### Withdraw Package Flow

```mermaid
sequenceDiagram
    participant Test as Test Subtest:<br/>Withdraw package
    participant RemovePkgVer as sbpackage.RemovePackageVersion
    participant RemovePkg as sbpackage.RemovePackage
    participant DB as PostgreSQL<br/>(Testcontainer)
    participant WithdrawAPK as apk.WithdrawAPK
    participant MinIO as MinIO<br/>(Testcontainer)
    participant Proxy as APK Proxy<br/>(localhost:8080)
    participant Client as HTTP Client

    Note over Test,Client: Subtest 2: Withdraw Package
    Test->>RemovePkgVer: Delete package version
    RemovePkgVer->>DB: DELETE FROM package_version WHERE id = ...

    Test->>RemovePkg: Mark APKs as withdrawn
    RemovePkg->>DB: UPDATE apk_catalog SET is_withdrawn = true
    RemovePkg->>DB: DELETE FROM package WHERE id = ...

    Test->>DB: Verify is_withdrawn flag set
    DB-->>Test: is_withdrawn = true

    Test->>WithdrawAPK: Delete from MinIO and update APKINDEX
    WithdrawAPK->>DB: SELECT FROM apk_catalog WHERE is_withdrawn = true
    WithdrawAPK->>MinIO: GET x86_64/APKINDEX.tar.gz
    WithdrawAPK->>WithdrawAPK: Remove package from APKINDEX
    WithdrawAPK->>WithdrawAPK: Re-sign APKINDEX
    WithdrawAPK->>MinIO: DELETE x86_64/test-package-1.0.0-r0.apk
    WithdrawAPK->>MinIO: PUT x86_64/APKINDEX.tar.gz (updated)
    WithdrawAPK->>DB: DELETE FROM apk_catalog WHERE filename = ...

    Test->>DB: Verify APK deleted from apk_catalog
    DB-->>Test: COUNT(*) = 0

    Test->>Client: Verify APKINDEX no longer contains package
    Client->>Proxy: GET /x86_64/APKINDEX.tar.gz
    Proxy->>MinIO: Fetch APKINDEX from MinIO
    MinIO-->>Proxy: Return updated APKINDEX.tar.gz
    Proxy-->>Client: Return APKINDEX (200 OK)
    Client->>Client: Extract and verify "P:test-package" absent

    Test->>Client: Verify package no longer accessible
    Client->>Proxy: GET /x86_64/test-package-1.0.0-r0.apk
    Proxy->>MinIO: Fetch APK from MinIO
    MinIO-->>Proxy: 404 Not Found
    Proxy-->>Client: 404 Not Found
```

## Test Coverage

### TestAPKProxyHappyPath

**Subtest: "Publish package"**
- ✅ Create minimal APK package (~1KB with test file)
- ✅ Upload APK using production `cli.UploadAPK`
- ✅ Generate pkginfo JSON in executions folder
- ✅ Process pkginfo using `listener.HandleAddApk`
- ✅ Generate and sign APKINDEX
- ✅ Verify APKINDEX contains package entry
- ✅ Retrieve APK package through proxy (200 OK)
- ✅ Extract and validate APK control.tar.gz (.PKGINFO)
- ✅ Extract and validate APK data.tar.gz (usr/share/test/hello.txt)
- ✅ Verify file content matches expected value

**Subtest: "Withdraw package"**
- ✅ Delete package version using `sbpackage.RemovePackageVersion`
- ✅ Mark APKs as withdrawn using `sbpackage.RemovePackage`
- ✅ Verify `is_withdrawn` flag set in database
- ✅ Delete from MinIO using `apk.WithdrawAPK`
- ✅ Update APKINDEX (remove package entry)
- ✅ Verify package deleted from `apk_catalog`
- ✅ Verify APKINDEX no longer contains package entry
- ✅ Verify package returns 404 through proxy

