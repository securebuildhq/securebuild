"use client"

import { useState, useEffect, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command"
import { Check, ChevronsUpDown, Loader2, X } from "lucide-react"
import { useSession } from "@/app/hooks/use-session"
import { Image } from "@/lib/types/image"
import { listImagesAction } from "@/lib/image/actions/list-images"
import { createCatalogItemAction } from "@/lib/catalog/actions/create-catalog-item"
import { cn } from "@/lib/utils"

// Placeholder for the actual createCatalogItemAction
// You'll need to create this file and function: securebuild-app/lib/catalog/actions/create-catalog-item.ts
// const createCatalogItemAction = async (session: any, data: { name: string; description: string; isActive: boolean; packageId: string }) => {
//   console.log("Attempting to create catalog item with data:", data)
//   // Simulate API call
//   await new Promise(resolve => setTimeout(resolve, 1000))
//   // In a real scenario, this would interact with your backend and return the created item or throw an error
//   // For now, let's assume success and return a mock response or navigate
//   console.log("Catalog item created (simulated).")
//   return { id: "new-catalog-item-id", ...data }
// }

function NewCatalogItemContent() {
  const { session, isSessionLoading } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [isActive, setIsActive] = useState(true)
  const [category, setCategory] = useState("")
  const [slug, setSlug] = useState("")
  const [imageUrl, setImageUrl] = useState("")
  const [selectedImages, setSelectedImages] = useState<Image[]>([])

  const [isPartner, setIsPartner] = useState(false)
  const [isAlternativeBuild, setIsAlternativeBuild] = useState(true)
  const [monthlyPrice, setMonthlyPrice] = useState("")
  const [yearlyPrice, setYearlyPrice] = useState("")

  const [allImages, setAllImages] = useState<Image[]>([])
  const [imagesLoading, setImagesLoading] = useState(true)
  const [imageSearchOpen, setImageSearchOpen] = useState(false)

  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (session) {
      const fetchImages = async () => {
        setImagesLoading(true)
        try {
          // Fetch all images
          const images = await listImagesAction(session)
          setAllImages(images)
        } catch (err) {
          console.error("Failed to fetch images:", err)
          setError("Failed to load images for selection.")
        } finally {
          setImagesLoading(false)
        }
      }
      fetchImages()
    }
  }, [session])

  // Auto-select image if imageId query parameter is provided
  useEffect(() => {
    const imageId = searchParams.get('imageId')
    if (imageId && allImages.length > 0 && selectedImages.length === 0) {
      const imageToSelect = allImages.find(img => img.id === imageId)
      if (imageToSelect) {
        setSelectedImages([imageToSelect])
      }
    }
  }, [allImages, searchParams, selectedImages.length])

  const handleSave = async () => {
    if (!session || selectedImages.length === 0) {
      setError("At least one image must be selected.")
      return
    }
    if (!category.trim() || !slug.trim() || !imageUrl.trim()) {
      setError("Category, Slug, and Image URL are required.")
      return
    }
    if (!monthlyPrice.trim() || !yearlyPrice.trim()) {
      setError("Monthly and Yearly prices are required.")
      return
    }
    setError(null)
    setIsSaving(true)
    try {
      await createCatalogItemAction(
        session,
        name,
        description,
        isActive,
        category,
        slug,
        imageUrl,
        isPartner,
        isAlternativeBuild,
        { monthly: parseFloat(monthlyPrice) || 0, yearly: parseFloat(yearlyPrice) || 0 },
        selectedImages.map(img => img.id) // Pass imageIds as an array
      )
      router.push("/catalog") // Navigate to catalog page on success
    } catch (err) {
      console.error("Failed to create catalog item:", err)
      let errorMessage = "Failed to save catalog item. Please try again."
      if (err instanceof Error) {
        errorMessage = err.message
      }
      setError(errorMessage)
    } finally {
      setIsSaving(false)
    }
  }

  if (isSessionLoading || (session && imagesLoading && !allImages.length)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="mt-2 text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (!session && !isSessionLoading) {
    // Handle case where session is not available after loading
    router.push("/") // Or your login page
    return (
        <div className="flex min-h-screen flex-col items-center justify-center">
            <p className="mt-2 text-muted-foreground">Redirecting to login...</p>
        </div>
    )
  }

  return (
    <div className="p-6">
          <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
            <p className="text-muted-foreground">Fill in the details to create a new item in the catalog.</p>
          </div>

          <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
            <div className="md:col-span-1">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., My Awesome Product"
                className="mt-1"
              />
            </div>
            <div className="md:col-span-1">
              <Label htmlFor="category">Category</Label>
              <Input
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g., Web Servers"
                className="mt-1"
              />
            </div>

            <div className="md:col-span-1">
              <Label htmlFor="slug">Slug</Label>
              <Input
                id="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="e.g., web-servers"
                className="mt-1"
              />
            </div>
            <div className="md:col-span-1">
              <Label htmlFor="imageUrl">Image URL</Label>
              <Input
                id="imageUrl"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="e.g., https://example.com/image.png"
                className="mt-1"
              />
            </div>

            <div className="md:col-span-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the catalog item..."
                className="mt-1"
                rows={4}
              />
            </div>

            <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-4 items-center py-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="isActive"
                  checked={isActive}
                  onCheckedChange={(checked) => setIsActive(Boolean(checked))}
                />
                <Label htmlFor="isActive" className="font-normal">Active</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="isPartner"
                  checked={isPartner}
                  onCheckedChange={(checked) => setIsPartner(Boolean(checked))}
                />
                <Label htmlFor="isPartner" className="font-normal">Is Partner</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="isAlternativeBuild"
                  checked={isAlternativeBuild}
                  onCheckedChange={(checked) => setIsAlternativeBuild(Boolean(checked))}
                />
                <Label htmlFor="isAlternativeBuild" className="font-normal">Is Alternative Build</Label>
              </div>
            </div>

            <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 py-2">
              <div>
                <Label htmlFor="monthlyPrice">Monthly Price</Label>
                <Input
                  id="monthlyPrice"
                  type="number"
                  value={monthlyPrice}
                  onChange={(e) => setMonthlyPrice(e.target.value)}
                  placeholder="e.g., 10"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="yearlyPrice">Yearly Price</Label>
                <Input
                  id="yearlyPrice"
                  type="number"
                  value={yearlyPrice}
                  onChange={(e) => setYearlyPrice(e.target.value)}
                  placeholder="e.g., 100"
                  className="mt-1"
                />
              </div>
            </div>

            <div className="md:col-span-2">
              <Label>Images</Label>
              
              {/* Display selected images */}
              {selectedImages.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {selectedImages.map((img) => (
                    <div
                      key={img.id}
                      className="flex items-center gap-1 bg-secondary text-secondary-foreground px-2 py-1 rounded-md text-sm"
                    >
                      <span>{img.name}</span>
                      <button
                        type="button"
                        onClick={() => setSelectedImages(selectedImages.filter(i => i.id !== img.id))}
                        className="ml-1 hover:opacity-70"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              
              <Popover open={imageSearchOpen} onOpenChange={setImageSearchOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={imageSearchOpen}
                    className="w-full justify-between mt-1"
                    disabled={imagesLoading}
                  >
                    {imagesLoading ? "Loading images..." : `Select images... (${selectedImages.length} selected)`}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                  <Command>
                    <CommandInput placeholder="Search image..." />
                    <CommandList>
                      <CommandEmpty>{imagesLoading ? "Loading..." : "No image found."}</CommandEmpty>
                      <CommandGroup>
                        {allImages.map((img) => {
                          const isSelected = selectedImages.some(s => s.id === img.id)
                          return (
                            <CommandItem
                              key={img.id}
                              value={img.name} // Value used for search
                              onSelect={() => {
                                if (isSelected) {
                                  setSelectedImages(selectedImages.filter(i => i.id !== img.id))
                                } else {
                                  setSelectedImages([...selectedImages, img])
                                }
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  isSelected ? "opacity-100" : "opacity-0"
                                )}
                              />
                              {img.name}
                            </CommandItem>
                          )
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {selectedImages.length === 0 && error && <p className="text-sm text-red-500 mt-1">{error.includes("image") ? error : ""}</p>}
            </div>

            {error && !error.includes("image") && <p className="md:col-span-2 text-sm text-red-500">{error}</p>}

            <div className="md:col-span-2 flex justify-end space-x-2 pt-4">
              <Button variant="outline" onClick={() => router.push("/catalog")}>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={isSaving || selectedImages.length === 0 || !name.trim() || !description.trim() || !category.trim() || !slug.trim() || !imageUrl.trim() || !monthlyPrice.trim() || !yearlyPrice.trim()}
              >
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save Catalog Item
              </Button>
            </div>
          </div>
    </div>
  )
}

export default function NewCatalogItemPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen flex-col items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="mt-2 text-muted-foreground">Loading...</p>
      </div>
    }>
      <NewCatalogItemContent />
    </Suspense>
  )
}
