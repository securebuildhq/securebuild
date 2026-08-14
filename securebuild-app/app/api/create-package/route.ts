import { NextRequest, NextResponse } from 'next/server'
import { createPackageAction } from '@/lib/package/actions/create-package'
import { getServerSession } from '@/lib/auth/server-session'
import { getSessionWithBearer } from '@/lib/auth/middleware/bearer-auth'
import { ValidationError } from '@/lib/errors/validation-error'

/**
 * Create a new package from base64-encoded melange.yaml
 *
 * Example:
 * curl -X POST "https://admin.sbld.io/api/create-package" \
 *   -H "Authorization: Bearer $TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d "{\"melangeYamlBase64\":\"$(base64 -i melange.yaml)\",\"additionalFiles\":{\"filename\":\"additional-files.tar.gz\",\"data\":\"$(base64 -i additional-files.tar.gz)\"},\"useRoot\":false}"
 *
 * Required parameters:
 * - melangeYamlBase64: Base64-encoded melange.yaml content
 *
 * Optional parameters:
 * - additionalFiles: Additional files required for the build
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

    const { melangeYamlBase64, additionalFiles, useRoot } = body

    // Validate required fields
    if (!melangeYamlBase64) {
      return NextResponse.json(
        { error: 'melangeYamlBase64 is required' },
        { status: 400 }
      )
    }

    // Decode base64 melange YAML for API clients
    let melangeYaml: string;
    try {
      melangeYaml = Buffer.from(melangeYamlBase64, 'base64').toString('utf-8')
    } catch (error) {
      return NextResponse.json(
        { error: 'Invalid base64 encoding in melangeYamlBase64' },
        { status: 400 }
      )
    }

    // Call the server action with validated session
    const packageId = await createPackageAction(
      melangeYaml,
      additionalFiles,
      useRoot
    )

    return NextResponse.json({
      success: true,
      packageId
    })

  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    console.error('Error creating package:', error)

    return NextResponse.json(
      { error: 'Failed to create package' },
      { status: 500 }
    )
  }
}
