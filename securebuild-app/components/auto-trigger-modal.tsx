"use client"

import type React from "react"

import { useState } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

interface AutoTriggerModalProps {
  isOpen: boolean
  onClose: () => void
  triggerType: string
  packageName: string
}

export function AutoTriggerModal({ isOpen, onClose, triggerType, packageName }: AutoTriggerModalProps) {
  const [isEnabled, setIsEnabled] = useState(true)
  const [branch, setBranch] = useState("main")
  const [schedule, setSchedule] = useState("daily")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      // In a real app, this would be an API call to update the auto-trigger settings
      console.log("Updating auto-trigger settings:", {
        packageName,
        triggerType,
        isEnabled,
        branch,
        schedule,
      })

      // Simulate API call delay
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Close the modal
      onClose()
    } catch (error) {
      console.error("Error updating auto-trigger settings:", error)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {triggerType === "GH Action" ? "GitHub Action" : triggerType === "Cron" ? "Schedule" : "CLI"} Trigger
            Settings
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="auto-trigger-enabled">Enable Auto-Trigger</Label>
              <Switch id="auto-trigger-enabled" checked={isEnabled} onCheckedChange={setIsEnabled} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="branch">Branch</Label>
              <Input
                id="branch"
                placeholder="main"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                disabled={!isEnabled}
                required
              />
            </div>

            {triggerType === "Cron" && (
              <div className="space-y-2">
                <Label htmlFor="schedule">Schedule</Label>
                <Select value={schedule} onValueChange={setSchedule} disabled={!isEnabled}>
                  <SelectTrigger id="schedule">
                    <SelectValue placeholder="Select schedule" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hourly">Hourly</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="text-sm text-muted-foreground">
              {triggerType === "GH Action"
                ? "This will trigger the package build when changes are pushed to the specified branch."
                : triggerType === "Cron"
                  ? "This will trigger the package build on a scheduled basis."
                  : "This will enable CLI-based triggering of the package build."}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Save Settings"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
