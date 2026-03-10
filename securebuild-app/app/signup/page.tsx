"use client"

import { Button } from "@/components/ui/button"
import { Github } from "lucide-react"

export default function SignupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="bg-card rounded-xl shadow p-8 w-full max-w-md flex flex-col items-center">
        <h1 className="text-2xl font-bold mb-6">Sign up for SecureBuild</h1>
        <Button className="w-full flex items-center justify-center gap-2" size="lg">
          <Github className="w-5 h-5" />
          Sign up with GitHub
        </Button>
      </div>
    </div>
  )
}