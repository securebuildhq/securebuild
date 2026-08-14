"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Plus, ChevronDown, Package, Trash2, Play, Shield, RefreshCw, Loader2, Search, X } from "lucide-react"
import Link from "next/link"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useSession } from "@/app/hooks/use-session"
import { listImagesAction } from "@/lib/image/actions/list-images"
import { deleteImageAction } from "@/lib/image/actions/delete-image"
import { buildImageAction } from "@/lib/image/actions/build-image"
import { Image } from "@/lib/types/image"
import { scanImageAction } from "@/lib/image/actions/scan-image"
import { scanImagesAction } from "@/lib/image/actions/scan-images-action"

export default function ImagesPage() {
  const { session, isSessionLoading } = useSession()
  const user = session?.user
  const router = useRouter()
  const [images, setImages] = useState<Image[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")

  // Delete confirmation modal state
  const [selectedImageForDelete, setSelectedImageForDelete] = useState<Image | null>(null)
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("")
  const [isDeleting, setIsDeleting] = useState(false)
  const [pendingActions, setPendingActions] = useState<string[]>([])

  // Scan All Images state
  const [isScanningAll, setIsScanningAll] = useState(false)

  const filteredImages = useMemo(() => {
    if (!searchTerm) return images
    return images.filter(image =>
      image.name.toLowerCase().includes(searchTerm.toLowerCase())
    )
  }, [images, searchTerm])

  useEffect(() => {
    if (session) {
      fetchImages()
    }
  }, [session])

  const fetchImages = async () => {
    if (!session) return
    setLoading(true)
    try {
      const imagesData = await listImagesAction()
      setImages(imagesData)
    } catch (error) {
      console.error("Failed to fetch images:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleScanAllClick = async () => {
    if (!session) return
    setIsScanningAll(true)
    try {
      await scanImagesAction()
      // Refresh images after scanning
      await fetchImages()
    } catch (error) {
      console.error("Failed to scan all images:", error)
    } finally {
      setIsScanningAll(false)
    }
  }

  const addPendingAction = (actionKey: string) => {
    setPendingActions(prev => [...prev, actionKey])
  }

  const removePendingAction = (actionKey: string) => {
    setPendingActions(prev => prev.filter(key => key !== actionKey))
  }

  const handleDeleteClick = (image: Image) => {
    setSelectedImageForDelete(image)
    setDeleteConfirmationText("")
  }

  const handleDeleteConfirm = async () => {
    if (!selectedImageForDelete || !session) return
    if (deleteConfirmationText !== selectedImageForDelete.name) return

    setIsDeleting(true)
    try {
      await deleteImageAction(selectedImageForDelete.id)
      setImages(images.filter(img => img.id !== selectedImageForDelete.id))
      setSelectedImageForDelete(null)
      setDeleteConfirmationText("")
    } catch (error) {
      console.error("Failed to delete image:", error)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleBuildClick = async (imageId: string) => {
    if (!session) return
    const actionKey = `build-${imageId}`
    addPendingAction(actionKey)
    try {
      await buildImageAction(imageId)
      console.log(`Build initiated for image: ${imageId}`)
      // Simulate a minimum duration for the visual feedback
      await new Promise((resolve) => setTimeout(resolve, 1000))
    } catch (error) {
      console.error("Failed to build image:", error)
    } finally {
      removePendingAction(actionKey)
    }
  }

  const handleScanClick = async (imageId: string) => {
    if (!session) return
    const actionKey = `scan-${imageId}`
    addPendingAction(actionKey)
    try {
      await scanImageAction(imageId, "both")
      console.log(`Scan initiated for image: ${imageId}`)
      // Simulate a minimum duration for the visual feedback
      await new Promise((resolve) => setTimeout(resolve, 1000))
    } catch (error) {
      console.error("Failed to scan image:", error)
    } finally {
      removePendingAction(actionKey)
    }
  }

  const handleClearSearch = () => {
    setSearchTerm("")
  }

  const formatCompactDate = (dateInput: any) => {
    if (!dateInput) return "—"

    try {
      let date: Date;
      if (dateInput instanceof Date) {
        date = dateInput;
      } else {
        date = new Date(dateInput);
      }

      if (isNaN(date.getTime())) {
        return "Invalid";
      }

      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffMinutes = Math.floor(diffMs / (1000 * 60));

      if (diffMinutes < 60) {
        return `${diffMinutes}m ago`;
      } else if (diffHours < 24) {
        return `${diffHours}h ago`;
      } else if (diffDays < 7) {
        return `${diffDays}d ago`;
      } else {
        return date.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
        });
      }
    } catch (error) {
      return "Invalid";
    }
  }

  return (
    <div className="p-6">
          {loading && images.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
                <div>Loading images...</div>
              </div>
            </div>
          ) : (
            <div>
          <div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0 mb-6">
            <div>
              <h1 className="text-3xl font-bold">Images</h1>
              <p className="text-muted-foreground">Manage container images</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={handleScanAllClick}
                disabled={isScanningAll}
                className="flex items-center"
              >
                {isScanningAll ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Rescan All Images
              </Button>
              <div className="inline-flex items-center">
                <Button asChild className="rounded-r-none">
                  <Link href="/images/new" className="flex items-center">
                    <Plus className="mr-2 h-4 w-4" />
                    New Image
                  </Link>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button className="rounded-l-none -ml-px px-3">
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild>
                      <Link href="/images/new">Create from existing apko.yaml</Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>

          {/* Search bar */}
          <div className="mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search images..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-10"
              />
              {searchTerm && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearSearch}
                  className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 p-0 hover:bg-muted"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Images Table */}
          {filteredImages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Package className="h-16 w-16 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                {searchTerm ? "No images found" : "No images yet"}
              </h3>
              <p className="text-muted-foreground mb-4 max-w-sm">
                {searchTerm
                  ? `No images match "${searchTerm}". Try adjusting your search.`
                  : "Get started by creating your first container image from an apko.yaml configuration."
                }
              </p>
              {!searchTerm && (
                <Button asChild>
                  <Link href="/images/new">
                    <Plus className="mr-2 h-4 w-4" />
                    Create First Image
                  </Link>
                </Button>
              )}
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Registry</TableHead>
                    <TableHead>Tags</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead>Last Scanned</TableHead>
                    <TableHead>Fixable CVEs</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredImages.map((image) => (
                    <TableRow key={image.id}>
                      <TableCell>
                        <Link href={`/images/${image.id}`} className="font-medium text-blue-600 hover:underline">
                          {image.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {image.isPublic && (
                            <Badge variant="secondary" className="text-xs">
                              <Shield className="h-3 w-3 mr-1" />
                              Public
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-muted-foreground">{image.externalRegistries?.[0]?.registryUrl || "—"}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {image.currentTags && image.currentTags.length > 0 ? (
                            <>
                              {image.currentTags.slice(0, 2).map((tagObj, index) => (
                                <Badge key={index} variant="outline" className="text-xs">
                                  {tagObj.tag}
                                </Badge>
                              ))}
                              {image.currentTags.length > 2 && (
                                <Badge variant="outline" className="text-xs">
                                  +{image.currentTags.length - 2}
                                </Badge>
                              )}
                            </>
                          ) : (
                            <span className="text-muted-foreground text-sm">No tags</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {formatCompactDate(image.updatedAt)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {formatCompactDate(image.lastScannedAt)}
                        </span>
                      </TableCell>
                      <TableCell>
                        {image.fixableCVECount && image.fixableCVECount > 0 ? (
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300">
                            {image.fixableCVECount}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleBuildClick(image.id)
                            }}
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-green-600"
                            disabled={pendingActions.includes(`build-${image.id}`)}
                            title="Build"
                          >
                            {pendingActions.includes(`build-${image.id}`) ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Play className="h-3 w-3" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleScanClick(image.id)
                            }}
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-blue-600"
                            disabled={pendingActions.includes(`scan-${image.id}`)}
                            title="Scan"
                          >
                            {pendingActions.includes(`scan-${image.id}`) ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Shield className="h-3 w-3" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDeleteClick(image)
                            }}
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-red-600"
                            title="Delete"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <AlertDialog open={!!selectedImageForDelete} onOpenChange={() => setSelectedImageForDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Image</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the image
              <strong className="font-semibold"> {selectedImageForDelete?.name}</strong> and remove all
              associated data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="my-4">
            <label htmlFor="delete-confirmation" className="text-sm font-medium">
              Please type <strong>{selectedImageForDelete?.name}</strong> to confirm:
            </label>
            <Input
              id="delete-confirmation"
              value={deleteConfirmationText}
              onChange={(e) => setDeleteConfirmationText(e.target.value)}
              placeholder={selectedImageForDelete?.name}
              className="mt-2"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleteConfirmationText !== selectedImageForDelete?.name || isDeleting}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete Image"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
