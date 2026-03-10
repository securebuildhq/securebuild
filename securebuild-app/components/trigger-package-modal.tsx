"use client"

import React, { useState } from "react"

import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"

interface TriggerPackageModalProps {
  isOpen: boolean
  onClose: () => void
  packageName: string
  onTrigger: (opts: {
    refType: "tag" | "release" | "commit"
    refValue: string
    versionLabel: string
    archs: string[]
    publish: boolean
  }) => void
  isLoading?: boolean
}

export function TriggerPackageModal({ isOpen, onClose, packageName, onTrigger, isLoading = false }: TriggerPackageModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [refType, setRefType] = useState<"tag" | "release" | "commit">("commit")
  const [refValue, setRefValue] = useState("")
  const [versionLabel, setVersionLabel] = useState("")
  const [archs, setArchs] = useState<string[]>([])
  const [publish, setPublish] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    try {
      onTrigger({
        refType,
        refValue,
        versionLabel,
        archs,
        publish,
      })
      onClose()
    } catch (error) {
      console.error("Error triggering package:", error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleArchChange = (arch: string) => {
    setArchs((prevArchs) =>
      prevArchs.includes(arch) ? prevArchs.filter((a) => a !== arch) : [...prevArchs, arch],
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>Trigger Package: {packageName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="refType" className="text-right">
                Reference Type
              </Label>
              <Select value={refType} onValueChange={(value: "tag" | "release" | "commit") => setRefType(value)}>
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="Select reference type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="commit">Commit SHA</SelectItem>
                  <SelectItem value="tag">Tag</SelectItem>
                  <SelectItem value="release">Release</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="refValue" className="text-right">
                Reference Value
              </Label>
              <Input
                id="refValue"
                value={refValue}
                onChange={(e) => setRefValue(e.target.value)}
                className="col-span-3"
                placeholder={
                  refType === "commit"
                    ? "Enter commit SHA (e.g., 7a8b9c0d)"
                    : refType === "tag"
                      ? "Enter tag (e.g., v1.2.3)"
                      : "Enter release name (e.g., My Release)"
                }
                required
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="versionLabel" className="text-right">
                Version Label
              </Label>
              <Input
                id="versionLabel"
                value={versionLabel}
                onChange={(e) => setVersionLabel(e.target.value)}
                className="col-span-3"
                placeholder="Enter version label (e.g., 1.2.3-beta)"
                required
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Architectures</Label>
              <div className="col-span-3 flex flex-wrap gap-2">
                {["amd64", "arm64", "riscv64"].map((arch) => (
                  <div key={arch} className="flex items-center space-x-2">
                    <Checkbox
                      id={`arch-${arch}`}
                      checked={archs.includes(arch)}
                      onCheckedChange={() => handleArchChange(arch)}
                    />
                    <Label htmlFor={`arch-${arch}`}>{arch}</Label>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="publish" className="text-right">
                Publish Artifacts
              </Label>
              <Checkbox
                id="publish"
                checked={publish}
                onCheckedChange={(checked) => setPublish(Boolean(checked))}
                className="col-span-3 justify-self-start"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || isLoading}>
              {isSubmitting || isLoading ? "Triggering..." : "Trigger Build"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
