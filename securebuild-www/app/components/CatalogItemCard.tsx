"use client"

import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ChevronRight } from "lucide-react"
import { CatalogItem } from "@/lib/types/catalog"

interface CatalogItemCardProps {
  project: CatalogItem;
}

export function CatalogItemCard({ project }: CatalogItemCardProps) {
  return (
    <Card key={project.id} className="overflow-hidden transition-all duration-200 hover:shadow-md">
      <CardHeader className="p-4 pb-0">
        <div className="space-y-2">
          {/* Mobile: Stack vertically, Desktop: Keep title and partner on same line */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
            <CardTitle className="text-lg sm:text-xl line-clamp-2 flex-1">{project.name}</CardTitle>
            {project.isPartner && (
              <Badge className="bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-300 font-semibold flex items-center gap-1 w-fit">
                ✓ Partner
              </Badge>
            )}
          </div>

          {/* Vulnerabilities badge - full width on mobile */}
          <Badge
            variant="outline"
            className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800 w-fit text-xs"
          >
            <span className="sm:hidden">{project.cvesFixedCount} vulns fixed</span>
            <span className="hidden sm:inline">{project.cvesFixedCount} vulnerabilities fixed</span>
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        <div className="relative h-[100px] sm:h-[140px] w-full mb-4 bg-gray-100 dark:bg-gray-800 rounded-md flex items-center justify-center p-4">
          <Image
            src={project.imageUrl}
            width={108}
            height={108}
            alt={`${project.name} logo`}
            className="object-contain h-full w-auto"
          />
        </div>

        {/* Category badge */}
        <div className="flex flex-wrap gap-2 mb-3">
          <Badge variant="outline" className="w-fit text-xs">
            {project.category}
          </Badge>
        </div>

        <p className="text-xs sm:text-sm text-muted-foreground line-clamp-3 h-[45px] sm:h-[60px]">{project.description}</p>
      </CardContent>
      <CardFooter className="p-4 pt-0 flex justify-between items-center">
        <Button asChild size="sm" className="bg-teal-600 hover:bg-teal-700 text-xs sm:text-sm">
          <Link href={`/images/${project.slug}`}>
            View Details
            <ChevronRight className="ml-1 h-3 w-3 sm:h-4 sm:w-4" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
