"use client"

import type React from "react"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { sendPartnerRequestAction } from "@/lib/partner/actions"
import { Textarea } from "@/components/ui/textarea"
import { ArrowLeft, CheckCircle2 } from "lucide-react"
import { useRouter } from "next/navigation"

export default function PartnerFormPage() {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    projectName: "",
    githubUsername: "",
    companyName: "",
    comments: "",
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      await sendPartnerRequestAction(formData)
      setIsSubmitted(true)

      // Redirect to homepage after showing success message
      setTimeout(() => {
        router.push("/")
      }, 3000)
    } catch (err) {
      console.error(err)
      setError("An error occurred. Please try again.")
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="w-full border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
        <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12 flex h-16 items-center">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/sb-192x192.png" alt="SecureBuild Logo" width={24} height={24} />
            <span className="text-xl font-bold">SecureBuild</span>
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-4 bg-gray-50 dark:bg-gray-900">
        {isSubmitted ? (
          <Card className="w-full max-w-md">
            <CardContent className="pt-6 flex flex-col items-center text-center">
              <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center mb-4">
                <CheckCircle2 className="h-6 w-6 text-green-600" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Thank You!</h2>
              <p className="text-muted-foreground mb-6">
                We&apos;ve received your partnership request and will be in touch soon. You&apos;ll be redirected to the homepage
                shortly.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="w-full max-w-2xl">
            <CardHeader className="space-y-1">
              <div className="flex justify-between items-center">
                <CardTitle className="text-2xl font-bold">Partner With Us</CardTitle>
                <Link href="/" className="text-sm text-muted-foreground hover:text-teal-600 flex items-center gap-1">
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </Link>
              </div>
              <CardDescription>Tell us about your open source project.</CardDescription>
            </CardHeader>
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">
                      Full Name <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="name"
                      name="name"
                      placeholder="Pat Meedown"
                      required
                      value={formData.name}
                      onChange={handleChange}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">
                      Email <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      placeholder="pat@somebigbank.com"
                      required
                      value={formData.email}
                      onChange={handleChange}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="projectName">
                      Project Name <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="projectName"
                      name="projectName"
                      placeholder="Your Open Source Project"
                      required
                      value={formData.projectName}
                      onChange={handleChange}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="githubUsername">
                      GitHub Username <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="githubUsername"
                      name="githubUsername"
                      placeholder="github-username"
                      required
                      value={formData.githubUsername}
                      onChange={handleChange}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="companyName">Company Name</Label>
                  <Input
                    id="companyName"
                    name="companyName"
                    placeholder="Your Company (if applicable)"
                    value={formData.companyName}
                    onChange={handleChange}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="comments">Additional Information</Label>
                  <Textarea
                    id="comments"
                    name="comments"
                    placeholder="Tell us more about your project and what you're looking for..."
                    rows={5}
                    value={formData.comments}
                    onChange={handleChange}
                  />
                </div>
              </CardContent>
              <CardFooter className="flex flex-col space-y-4">
                {error && <p className="text-xs text-red-500 text-center">{error}</p>}
                <Button type="submit" className="w-full bg-teal-600 hover:bg-teal-700" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                      Submitting...
                    </>
                  ) : (
                    "Submit Partnership Request"
                  )}
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  By submitting this form, you agree to our{" "}
                  <Link href="/terms" className="text-teal-600 hover:underline">
                    Terms of Service
                  </Link>{" "}
                  and{" "}
                  <Link href="/privacy" className="text-teal-600 hover:underline">
                    Privacy Policy
                  </Link>
                  .
                </p>
              </CardFooter>
            </form>
          </Card>
        )}
      </main>

      {/* Footer */}
      <footer className="py-6 bg-gray-100 dark:bg-gray-800">
        <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12 text-center">
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} SecureBuild. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  )
}
