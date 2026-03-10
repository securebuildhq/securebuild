import { NextRequest, NextResponse } from "next/server"
import { getPackageVersionsWithFuzzyMatch } from "@/lib/package/apk"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const packageName = searchParams.get('package_name')

    if (!packageName) {
      return NextResponse.json({ error: 'package_name parameter is required' }, { status: 400 })
    }

    // Query the APK database for package versions (with fuzzy matching)
    const versions = await getPackageVersionsWithFuzzyMatch(packageName)

    if (!versions || versions.length === 0) {
      return NextResponse.json({
        package_name: packageName,
        available: false,
        versions: []
      }, { status: 404 })
    }

    return NextResponse.json({
      package_name: packageName,
      available: true,
      versions: versions
    })

  } catch (error) {
    console.error('Error checking package availability:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
