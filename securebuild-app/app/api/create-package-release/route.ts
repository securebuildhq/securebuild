import { NextRequest, NextResponse } from 'next/server'
import { createPackageReleaseAction } from '@/lib/package/actions/create-package-release'
import { getServerSession } from '@/lib/auth/server-session'
import { getSessionWithBearer } from '@/lib/auth/middleware/bearer-auth'
import { ValidationError } from '@/lib/errors/validation-error'
import { extractPackageInfoFromMelange } from '@/lib/package/package'
import { getPackage } from '@/lib/package/package'

/**
 * Create a new revision of an existing package version
 *
 * Example:
 * curl -X POST "https://admin.sbld.io/api/create-package-release" \
 *   -H "Authorization: Bearer $TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d "{\"pkgId\":\"pkg_123\",\"version\":\"1.0.0\",\"melangeYamlBase64\":\"$(base64 -i melange.yaml)\",\"additionalFiles\":{\"filename\":\"additional-files.tar.gz\",\"data\":\"$(base64 -i additional-files.tar.gz)\"}}"
 *
 * Required parameters:
 * - pkgId: Package ID
 * - version: Package version to update
 * - melangeYamlBase64: Base64-encoded melange.yaml content
 *
 * Optional parameters:
 * - additionalFiles: Additional files required for the build (if omitted, uses existing files from DB)
 */
export async function POST(request: NextRequest) {
  try {
    // Get and validate session (supports both bearer token and session cookie)
    const session = await getSessionWithBearer(request, getServerSession)
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized: Valid session or bearer token required' },
        { status: 401 }
      )
    }

    const body = await request.json()

    const { pkgId, version, melangeYamlBase64, additionalFiles } = body

    // Validate required fields
    if (!pkgId) {
      throw new ValidationError('pkgId is required')
    }
    if (!version) {
      throw new ValidationError('version is required')
    }
    if (!melangeYamlBase64) {
      throw new ValidationError('melangeYamlBase64 is required')
    }

    // Decode and validate melange YAML
    let melangeYaml: string
    try {
      melangeYaml = Buffer.from(melangeYamlBase64, 'base64').toString('utf-8')
    } catch (error) {
      throw new ValidationError('Invalid base64 encoding in melangeYamlBase64')
    }

    // Get package to validate name matches
    const pkg = await getPackage(pkgId)
    if (!pkg) {
      throw new ValidationError('Package not found')
    }

    // Extract and validate package info from melange YAML
    try {
      const packageInfo = extractPackageInfoFromMelange(melangeYaml)

      // Validate package name in YAML matches
      if (packageInfo.name !== pkg.name) {
        throw new ValidationError('Package name in melange YAML does not match package')
      }

      // Validate version exists and matches
      if (packageInfo.version !== version) {
        throw new ValidationError('Version in melange YAML does not match specified version')
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error
      }
      throw new ValidationError(`Invalid melange YAML: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }

    // Call the server action with validated session and data
    // Pass copyFilesFromExisting=false to use the API-provided additionalFiles (or none)
    const packageVersion = await createPackageReleaseAction(
      session,
      pkgId,
      version,
      melangeYaml,
      additionalFiles,
      false  // Don't copy from existing - use provided files or none
    )

    return NextResponse.json({
      success: true,
      packageVersion
    })

  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    console.error('Error creating package release:', error)

    return NextResponse.json(
      { error: 'Failed to create package release' },
      { status: 500 }
    )
  }
}