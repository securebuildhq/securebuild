"use client"

import React from "react"

import { useState, useEffect } from "react"
import {
  ExternalLink,
  Plus,
  Trash2,
  Shield,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  ChevronDown,
  ChevronRight,
  XCircle,
  Clock,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { useSession } from "@/app/hooks/use-session"
import { createExternalImageAction } from "@/lib/externalimage/actions/create-external-image"
import { listExternalImagesAction } from "@/lib/externalimage/actions/list-external-images"
import { removeExternalImageAction } from "@/lib/externalimage/actions/remove-external-image"
import { useRouter } from "next/navigation"
import { TrackedExternalImage } from "@/lib/types/externalimage"

// Helper to detect if an image URL is for a private AWS ECR registry
// ECR Public (public.ecr.aws) doesn't need credentials for pulls
function isPrivateECRRegistry(imageUrl: string): boolean {
  if (!imageUrl) return false
  // ECR private: <account-id>.dkr.ecr.<region>.amazonaws.com
  return imageUrl.includes('.dkr.ecr.') && imageUrl.includes('.amazonaws.com')
}

export default function ExternalImagesPage() {
  const { session } = useSession()
  const router = useRouter()
  const [images, setImages] = useState<TrackedExternalImage[]>([])
  const [loading, setLoading] = useState(true)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [imageToDelete, setImageToDelete] = useState<TrackedExternalImage | null>(null)
  const [isAddingImage, setIsAddingImage] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [expandedImages, setExpandedImages] = useState<Set<string>>(new Set())
  const [formData, setFormData] = useState({
    url: "",
    username: "",
    password: "",
    useCredentials: false,
  })



  // Toggle row expansion
  const toggleImageExpansion = (image: TrackedExternalImage) => {
    const imageKey = `${image.registry}/${image.imageName}`
    const newExpanded = new Set(expandedImages)
    if (newExpanded.has(imageKey)) {
      newExpanded.delete(imageKey)
    } else {
      newExpanded.add(imageKey)
    }
    setExpandedImages(newExpanded)
  }

  // Handle tag click to navigate to individual tag page
  const handleTagClick = (image: TrackedExternalImage, tag: string) => {
    const imageUrl = `${image.registry}/${image.imageName}`
    router.push(`/dashboard/external-images/${imageUrl}?tag=${tag}`)
  }

  // Load external images when component mounts or session changes
  useEffect(() => {
    if (!session) {
      return
    }

    const loadExternalImages = async () => {
      setLoading(true)
      try {
        const externalImages = await listExternalImagesAction(session)
        setImages(externalImages)
      } catch (error) {
        console.error("Failed to load external images:", error)
      } finally {
        setLoading(false)
      }
    }

    loadExternalImages()
  }, [session])

  const handleAddImage = async () => {
    if (!formData.url.trim() || !session) return

    setIsAddingImage(true)
    setAddError(null)

    try {
      const result = await createExternalImageAction(
        session,
        formData.url.trim(),
        formData.useCredentials ? formData.username || null : null,
        formData.useCredentials ? formData.password || null : null
      )

      // Check if the result is an error
      if (result && typeof result === 'object' && 'error' in result) {
        setAddError(String(result.error))
        return
      }

      // Image was added successfully - refresh the list from database
      const externalImages = await listExternalImagesAction(session)
      setImages(externalImages)

      setFormData({ url: "", username: "", password: "", useCredentials: false })
      setAddDialogOpen(false)
    } catch (error) {
      console.error("Failed to add external image:", error)
      setAddError(error instanceof Error ? error.message : "Failed to add external image")
    } finally {
      setIsAddingImage(false)
    }
  }

  const handleDeleteImage = async () => {
    if (!imageToDelete || !session) return

    try {
      await removeExternalImageAction(session, imageToDelete.registry, imageToDelete.imageName)

      // Remove from local state
      setImages(images.filter(img =>
        img.registry !== imageToDelete.registry ||
        img.imageName !== imageToDelete.imageName
      ))

      setImageToDelete(null)
      setDeleteDialogOpen(false)
    } catch (error) {
      console.error("Failed to delete external image:", error)
      // You might want to show an error message to the user here
    }
  }

  const getStatusIcon = (isComplete: boolean) => {
    if (isComplete) {
      return <CheckCircle2 className="h-4 w-4 text-green-500" />
    } else {
      return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
    }
  }


  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col md:flex-row justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">External Images</h1>
            <p className="text-muted-foreground">
              Track and monitor external container images for security vulnerabilities and compliance
            </p>
          </div>

          <Dialog open={addDialogOpen} onOpenChange={(open) => {
            setAddDialogOpen(open)
            if (!open) {
              setAddError(null)
              setFormData({ url: "", username: "", password: "", useCredentials: false })
            }
          }}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add External Image
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Add External Image</DialogTitle>
                <DialogDescription>
                  Add an external container image to track for security scanning and SBOM generation.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="url">Image URL</Label>
                  <Input
                    id="url"
                    placeholder="docker.io/library/nginx:latest"
                    value={formData.url}
                    onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    id="use-credentials"
                    checked={formData.useCredentials}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, useCredentials: checked })
                    }
                  />
                  <Label htmlFor="use-credentials">Use registry credentials</Label>
                </div>

                {formData.useCredentials && (
                  <>
                    {isPrivateECRRegistry(formData.url) && (
                      <div className="text-sm text-blue-600 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-300 p-3 rounded-md">
                        For AWS ECR registries, use your AWS Access Key ID and Secret Access Key.
                        Tokens will be automatically refreshed.
                      </div>
                    )}
                    <div className="grid gap-2">
                      <Label htmlFor="username">
                        {isPrivateECRRegistry(formData.url) ? 'AWS Access Key ID' : 'Username'}
                      </Label>
                      <Input
                        id="username"
                        value={formData.username}
                        onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="password">
                        {isPrivateECRRegistry(formData.url) ? 'AWS Secret Access Key' : 'Password/Token'}
                      </Label>
                      <Input
                        id="password"
                        type="password"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      />
                    </div>
                  </>
                )}
              </div>
                             {addError && (
                 <div className="text-sm text-red-600 bg-red-50 p-3 rounded-md">
                   {addError}
                 </div>
               )}
               <DialogFooter>
                 <Button variant="outline" onClick={() => setAddDialogOpen(false)} disabled={isAddingImage}>
                   Cancel
                 </Button>
                 <Button
                   onClick={handleAddImage}
                   disabled={!formData.url.trim() || isAddingImage}
                 >
                   {isAddingImage && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                   {isAddingImage ? "Adding..." : "Add Image"}
                 </Button>
               </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">Loading external images...</span>
              </div>
            ) : images.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[70%]">Image</TableHead>
                    <TableHead className="w-[20%]">Tags</TableHead>
                    <TableHead className="w-[10%] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {images.map((image) => {
                    const imageKey = `${image.registry}/${image.imageName}`
                    const isExpanded = expandedImages.has(imageKey)

                    return (
                      <React.Fragment key={imageKey}>
                        {/* Main image row */}
                        <TableRow
                          className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                          onClick={() => toggleImageExpansion(image)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-2">
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                )}
                                <div className="h-10 w-10 rounded-md bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                                  <ExternalLink className="h-5 w-5 text-muted-foreground" />
                                </div>
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="font-medium truncate">{image.imageName}</div>
                                <div className="text-xs text-muted-foreground truncate" title={`${image.registry}/${image.imageName}`}>
                                  {image.registry}/{image.imageName}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm text-muted-foreground">
                              {image.imageTags.length} tag{image.imageTags.length !== 1 ? 's' : ''}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setImageToDelete(image)
                                  setDeleteDialogOpen(true)
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>

                        {/* Expanded tag rows */}
                        {isExpanded && image.imageTags.map((tag) => (
                          <TableRow
                            key={`${imageKey}:${tag}`}
                            className="bg-gray-50 dark:bg-gray-900 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                            onClick={() => handleTagClick(image, tag)}
                          >
                            <TableCell>
                              <div className="flex items-center gap-3 ml-8">
                                <div className="h-6 w-6 rounded bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                                  <span className="text-xs font-medium text-blue-600 dark:text-blue-300">T</span>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="font-medium text-sm">{tag}</div>
                                  <div className="text-xs text-muted-foreground">
                                    Tag for {image.imageName}
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                {(() => {
                                  const tagStatus = image.tagCompletionStatus[tag]
                                  const sbomStatus = tagStatus?.sbomStatus
                                  const scanStatus = tagStatus?.scanStatus

                                  // Show SBOM status if SBOM is not complete
                                  if (sbomStatus !== 'succeeded') {
                                    if (sbomStatus === 'failed') {
                                      return (
                                        <>
                                          <XCircle className="h-4 w-4 text-red-500" />
                                          <Badge variant="destructive" className="text-xs">SBOM Failed</Badge>
                                        </>
                                      )
                                    } else if (sbomStatus === 'generating') {
                                      return (
                                        <>
                                          <Loader2 className="h-4 w-4 text-purple-500 animate-spin" />
                                          <Badge variant="secondary" className="bg-purple-100 text-purple-800 text-xs">Generating SBOM</Badge>
                                        </>
                                      )
                                    } else if (sbomStatus === 'pending') {
                                      return (
                                        <>
                                          <Clock className="h-4 w-4 text-orange-500" />
                                          <Badge variant="secondary" className="bg-orange-100 text-orange-800 text-xs">SBOM Pending</Badge>
                                        </>
                                      )
                                    } else {
                                      // null - no SBOM status exists yet
                                      return (
                                        <>
                                          <Clock className="h-4 w-4 text-gray-400" />
                                          <Badge variant="secondary" className="text-xs">Not Started</Badge>
                                        </>
                                      )
                                    }
                                  }

                                  // SBOM is succeeded, show scan status
                                  if (scanStatus === 'failed') {
                                    return (
                                      <>
                                        <XCircle className="h-4 w-4 text-red-500" />
                                        <Badge variant="destructive" className="text-xs">Scan Failed</Badge>
                                      </>
                                    )
                                  } else if (scanStatus === 'succeeded') {
                                    return (
                                      <>
                                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                                        <Badge variant="default" className="text-xs">Complete</Badge>
                                      </>
                                    )
                                  } else if (scanStatus === 'running') {
                                    return (
                                      <>
                                        <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                                        <Badge variant="secondary" className="text-xs">Scanning</Badge>
                                      </>
                                    )
                                  } else if (scanStatus === 'queued') {
                                    return (
                                      <>
                                        <Loader2 className="h-4 w-4 text-yellow-500 animate-spin" />
                                        <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 text-xs">Scan Queued</Badge>
                                      </>
                                    )
                                  } else {
                                    // null - no scan record exists yet (SBOM just completed)
                                    return (
                                      <>
                                        <Clock className="h-4 w-4 text-gray-400" />
                                        <Badge variant="secondary" className="text-xs">Scan Pending</Badge>
                                      </>
                                    )
                                  }
                                })()}
                              </div>
                            </TableCell>
                            <TableCell>
                              {/* Tag-specific actions can go here */}
                            </TableCell>
                          </TableRow>
                        ))}
                      </React.Fragment>
                    )
                  })}
                </TableBody>
              </Table>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <ExternalLink className="h-16 w-16 text-muted-foreground" />
                <h2 className="mt-6 text-xl font-semibold">No External Images</h2>
                <p className="mt-2 text-muted-foreground">
                  Add external container images to track their security status and generate SBOMs.
                </p>
                <Button className="mt-6" onClick={() => setAddDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Your First External Image
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-linear-to-r from-orange-50 to-red-50 dark:from-orange-900/30 dark:to-red-900/30 border-orange-100 dark:border-orange-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Security Monitoring
            </CardTitle>
            <CardDescription>
              Track external images for security vulnerabilities, generate SBOMs, and maintain compliance
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-100 text-orange-600 dark:bg-orange-900 dark:text-orange-300">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-medium">Vulnerability Scanning</h3>
                  <p className="text-sm text-muted-foreground">
                    Continuous monitoring for security vulnerabilities
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300">
                  <FileText className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-medium">SBOM Generation</h3>
                  <p className="text-sm text-muted-foreground">
                    Software Bill of Materials for compliance tracking
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-300">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-medium">Compliance Reporting</h3>
                  <p className="text-sm text-muted-foreground">
                    Automated compliance reporting and alerting
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Delete Confirmation Dialog */}
        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete External Image</DialogTitle>
              <DialogDescription>
                Are you sure you want to remove &ldquo;{imageToDelete?.imageName}&rdquo; from tracking?
                This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDeleteImage}>
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
