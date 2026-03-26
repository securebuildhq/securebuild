import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server-session'
import { getSessionWithBearer } from '@/lib/auth/middleware/bearer-auth'
import { getLatestImageApkoYaml, createApkoVersion } from '@/lib/image/apko'
import { ValidationError } from '@/lib/errors/validation-error'

interface ApkoResponse {
  apkoId: string
  apkoVersionId: string
  apkoYamlBase64: string
}

/**
 * Get APKO YAML for an image by name and tag
 *
 * Example:
 * curl "https://admin.sbld.io/api/image-apko?image_name=myimage&image_tag=latest" \
 *   -H "Authorization: Bearer $TOKEN"
 *
 * Required query parameters:
 * - image_name: Name of the image
 * - image_tag: Tag of the image
 */
export async function GET(request: NextRequest) {
  try {
    // Get and validate session (supports both bearer token and session cookie)
    const session = await getSessionWithBearer(request, getServerSession)
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized: Valid session or bearer token required' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const imageName = searchParams.get('image_name')
    const imageTag = searchParams.get('image_tag')

    // Validate required parameters
    if (!imageName || !imageTag) {
      return NextResponse.json(
        { error: 'Missing required parameters: image_name and image_tag are required' },
        { status: 400 }
      )
    }

    const result = await getLatestImageApkoYaml(imageName, imageTag)
    if (!result) {
      return NextResponse.json(
        { error: 'APKO YAML not found' },
        { status: 404 }
      )
    }

    const response: ApkoResponse = {
      apkoId: result.apkoId,
      apkoVersionId: result.apkoVersionId,
      apkoYamlBase64: Buffer.from(result.apkoYaml).toString('base64')
    }

    return NextResponse.json(response)

  } catch (error) {
    console.error('Error retrieving APKO YAML:', error)

    // Handle validation errors
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    // Handle other errors
    return NextResponse.json(
      { error: 'Failed to retrieve APKO YAML' },
      { status: 500 }
    )
  }
}

/**
 * Create a new APKO version
 *
 * Example:
 * curl -X POST "https://admin.sbld.io/api/image-apko" \
 *   -H "Authorization: Bearer $TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d '{"apkoId":"the-apko-id","apkoYamlBase64":"base64_encoded_apko_yaml"}'
 *
 * Required parameters:
 * - apkoId: ID of the APKO configuration
 * - apkoYamlBase64: Base64-encoded APKO YAML content
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
    const { apkoId, apkoYamlBase64 } = body

    // Validate required fields
    if (!apkoId || !apkoYamlBase64) {
      return NextResponse.json(
        { error: 'Missing required parameters: apkoId and apkoYamlBase64 are required' },
        { status: 400 }
      )
    }

    // Decode base64 YAML
    let apkoYaml: string
    try {
      apkoYaml = Buffer.from(apkoYamlBase64, 'base64').toString('utf-8')
    } catch (error) {
      return NextResponse.json(
        { error: 'Invalid base64 encoding in apkoYamlBase64' },
        { status: 400 }
      )
    }

    await createApkoVersion(apkoId, apkoYaml)

    return NextResponse.json({
      success: true
    })

  } catch (error) {
    console.error('Error creating APKO version:', error)

    // Handle validation errors
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    // Handle other errors
    return NextResponse.json(
      { error: 'Failed to create APKO version' },
      { status: 500 }
    )
  }
}
