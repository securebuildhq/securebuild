"use client"

import React, { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { X, Plus, Tag } from "lucide-react"

interface EditTagsModalProps {
  isOpen: boolean
  onClose: () => void
  apkoName: string
  currentTags: string[]
  onSave: (newTags: string[]) => void
  isLoading?: boolean
}

export function EditTagsModal({
  isOpen,
  onClose,
  apkoName,
  currentTags,
  onSave,
  isLoading = false
}: EditTagsModalProps) {
  const [tags, setTags] = useState<string[]>([])
  const [newTag, setNewTag] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setTags([...currentTags])
      setNewTag("")
    }
  }, [isOpen, currentTags])

  const handleAddTag = () => {
    const tagValue = newTag.trim()
    if (tagValue && !tags.includes(tagValue)) {
      setTags([...tags, tagValue])
      setNewTag("")
    }
  }

  const handleRemoveTag = (indexToRemove: number) => {
    setTags(tags.filter((_, index) => index !== indexToRemove))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    try {
      await onSave(tags)
      onClose()
    } catch (error) {
      console.error("Error saving tags:", error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddTag()
    }
  }

  const hasChanges = JSON.stringify(tags.sort()) !== JSON.stringify(currentTags.sort())

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" />
            Edit Tags for {apkoName}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="newTag">Add New Tag</Label>
              <div className="flex gap-2">
                <Input
                  id="newTag"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Enter a tag template (e.g. latest, v{{.Packages.golang.Version}})"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddTag}
                  disabled={!newTag.trim() || tags.includes(newTag.trim())}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Tags can be templates that reference package versions. Use Go template syntax.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Current Tags ({tags.length})</Label>
              {tags.length > 0 ? (
                <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto border rounded-md p-3">
                  {tags.map((tag, index) => (
                    <Badge key={index} variant="secondary" className="flex items-center gap-1 py-1 px-2">
                      <Tag className="h-3 w-3" />
                      {tag}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto p-0 ml-1 hover:bg-destructive hover:text-destructive-foreground"
                        onClick={() => handleRemoveTag(index)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </Badge>
                  ))}
                </div>
              ) : (
                <div className="border rounded-md p-6 text-center text-muted-foreground">
                  <Tag className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No tags configured</p>
                  <p className="text-xs">Add a tag above to get started</p>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || isLoading || !hasChanges}
            >
              {isSubmitting || isLoading ? "Saving..." : "Save Tags"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
