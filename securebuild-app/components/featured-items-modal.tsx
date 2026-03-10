"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Check, ChevronsUpDown } from "lucide-react"
import { CatalogItem } from "@/lib/types/catalog"
import { cn } from "@/lib/utils" // Assuming this path is correct

interface FeaturedItemsModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  catalogItems: CatalogItem[]
  onSave: (featuredItemIds: string[]) => void
  currentFeaturedItems?: CatalogItem[]
}

export function FeaturedItemsModal({
  isOpen,
  onOpenChange,
  catalogItems,
  onSave,
  currentFeaturedItems,
}: FeaturedItemsModalProps) {
  const [selectedItem1, setSelectedItem1] = useState<string | undefined>()
  const [selectedItem2, setSelectedItem2] = useState<string | undefined>()
  const [selectedItem3, setSelectedItem3] = useState<string | undefined>()

  const [popoverOpen1, setPopoverOpen1] = useState(false)
  const [popoverOpen2, setPopoverOpen2] = useState(false)
  const [popoverOpen3, setPopoverOpen3] = useState(false)

  useEffect(() => {
    if (isOpen && currentFeaturedItems) {
      setSelectedItem1(currentFeaturedItems[0]?.id)
      setSelectedItem2(currentFeaturedItems[1]?.id)
      setSelectedItem3(currentFeaturedItems[2]?.id)
    } else if (!isOpen) {
      // Reset when modal is closed or if no current items are passed
      setSelectedItem1(undefined)
      setSelectedItem2(undefined)
      setSelectedItem3(undefined)
    }
  }, [isOpen, currentFeaturedItems])

  const handleSave = () => {
    const featuredItemIds = [selectedItem1, selectedItem2, selectedItem3].filter(
      (id) => id !== undefined
    ) as string[]
    onSave(featuredItemIds)
    onOpenChange(false)
  }

  const renderCombobox = (
    value: string | undefined,
    onChange: (value: string | undefined) => void,
    popoverOpen: boolean,
    setPopoverOpen: (open: boolean) => void,
    labelId: string
  ) => {
    const selectedCatalogItem = catalogItems.find((item) => item.id === value)
    return (
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={popoverOpen}
            className="w-full justify-between col-span-3" // Adjusted for grid
            id={labelId}
          >
            {selectedCatalogItem
              ? selectedCatalogItem.name
              : "Select an item..."}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--trigger-width] p-0">
          <Command>
            <CommandInput placeholder="Search item..." />
            <CommandList>
              <CommandEmpty>No item found.</CommandEmpty>
              <CommandGroup>
                {catalogItems.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={item.name} // Search by name
                    onSelect={(currentValue) => {
                      // Find item by name (currentValue) to get its ID
                      const itemToSelect = catalogItems.find(
                        (ci) => ci.name.toLowerCase() === currentValue.toLowerCase()
                      );
                      onChange(itemToSelect ? itemToSelect.id : undefined)
                      setPopoverOpen(false)
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === item.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {item.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Manage Featured Items</DialogTitle>
          <DialogDescription>
            Select up to three catalog items to feature.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <label htmlFor="item1-combobox" className="text-right">
              Item 1
            </label>
            {renderCombobox(
              selectedItem1,
              setSelectedItem1,
              popoverOpen1,
              setPopoverOpen1,
              "item1-combobox"
            )}
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <label htmlFor="item2-combobox" className="text-right">
              Item 2
            </label>
            {renderCombobox(
              selectedItem2,
              setSelectedItem2,
              popoverOpen2,
              setPopoverOpen2,
              "item2-combobox"
            )}
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <label htmlFor="item3-combobox" className="text-right">
              Item 3
            </label>
            {renderCombobox(
              selectedItem3,
              setSelectedItem3,
              popoverOpen3,
              setPopoverOpen3,
              "item3-combobox"
            )}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave}>Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
