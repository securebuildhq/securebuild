"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function ExecutionsPage() {
  const router = useRouter()

  useEffect(() => {
    // Redirect to packages page to maintain backward compatibility
    router.replace("/executions/packages")
  }, [router])

  return null
}
