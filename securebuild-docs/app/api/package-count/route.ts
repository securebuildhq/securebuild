import { NextResponse } from 'next/server'
import { getPackageCount, getFormattedPackageCount } from '../../../lib/package/package'

interface PackageCountResponse {
  total: number
  x86_64: number
  aarch64: number
  formatted: string
  success: boolean
  error?: string
}

export async function GET(): Promise<NextResponse<PackageCountResponse>> {
  try {
    // Check if database is configured
    if (!process.env.DB_URI && !process.env.SECUREBUILD_PG_URI) {
      return NextResponse.json({
        total: 2000,
        x86_64: 2000,
        aarch64: 2000,
        formatted: 'over 2,000',
        success: true
      })
    }

    const [count, formatted] = await Promise.all([
      getPackageCount(),
      getFormattedPackageCount()
    ])

    return NextResponse.json({
      ...count,
      formatted: formatted.replace(' APK packages', ''),
      success: true
    })

  } catch (error) {
    console.error('Package count API error:', error)

    // Return fallback data on error
    return NextResponse.json({
      total: 2000,
      x86_64: 2000,
      aarch64: 2000,
      formatted: 'over 2,000',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
