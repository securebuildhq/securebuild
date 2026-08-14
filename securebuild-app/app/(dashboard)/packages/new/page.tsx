"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Save, Play, Upload, X } from "lucide-react"
import { CodeEditor } from "@/components/code-editor"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import Link from "next/link"
import { TerminalModal } from "@/components/terminal-modal"
import { useSession } from "@/app/hooks/use-session"
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { createPackageAction } from "@/lib/package/actions/create-package"
import { Input } from "@/components/ui/input"

export default function NewPipelinePage() {
  // All hooks must be called before any return or conditional
  const { session, isSessionLoading } = useSession()
  const user = session?.user
  const router = useRouter()
  const [melangeYaml, setMelangeYaml] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [isTestModalOpen, setIsTestModalOpen] = useState(false)
  const [testId, setTestId] = useState<string | null>(null)
  const [isErrorModalOpen, setIsErrorModalOpen] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [testArch, setTestArch] = useState("x86_64")
  const [isTestOptionsModalOpen, setIsTestOptionsModalOpen] = useState(false)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [useRoot, setUseRoot] = useState<boolean>(false)

  // Only after all hooks:
  if (isSessionLoading || !session || !user) {
    return <div>Loading...</div>
  }

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file && file.name.endsWith('.tar.gz')) {
      setUploadedFile(file)
    } else {
      alert('Please upload a .tar.gz file')
    }
  }

  const handleRemoveFile = () => {
    setUploadedFile(null)
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      let additionalFiles: { filename: string; data: string } | undefined = undefined

      if (uploadedFile) {
        // Convert file to base64
        const reader = new FileReader()
        const fileData = await new Promise<string>((resolve, reject) => {
          reader.onload = (e) => {
            const result = e.target?.result
            if (typeof result === 'string') {
              // Remove the data:application/x-gzip;base64, prefix
              const base64 = result.split(',')[1]
              resolve(base64)
            } else {
              reject(new Error('Failed to read file'))
            }
          }
          reader.onerror = reject
          reader.readAsDataURL(uploadedFile)
        })

        additionalFiles = {
          filename: uploadedFile.name,
          data: fileData
        }
      }

      const p = await createPackageAction(melangeYaml, additionalFiles, useRoot)
      router.push("/packages")
    } catch (error: any) {
      console.error("Error creating package:", error)
      // Extract error message from the error object
      const message = error?.message || "Failed to create package"
      setErrorMessage(message)
      setIsErrorModalOpen(true)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="p-6">
          <div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0 mb-6">
            <div className="flex items-center gap-4">
              <Link href="/packages">
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-3xl font-bold">New Package</h1>
                <p className="text-muted-foreground">Create a new Melange package</p>
              </div>
            </div>
          </div>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Pipeline Configuration</CardTitle>
                <CardDescription>Paste a Melange YAML configuration</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* File Upload Section */}
              <div className="space-y-2">
                <Label>Additional Files</Label>
                <CardDescription className="text-sm">Upload a .tar.gz archive containing additional files for your package</CardDescription>
                {!uploadedFile ? (
                  <div className="flex items-center gap-4">
                    <Input
                      type="file"
                      accept=".tar.gz"
                      onChange={handleFileUpload}
                      className="hidden"
                      id="file-upload"
                    />
                    <Label
                      htmlFor="file-upload"
                      className="flex items-center gap-2 px-4 py-2 border rounded-md cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors"
                    >
                      <Upload className="h-4 w-4" />
                      Upload .tar.gz
                    </Label>
                  </div>
                ) : (
                  <div className="flex items-center justify-between p-3 border rounded-md bg-muted/50">
                    <div className="flex items-center gap-2">
                      <Upload className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{uploadedFile.name}</span>
                      <span className="text-xs text-muted-foreground">
                        ({(uploadedFile.size / 1024 / 1024).toFixed(2)} MB)
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleRemoveFile}
                      className="h-8 w-8 p-0"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>

              {/* Melange YAML Editor */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Melange YAML Configuration</Label>
                </div>
                <CodeEditor
                  value={melangeYaml}
                  onChange={setMelangeYaml}
                  language="yaml"
                  height="500px"
                />
              </div>

              {/* Use Root Toggle */}
              <div className="mt-4 space-y-2">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="use-root"
                    checked={useRoot}
                    onCheckedChange={setUseRoot}
                  />
                  <Label htmlFor="use-root" className="font-semibold">
                    Use Root (sudo) when building
                  </Label>
                </div>
                <p className="text-sm text-muted-foreground">
                  Enable to run build commands with root privileges (sudo).
                </p>
              </div>
            </CardContent>
            <CardFooter className="flex justify-end space-x-2 items-center">
              <Button onClick={handleSave} disabled={isSaving || !melangeYaml.trim()}>
                {isSaving ? (
                  <>Saving...</>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Save Package
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>

          {/* Error Dialog */}
          <Dialog open={isErrorModalOpen} onOpenChange={setIsErrorModalOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Error Creating Package</DialogTitle>
                <DialogDescription>
                  {errorMessage}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button onClick={() => setIsErrorModalOpen(false)}>
                  Close
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
    </div>
  )
}
