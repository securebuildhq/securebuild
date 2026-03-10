"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function PackagesPage() {
  const router = useRouter()
  
  useEffect(() => {
    // Redirect to internal packages tab
    router.replace("/packages/internal")
  }, [router])

  return (
    <div className="p-6 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
        <div>Redirecting...</div>
      </div>
    </div>
  )
}
