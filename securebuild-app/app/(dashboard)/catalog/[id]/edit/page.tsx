"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command"
import { Check, ChevronsUpDown, X, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useSession } from "@/app/hooks/use-session"
import { CatalogItem } from "@/lib/types/catalog"
import { Image } from "@/lib/types/image"
import { getCatalogItemAction } from "@/lib/catalog/actions/get-catalog-item"
import { updateCatalogItemAction } from "@/lib/catalog/actions/update-catalog-item"
import { listImagesAction } from "@/lib/image/actions/list-images"

export default function EditCatalogItemPage() {
  const { session, isSessionLoading } = useSession()
  const router = useRouter()
  const params = useParams()
  const id = params?.id as string

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [isActive, setIsActive] = useState(false)
  const [category, setCategory] = useState("")
  const [slug, setSlug] = useState("")
  const [imageUrl, setImageUrl] = useState("")
  const [loading, setLoading] = useState(true)
  const [itemExists, setItemExists] = useState(true)
  const [initialItem, setInitialItem] = useState<CatalogItem | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // New state variables
  const [isPartner, setIsPartner] = useState(false)
  const [isAlternativeBuild, setIsAlternativeBuild] = useState(true) // Default true as per previous req
  const [monthlyPrice, setMonthlyPrice] = useState("")
  const [yearlyPrice, setYearlyPrice] = useState("")
  
  // Image selection states
  const [selectedImages, setSelectedImages] = useState<Image[]>([])
  const [allImages, setAllImages] = useState<Image[]>([])
  const [imagesLoading, setImagesLoading] = useState(true)
  const [imageSearchOpen, setImageSearchOpen] = useState(false)

  useEffect(() => {
    if (isSessionLoading || !session || !id) {
      return
    }

    const fetchData = async () => {
      setLoading(true)
      try {
        // Fetch catalog item and all images in parallel
        const [item, images] = await Promise.all([
          getCatalogItemAction(id),
          listImagesAction()
        ])
        
        if (item) {
          setInitialItem(item)
          setName(item.name)
          setDescription(item.description || "")
          setIsActive(item.isActive ?? false) // Provide default if undefined
          setCategory(item.category || "") // Assuming item.category exists
          setSlug(item.slug || "")           // Assuming item.slug exists
          setImageUrl(item.imageUrl || "")   // Assuming item.imageUrl exists
          setItemExists(true)

          // Initialize new states
          setIsPartner(item.isPartner ?? false)
          setIsAlternativeBuild(item.isAlternativeBuild ?? true)
          setMonthlyPrice(item.pricing?.monthly?.toString() || "")
          setYearlyPrice(item.pricing?.yearly?.toString() || "")
          
          // Set selected images based on the catalog item's current images
          if (item.images && item.images.length > 0) {
            const selectedImgs = images.filter(img => 
              item.images.some((catalogImg: any) => catalogImg.imageId === img.id)
            )
            setSelectedImages(selectedImgs)
          }
        } else {
          setItemExists(false)
        }
        
        setAllImages(images)
      } catch (error) {
        console.error("Failed to fetch catalog item:", error)
        setItemExists(false) // Or handle error state appropriately
      } finally {
        setLoading(false)
        setImagesLoading(false)
      }
    }

    fetchData()
  }, [id, session, isSessionLoading])

  const handleSave = async () => {
    if (!session || !id || !initialItem) {
      // Should not happen if button is enabled, but good to check
      console.error("Missing session, id, or initial item data for save.")
      return
    }
    if (selectedImages.length === 0) {
      alert("At least one image must be selected.")
      return
    }
    setIsSaving(true)
    try {
      await updateCatalogItemAction(
        id,
        name,
        description,
        isActive,
        category,
        slug,
        imageUrl,
        isPartner,
        isAlternativeBuild,
        {
          monthly: parseFloat(monthlyPrice) || 0,
          yearly: parseFloat(yearlyPrice) || 0,
        },
        selectedImages.map(img => img.id) // Pass imageIds
      )
      // Optionally, show a success message (e.g., using a toast notification library)
      console.log("Catalog item updated successfully!")
      router.push("/catalog") // Navigate back to catalog list
    } catch (error) {
      console.error("Failed to update catalog item:", error)
      // Optionally, show an error message to the user
      // alert("Failed to save changes. Please try again.")
    } finally {
      setIsSaving(false)
    }
  }

  if (isSessionLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (!session) {
    // Or redirect to login
    return (
      <div className="flex min-h-screen items-center justify-center">
        Please log in to view this page.
      </div>
    )
  }

  if (!itemExists) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Catalog Item Not Found</h1>
          <p className="text-muted-foreground">The catalog item with ID "{id}" could not be found.</p>
          <Button onClick={() => router.push("/catalog")} className="mt-4">
            Back to Catalog
          </Button>
        </div>
      </div>
    )
  }


  return (
    <div className="p-6">
          <div className="mb-6">
            <h1 className="text-3xl font-bold">Edit Catalog Item</h1>
            <p className="text-muted-foreground">Modify the details of the catalog item.</p>
          </div>

          <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
            <div className="md:col-span-1">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="md:col-span-1">
              <Label htmlFor="category">Category</Label>
              <Input
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1"
              />
            </div>

            <div className="md:col-span-1">
              <Label htmlFor="slug">Slug</Label>
              <Input
                id="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="md:col-span-1">
              <Label htmlFor="imageUrl">Image URL</Label>
              <Input
                id="imageUrl"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                className="mt-1"
              />
              {imageUrl && (
                <div className="mt-2">
                  <Label className="text-sm text-muted-foreground">Preview</Label>
                  <img
                    src={imageUrl}
                    alt="Image Preview"
                    className="mt-1 rounded-md border border-gray-300 object-contain max-h-40 w-full"
                    onError={(e) => {
                      console.warn("Image failed to load:", imageUrl)
                    }}
                  />
                </div>
              )}
            </div>

            <div className="md:col-span-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1"
                rows={5}
              />
            </div>

            <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-4 items-center py-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="isActive"
                  checked={isActive}
                  onCheckedChange={(checked) => setIsActive(Boolean(checked))}
                />
                <Label htmlFor="isActive" className="font-normal">Is Active</Label>
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
              {selectedImages.length === 0 && (
                <p className="text-sm text-muted-foreground mt-1">At least one image must be selected</p>
              )}
            </div>

            <div className="md:col-span-2 flex justify-end space-x-2 mt-4">
              <Button variant="outline" onClick={() => router.back()} disabled={isSaving}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={isSaving || selectedImages.length === 0}>
                {isSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save Changes"
                )}
              </Button>
            </div>
          </div>
    </div>
  )
}
