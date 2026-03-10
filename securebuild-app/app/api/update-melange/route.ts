import { NextRequest, NextResponse } from 'next/server'
import { updatePackageAction, UpdateActionOpts } from '@/lib/package/actions/update-package'
import { getServerSession } from '@/lib/auth/server-session'
import { getSessionWithBearer } from '@/lib/auth/middleware/bearer-auth'
import { ValidationError } from '@/lib/errors/validation-error'

/**
 * Update melange.yaml for an existing package
 *
 * Example:
 * curl -X POST "https://admin.sbld.io/api/update-melange" \
 *   -H "Authorization: Bearer $TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d "{\"id\":\"pkg_123\",\"version\":\"1.0.0\",\"apkRelease\":1,\"melangeYamlBase64\":\"$(base64 -i melange.yaml)\"}"
 *
 * Required parameters:
 * - id: Package ID
 * - version: Package version
 * - apkRelease: APK release number
 *
 * Optional parameters in opts object:
 * - melangeYamlBase64: Base64-encoded melange.yaml content
 * - useRoot: Run build commands with root privileges (sudo)
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

    const {
      id,
      version,
      apkRelease,
      melangeYamlBase64,
      useRoot,
      bootstrapEnabled,
      bootstrapApkRepository,
      bootstrapKeyringAppend
    } = body

    // Validate required fields
    if (!id || !version || apkRelease === undefined) {
      throw new ValidationError('id, version, and apkRelease are required')
    }

    // Decode base64 melange YAML if provided
    let melangeYaml: string | undefined;
    if (melangeYamlBase64) {
      try {
        melangeYaml = Buffer.from(melangeYamlBase64, 'base64').toString('utf-8')
      } catch (error) {
        throw new ValidationError('Invalid base64 encoding in melangeYamlBase64')
      }
    }

    // Construct UpdateActionOpts from flattened payload
    const opts: UpdateActionOpts = {
      ...(melangeYaml && { melangeYaml }),
      ...(useRoot !== undefined && { useRoot }),
      ...(bootstrapEnabled !== undefined && { bootstrapEnabled }),
      ...(bootstrapApkRepository !== undefined && { bootstrapApkRepository }),
      ...(bootstrapKeyringAppend !== undefined && { bootstrapKeyringAppend })
    }

    // Call the server action with validated session
    const result = await updatePackageAction(
      session,
      id,
      version,
      apkRelease,
      opts
    )

    // Check if the result is an error
    if ('isFailed' in result && result.isFailed) {
      throw new ValidationError(result.message)
    }

    return NextResponse.json({
      success: true,
      packageVersion: result
    })

  } catch (error) {
    console.error('Error updating package:', error)
    
    // Handle validation errors
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    // Handle other errors
    return NextResponse.json(
      { error: 'Failed to update package' },
      { status: 500 }
    )
  }
}