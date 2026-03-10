"use client"

import type React from "react"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowLeft, CheckCircle2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { submitEnterpriseForm } from "@/lib/enterprise/actions"

export default function EnterpriseFormPage() {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submissionId, setSubmissionId] = useState<string | null>(null)
  const [teamSize, setTeamSize] = useState("")

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    const formData = new FormData(e.currentTarget)

    // Add team size to form data since Select component doesn&apos;t automatically include it
    if (teamSize) {
      formData.set("teamSize", teamSize)
    }

    try {
      const result = await submitEnterpriseForm(formData)

      if (result.success) {
        setSubmissionId(result.submissionId || null)
        setIsSubmitted(true)

        // Redirect to homepage after showing success message
        setTimeout(() => {
          router.push("/")
        }, 3000)
      } else {
        setError(result.error || "An error occurred")
      }
    } catch {
      setError("An unexpected error occurred. Please try again.")
    } finally {
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
              <p className="text-muted-foreground mb-4">
                We&apos;ve received your enterprise inquiry and our team will be in touch shortly to discuss your SecureBuild
                needs. You&apos;ll be redirected to the homepage shortly.
              </p>
              {submissionId && <p className="text-xs text-muted-foreground">Reference ID: {submissionId}</p>}
            </CardContent>
          </Card>
        ) : (
          <Card className="w-full max-w-2xl">
            <CardHeader className="space-y-1">
              <div className="flex justify-between items-center">
                <CardTitle className="text-2xl font-bold">SecureBuild Enterprise Catalog Request</CardTitle>
                <Link href="/" className="text-sm text-muted-foreground hover:text-teal-600 flex items-center gap-1">
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </Link>
              </div>
              <CardDescription>
                Ready for more than just a single image? We can help you secure your entire infrastructure with SecureBuild.
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4">
                {error && (
                  <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md">{error}</div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">
                      Full Name <span className="text-red-500">*</span>
                    </Label>
                    <Input id="name" name="name" placeholder="Pat Meedown" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">
                      Work Email <span className="text-red-500">*</span>
                    </Label>
                    <Input id="email" name="email" type="email" placeholder="pat@somebigbank.com" required />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="companyName">
                      Company Name <span className="text-red-500">*</span>
                    </Label>
                    <Input id="companyName" name="companyName" placeholder="Some Big Bank" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="jobTitle">
                      Job Title <span className="text-red-500">*</span>
                    </Label>
                    <Input id="jobTitle" name="jobTitle" placeholder="Security Engineer" required />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="teamSize">
                    Team Size <span className="text-red-500">*</span>
                  </Label>
                  <Select value={teamSize} onValueChange={setTeamSize} required>
                    <SelectTrigger id="teamSize">
                      <SelectValue placeholder="Select team size" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1-10">1-10 employees</SelectItem>
                      <SelectItem value="11-50">11-50 employees</SelectItem>
                      <SelectItem value="51-200">51-200 employees</SelectItem>
                      <SelectItem value="201-500">201-500 employees</SelectItem>
                      <SelectItem value="501-1000">501-1000 employees</SelectItem>
                      <SelectItem value="1000+">1000+ employees</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="comments">Additional Information</Label>
                  <Textarea
                    id="comments"
                    name="comments"
                    placeholder="Tell us more about your infrastructure, current challenges, or specific secure builds you&apos;re interested in..."
                    rows={4}
                  />
                </div>
              </CardContent>
              <CardFooter className="flex flex-col space-y-4">
                <Button type="submit" className="w-full bg-teal-600 hover:bg-teal-700" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                      Submitting...
                    </>
                  ) : (
                    "Submit Enterprise Inquiry"
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