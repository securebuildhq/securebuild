"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog"
import { CatalogItem } from "@/lib/types/catalog"
import { Layers } from "lucide-react"

interface ProjectActionsProps {
  catalogItem: CatalogItem
  slug: string
}

export function ProjectActions({ catalogItem, slug }: ProjectActionsProps) {
  const [isModalOpen, setModalOpen] = useState(false)

  return (
    <div className="pt-2 flex gap-2">
      <Button className="bg-blue-600 hover:bg-blue-700 text-white" asChild>
        <Link href={`/checkout/${slug}`}>Subscribe to {catalogItem.name} SecureBuild</Link>
      </Button>
      {catalogItem.images.length === 1 && (
        <Button
          className="bg-white text-blue-600 border-blue-200 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 dark:bg-blue-800 dark:text-blue-100 dark:border-blue-700 dark:hover:bg-blue-700"
          asChild
          variant="outline"
        >
          <Link href={`/images/${catalogItem.images[0].name}/inspect`}>Inspect Image</Link>
        </Button>
      )}
      {catalogItem.images.length > 1 && (
        <Dialog open={isModalOpen} onOpenChange={setModalOpen}>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              className="bg-white text-blue-600 border-blue-200 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 dark:bg-blue-800 dark:text-blue-100 dark:border-blue-700 dark:hover:bg-blue-700"
            >
              Inspect Image
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Select Image to Inspect</DialogTitle>
              <DialogDescription>
                This project contains multiple images. Please select one to view its security details.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 pt-4">
              {catalogItem.images.map(image => (
                <Link key={image.id} href={`/images/${image.name}/inspect`} passHref>
                  <Button variant="outline" className="w-full justify-start gap-2" onClick={() => setModalOpen(false)}>
                    <Layers className="h-4 w-4" />
                    <span>{image.name}</span>
                  </Button>
                </Link>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
