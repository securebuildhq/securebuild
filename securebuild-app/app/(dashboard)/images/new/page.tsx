"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ArrowLeft, Plus, Trash2, X, HelpCircle, GitBranch } from "lucide-react"
import Link from "next/link"
import { useSession } from "@/app/hooks/use-session"
import { createImageAction } from "@/lib/image/actions/create-image"
import { createLinkedImageAction } from "@/lib/image/actions/create-linked-image"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

// Dynamically import Monaco Editor to avoid SSR issues
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="min-h-[400px] border rounded-md flex items-center justify-center bg-muted">
      <p className="text-muted-foreground">Loading editor...</p>
    </div>
  ),
})

interface ApkoConfig {
  tags: string[]
  yaml: string
}

export default function NewImagePage() {
  const { session, isSessionLoading } = useSession()
  const router = useRouter()
  const [imageName, setImageName] = useState("")
  const [alternateImage, setAlternateImage] = useState("")
  const [apkos, setApkos] = useState<ApkoConfig[]>([{ tags: [], yaml: "" }])
  const [currentTags, setCurrentTags] = useState([""])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [tagErrors, setTagErrors] = useState<string[]>([""])
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [imageNameError, setImageNameError] = useState<string | null>(null)

  // Tab state
  const [activeTab, setActiveTab] = useState("manual")

  // Linked repository form state
  const [linkedImageName, setLinkedImageName] = useState("")
  const [linkedGitRemote, setLinkedGitRemote] = useState("")
  const [linkedApkoFilePath, setLinkedApkoFilePath] = useState("")
  const [linkedTestFilePath, setLinkedTestFilePath] = useState("")
  const [linkedImageTagTemplate, setLinkedImageTagTemplate] = useState("")
  const [linkedGitTag, setLinkedGitTag] = useState("")
  const [isSubmittingLinked, setIsSubmittingLinked] = useState(false)
  const [linkedSubmitError, setLinkedSubmitError] = useState<string | null>(null)
  const [linkedImageNameError, setLinkedImageNameError] = useState<string | null>(null)

  // Helper function to validate image names according to Docker/OCI standards
  const validateImageName = (name: string): string | null => {
    if (!name) {
      return "Image name is required"
    }

    if (name.length < 2) {
      return "Image name must be at least 2 characters long"
    }

    if (name.length > 255) {
      return "Image name must be less than 255 characters long"
    }

    // Must start with lowercase alphanumeric character
    if (!/^[a-z0-9]/.test(name)) {
      return "Image name must start with a lowercase letter or number"
    }

    // Must end with lowercase alphanumeric character
    if (!/[a-z0-9]$/.test(name)) {
      return "Image name must end with a lowercase letter or number"
    }

    // Can only contain lowercase letters, digits, dots, dashes, and underscores
    if (!/^[a-z0-9._-]+$/.test(name)) {
      return "Image name can only contain lowercase letters, numbers, dots, dashes, and underscores"
    }

    // Cannot have consecutive dots
    if (/\.{2,}/.test(name)) {
      return "Image name cannot have consecutive dots"
    }

    // Cannot start or end with dots, dashes, or underscores
    if (/^[._-]|[._-]$/.test(name)) {
      return "Image name cannot start or end with dots, dashes, or underscores"
    }

    return null
  }

  // Helper function to check if a tag is valid (not already used)
  const isTagValid = (tagValue: string) => {
    const trimmedTag = tagValue.trim()
    if (!trimmedTag) return false
    
    // Check if tag already exists in any APKO configuration
    return !apkos.some(apko => apko.tags.includes(trimmedTag))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setSubmitError(null) // Clear any previous errors

    try {
      if (!session) {
        throw new Error("No session found")
      }

      // Transform apkos to match server interface - add default names
      const apkosWithNames = apkos.map((apko, index) => ({
        name: `apko-${index + 1}`,
        yaml: apko.yaml,
        tags: apko.tags
      }))

      const image = await createImageAction(imageName, alternateImage, apkosWithNames)
      console.log("Image created:", image)
      router.push("/images")
    } catch (error) {
      console.error("Failed to create image:", error)
      
      // Handle specific error messages from server
      if (error instanceof Error) {
        setSubmitError(error.message)
      } else {
        setSubmitError("Failed to create image. Please try again.")
      }
      
      setIsSubmitting(false)
    }
  }

  const handleLinkedSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmittingLinked(true)
    setLinkedSubmitError(null)

    try {
      if (!session) {
        throw new Error("No session found")
      }

      const nameError = validateImageName(linkedImageName)
      if (nameError) {
        setLinkedImageNameError(nameError)
        setIsSubmittingLinked(false)
        return
      }

      if (!linkedGitRemote.trim()) {
        setLinkedSubmitError("Git remote is required.")
        setIsSubmittingLinked(false)
        return
      }
      if (!linkedApkoFilePath.trim()) {
        setLinkedSubmitError("APKO file path is required.")
        setIsSubmittingLinked(false)
        return
      }
      if (!linkedImageTagTemplate.trim()) {
        setLinkedSubmitError("Image tag template is required.")
        setIsSubmittingLinked(false)
        return
      }
      if (!linkedGitTag.trim()) {
        setLinkedSubmitError("Initial git tag is required.")
        setIsSubmittingLinked(false)
        return
      }

      const image = await createLinkedImageAction({
        name: linkedImageName.trim(),
        gitRemote: linkedGitRemote.trim(),
        apkoFilePath: linkedApkoFilePath.trim(),
        testFilePath: linkedTestFilePath.trim() || undefined,
        imageTagTemplate: linkedImageTagTemplate.trim(),
        gitTag: linkedGitTag.trim(),
      })
      console.log("Linked image created:", image)
      router.push("/images")
    } catch (error) {
      console.error("Failed to create linked image:", error)

      if (error instanceof Error) {
        setLinkedSubmitError(error.message)
      } else {
        setLinkedSubmitError("Failed to create linked image. Please try again.")
      }

      setIsSubmittingLinked(false)
    }
  }

  const addApko = () => {
    setApkos([...apkos, { tags: [], yaml: "" }])
    setCurrentTags([...currentTags, ""])
    setTagErrors([...tagErrors, ""])
  }

  const removeApko = (index: number) => {
    if (apkos.length > 1) {
      setApkos(apkos.filter((_, i) => i !== index))
      setCurrentTags(currentTags.filter((_, i) => i !== index))
      setTagErrors(tagErrors.filter((_, i) => i !== index))
    }
  }

  const updateApko = (index: number, field: 'yaml', value: string) => {
    const updatedApkos = apkos.map((apko, i) =>
      i === index ? { ...apko, [field]: value } : apko
    )
    setApkos(updatedApkos)
  }

  const addTag = (apkoIndex: number) => {
    const tagValue = currentTags[apkoIndex].trim()
    
    // Check if tag already exists in any APKO configuration
    const tagExistsInAnyApko = apkos.some(apko => apko.tags.includes(tagValue))
    
    if (tagValue && !tagExistsInAnyApko) {
      const updatedApkos = apkos.map((apko, i) =>
        i === apkoIndex ? { ...apko, tags: [...apko.tags, tagValue] } : apko
      )
      setApkos(updatedApkos)

      const updatedCurrentTags = currentTags.map((tag, i) =>
        i === apkoIndex ? "" : tag
      )
      setCurrentTags(updatedCurrentTags)

      // Clear any error for this APKO
      const updatedTagErrors = tagErrors.map((error, i) =>
        i === apkoIndex ? "" : error
      )
      setTagErrors(updatedTagErrors)
      
      // Clear submit error when user makes changes
      setSubmitError(null)
    }
  }

  const removeTag = (apkoIndex: number, tagIndex: number) => {
    const updatedApkos = apkos.map((apko, i) =>
      i === apkoIndex ? { ...apko, tags: apko.tags.filter((_, ti) => ti !== tagIndex) } : apko
    )
    setApkos(updatedApkos)

    // After removing a tag, revalidate all current tag inputs
    // since a previously duplicate tag might now be valid
    const updatedTagErrors = tagErrors.map((_, i) => {
      const trimmedValue = currentTags[i].trim()
      if (!trimmedValue) {
        return ""
      }
      
      // Check if tag already exists in any APKO configuration using the updated apkos
      const tagExists = updatedApkos.some(apko => apko.tags.includes(trimmedValue))
      return tagExists ? "This tag is already used" : ""
    })
    setTagErrors(updatedTagErrors)
  }

  const updateCurrentTag = (apkoIndex: number, value: string) => {
    const updatedCurrentTags = currentTags.map((tag, i) =>
      i === apkoIndex ? value : tag
    )
    setCurrentTags(updatedCurrentTags)

    // Validate the tag and set error message
    const updatedTagErrors = tagErrors.map((error, i) => {
      if (i === apkoIndex) {
        const trimmedValue = value.trim()
        if (!trimmedValue) {
          return ""
        }
        
        // Check if tag already exists in any APKO configuration
        const tagExists = apkos.some(apko => apko.tags.includes(trimmedValue))
        return tagExists ? "This tag is already used" : ""
      }
      return error
    })
    setTagErrors(updatedTagErrors)
  }

  if (isSessionLoading || !session) {
    return <div>Loading...</div>
  }

  return (
    <TooltipProvider>
      <div className="p-6">
          <div className="mb-6">
            <div className="flex items-center gap-4 mb-4">
              <Button variant="ghost" size="sm" asChild>
                <Link href="/images" className="flex items-center">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Images
                </Link>
              </Button>
            </div>
            <div>
              <h1 className="text-3xl font-bold">Create New Image</h1>
              <p className="text-muted-foreground">Create a new container image from an apko configuration</p>
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-6">
              <TabsTrigger value="manual">Manual Configuration</TabsTrigger>
              <TabsTrigger value="link-repository">
                <GitBranch className="h-4 w-4 mr-2" />
                Link a repository
              </TabsTrigger>
            </TabsList>

            <TabsContent value="manual">
              <Card>
                <CardHeader>
                  <CardTitle>Image Configuration</CardTitle>
                  <CardDescription>
                    Provide a name for your image and the apko YAML configuration
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="space-y-2">
                      <Label htmlFor="imageName">Image Name</Label>
                      <Input
                        id="imageName"
                        type="text"
                        placeholder="my-awesome-image"
                        value={imageName}
                        onChange={(e) => {
                          const value = e.target.value
                          setImageName(value)
                          setSubmitError(null) // Clear error when user starts typing
                          
                          // Validate image name in real-time
                          const error = validateImageName(value)
                          setImageNameError(error)
                        }}
                        required
                        className={`max-w-md ${imageNameError ? 'border-red-500' : ''}`}
                      />
                      {imageNameError && (
                        <p className="text-sm text-red-500 mt-1">{imageNameError}</p>
                      )}
                      <p className="text-sm text-muted-foreground">
                        Choose a descriptive name for your container image. Must start and end with a lowercase letter or number, and can contain lowercase letters, numbers, dots, dashes, and underscores.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="alternateImage" className="text-base font-semibold">
                          Alternate Image (Recommended)
                        </Label>
                        <Tooltip>
                          <TooltipTrigger>
                            <HelpCircle className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <p>Configuring this enables vulnerability comparison between your SecureBuild image and the upstream image, highlighting which CVEs are fixed.</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <Input
                        id="alternateImage"
                        type="text"
                        placeholder="Enter upstream image (e.g., nginx, redis, sonobuoy/sonobuoy)"
                        value={alternateImage}
                        onChange={(e) => setAlternateImage(e.target.value)}
                        className="max-w-md border-2 border-blue-200 focus:border-blue-400"
                      />
                      <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                        <p className="text-sm text-blue-900 font-medium mb-1">
                          💡 Recommended: Configure upstream image for vulnerability and image testing comparison
                        </p>
                        <p className="text-sm text-blue-800">
                          This enables SecureBuild to show both which CVEs are fixed and how your image performs in comparison to the original upstream image through vulnerability and image testing comparisons. Uses Docker Hub format — examples: nginx, redis, sonobuoy/sonobuoy, or gcr.io/project/image for other registries.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <Label>Apko Configurations</Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={addApko}
                          disabled={isSubmitting}
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          Add Apko
                        </Button>
                      </div>

                      {apkos.map((apko, index) => (
                        <Card key={index} className="relative">
                          <CardHeader>
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-lg">Apko Configuration {index + 1}</CardTitle>
                              {apkos.length > 1 && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeApko(index)}
                                  disabled={isSubmitting}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            <div className="space-y-2">
                              <Label htmlFor={`tags-${index}`}>Tags</Label>
                              <div className="flex gap-2">
                                <Input
                                  id={`tags-${index}`}
                                  type="text"
                                  placeholder="Enter a tag"
                                  value={currentTags[index]}
                                  onChange={(e) => updateCurrentTag(index, e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault()
                                      addTag(index)
                                    }
                                  }}
                                  className={`max-w-md ${tagErrors[index] ? 'border-red-500' : ''}`}
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => addTag(index)}
                                  disabled={!currentTags[index].trim() || !!tagErrors[index]}
                                >
                                  Add
                                </Button>
                              </div>
                              {tagErrors[index] && (
                                <p className="text-sm text-red-500 mt-1">{tagErrors[index]}</p>
                              )}
                              <div className="flex flex-wrap gap-2 mt-2">
                                {apko.tags.map((tag, tagIndex) => (
                                  <Badge key={tagIndex} variant="secondary" className="flex items-center gap-1">
                                    {tag}
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-4 w-4 p-0 hover:bg-transparent"
                                      onClick={() => removeTag(index, tagIndex)}
                                    >
                                      <X className="h-3 w-3" />
                                    </Button>
                                  </Badge>
                                ))}
                              </div>
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor={`yaml-${index}`}>Apko YAML Configuration</Label>
                              <div className="border rounded-md overflow-hidden">
                                <MonacoEditor
                                  height="400px"
                                  defaultLanguage="yaml"
                                  value={apko.yaml}
                                  onChange={(value) => updateApko(index, 'yaml', value || "")}
                                  options={{
                                    minimap: { enabled: false },
                                    scrollBeyondLastLine: false,
                                    fontSize: 14,
                                    lineNumbers: "on",
                                    roundedSelection: false,
                                    scrollbar: {
                                      vertical: "visible",
                                      horizontal: "visible",
                                    },
                                    theme: "vs-dark",
                                    automaticLayout: true,
                                    tabSize: 2,
                                    insertSpaces: true,
                                    wordWrap: "on",
                                  }}
                                  theme="vs-dark"
                                />
                              </div>
                              <p className="text-sm text-muted-foreground">
                                Provide the complete apko YAML configuration for this image variant.
                                This defines the packages, entrypoint, and other image settings.
                              </p>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>

                    {submitError && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                        <p className="text-sm text-red-700">{submitError}</p>
                      </div>
                    )}

                    <div className="flex gap-4 pt-4">
                      <Button type="submit" disabled={isSubmitting || !!imageNameError || !imageName.trim() || !apkos.some(apko => apko.yaml.trim() && apko.tags.length > 0)}>
                        {isSubmitting ? "Creating..." : "Create Image"}
                      </Button>
                      <Button type="button" variant="outline" asChild>
                        <Link href="/images">Cancel</Link>
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="link-repository">
              <Card>
                <CardHeader>
                  <CardTitle>Link a Repository</CardTitle>
                  <CardDescription>
                    Create an image linked to an external git repository containing an APKO configuration file.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleLinkedSubmit} className="space-y-6">
                    <div className="space-y-2">
                      <Label htmlFor="linkedImageName">Image Name</Label>
                      <Input
                        id="linkedImageName"
                        type="text"
                        placeholder="my-awesome-image"
                        value={linkedImageName}
                        onChange={(e) => {
                          const value = e.target.value
                          setLinkedImageName(value)
                          setLinkedSubmitError(null)
                          const error = validateImageName(value)
                          setLinkedImageNameError(error)
                        }}
                        required
                        className={`max-w-md ${linkedImageNameError ? 'border-red-500' : ''}`}
                      />
                      {linkedImageNameError && (
                        <p className="text-sm text-red-500 mt-1">{linkedImageNameError}</p>
                      )}
                      <p className="text-sm text-muted-foreground">
                        Choose a descriptive name for your container image. Must start and end with a lowercase letter or number, and can contain lowercase letters, numbers, dots, dashes, and underscores.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="linkedGitRemote">Git Remote</Label>
                      <Input
                        id="linkedGitRemote"
                        type="text"
                        placeholder="https://github.com/owner/repo.git"
                        value={linkedGitRemote}
                        onChange={(e) => setLinkedGitRemote(e.target.value)}
                        required
                        className="max-w-md"
                      />
                      <p className="text-sm text-muted-foreground">
                        The git remote URL to clone.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="linkedApkoFilePath">Path to APKO File</Label>
                      <Input
                        id="linkedApkoFilePath"
                        type="text"
                        placeholder="e.g., apko.yaml"
                        value={linkedApkoFilePath}
                        onChange={(e) => setLinkedApkoFilePath(e.target.value)}
                        required
                        className="max-w-md"
                      />
                      <p className="text-sm text-muted-foreground">
                        Path to the APKO YAML file relative to the repository root, including filename.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="linkedTestFilePath">Path to Test File (Optional)</Label>
                      <Input
                        id="linkedTestFilePath"
                        type="text"
                        placeholder="e.g., test.yaml"
                        value={linkedTestFilePath}
                        onChange={(e) => setLinkedTestFilePath(e.target.value)}
                        className="max-w-md"
                      />
                      <p className="text-sm text-muted-foreground">
                        Optional path to the test YAML file relative to the repository root.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="linkedImageTagTemplate">Image Tag Template</Label>
                      <Input
                        id="linkedImageTagTemplate"
                        type="text"
                        placeholder="v{major}.{minor}"
                        value={linkedImageTagTemplate}
                        onChange={(e) => setLinkedImageTagTemplate(e.target.value)}
                        required
                        className="max-w-md"
                      />
                      <p className="text-sm text-muted-foreground">
                        Template for image tags using {"{major}"}, {"{minor}"}, and {"{patch}"} variables.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="linkedGitTag">Initial Git Tag</Label>
                      <Input
                        id="linkedGitTag"
                        type="text"
                        placeholder="e.g., v1.0.0"
                        value={linkedGitTag}
                        onChange={(e) => setLinkedGitTag(e.target.value)}
                        required
                        className="max-w-md"
                      />
                      <p className="text-sm text-muted-foreground">
                        The git tag to clone initially. Only tags are supported.
                      </p>
                    </div>

                    {linkedSubmitError && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                        <p className="text-sm text-red-700">{linkedSubmitError}</p>
                      </div>
                    )}

                    <div className="flex gap-4 pt-4">
                      <Button type="submit" disabled={isSubmittingLinked || !!linkedImageNameError || !linkedImageName.trim()}>
                        {isSubmittingLinked ? "Creating..." : "Create Linked Image"}
                      </Button>
                      <Button type="button" variant="outline" asChild>
                        <Link href="/images">Cancel</Link>
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
      </div>
    </TooltipProvider>
  )
}
