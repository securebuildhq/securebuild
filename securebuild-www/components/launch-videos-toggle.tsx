"use client"

import { Button } from "@/components/ui/button"
import { ChevronDown, ChevronUp } from "lucide-react"
import { useState } from "react"

export function LaunchVideosToggle() {
  const [showAllVideos, setShowAllVideos] = useState(false)

  const toggleVideos = () => {
    setShowAllVideos(!showAllVideos)
    const expandedSection = document.getElementById('expanded-videos')
    if (expandedSection) {
      if (!showAllVideos) {
        expandedSection.classList.remove('hidden')
      } else {
        expandedSection.classList.add('hidden')
      }
    }
  }

  return (
    <div className="flex justify-center mt-8">
      <Button
        variant="outline"
        onClick={toggleVideos}
        className="text-teal-600 border-teal-600 hover:bg-teal-50"
      >
        {showAllVideos ? (
          <>
            View Fewer Videos
            <ChevronUp className="ml-2 h-4 w-4" />
          </>
        ) : (
          <>
            View All Videos
            <ChevronDown className="ml-2 h-4 w-4" />
          </>
        )}
      </Button>
    </div>
  )
} 