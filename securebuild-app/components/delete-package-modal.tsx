import React, { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface DeletePackageModalProps {
  isOpen: boolean
  onClose: () => void
  packageName: string
  onDelete: () => Promise<void>
  isLoading?: boolean
}

export function DeletePackageModal({ isOpen, onClose, packageName, onDelete, isLoading }: DeletePackageModalProps) {
  const [input, setInput] = useState("")
  const [error, setError] = useState("")

  const handleDelete = async () => {
    if (input !== packageName) {
      setError("Package name does not match.")
      return
    }
    setError("")
    await onDelete()
    setInput("")
  }

  const handleClose = () => {
    setInput("")
    setError("")
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Package</DialogTitle>
        </DialogHeader>
        <div className="mb-2">Are you sure you want to delete <span className="font-bold">{packageName}</span>? This action cannot be undone.</div>
        <div className="mb-2 text-sm text-muted-foreground">Please type the package name to confirm:</div>
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Type package name..."
          disabled={isLoading}
        />
        {error && <div className="text-red-600 text-xs mt-1">{error}</div>}
        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isLoading}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={input !== packageName || isLoading}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
