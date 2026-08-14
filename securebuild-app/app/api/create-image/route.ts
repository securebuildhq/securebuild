import { NextRequest, NextResponse } from 'next/server'
import { createImageAction } from '@/lib/image/actions/create-image'
import { imageExists } from '@/lib/image/image'
import { enqueueWork } from '@/lib/utils/queue'
import { ValidationError } from '@/lib/errors/validation-error'
import { getServerSession } from '@/lib/auth/server-session'

export async function POST(request: NextRequest) {
  try {
    // Get and validate session
    const session = await getServerSession()
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized: Valid session required' },
        { status: 401 }
      )
    }

    const body = await request.json()

    const { name, alternateImage, apkos } = body

    // if an image already exist, respond with conflict
    const exists = await imageExists(name)
    if (exists) {
      throw new ValidationError('Image already exists')
    }

    const image = await createImageAction(
      name,
      alternateImage || "",
      apkos,
    )

    // queue it to build
    await enqueueWork('build_image', {id: image.id})

    return NextResponse.json({
      success: true,
      imageId: image.id,
    })
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    console.error('Error creating image:', error)

    return NextResponse.json(
      { error: 'Failed to create image' },
      { status: 500 }
    )
  }
}
