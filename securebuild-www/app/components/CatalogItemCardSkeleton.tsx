"use client"

import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export function CatalogItemCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="p-4 pb-0">
        <div className="flex justify-between items-start">
          <div className="space-y-1 w-3/4">
            <Skeleton className="h-6 w-3/4" /> {/* Title placeholder */}
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-5 w-20" /> {/* Category placeholder */}
              <Skeleton className="h-5 w-16" /> {/* Stars placeholder */}
            </div>
          </div>
          <Skeleton className="h-5 w-28" /> {/* Vulnerabilities placeholder */}
        </div>
      </CardHeader>
      <CardContent className="p-4">
        <Skeleton className="relative h-[140px] w-full mb-4" /> {/* Image placeholder */}
        <Skeleton className="h-4 w-full mb-1" /> {/* Description line 1 */}
        <Skeleton className="h-4 w-full mb-1" /> {/* Description line 2 */}
        <Skeleton className="h-4 w-3/4" />      {/* Description line 3 */}
      </CardContent>
      <CardFooter className="p-4 pt-0 flex justify-between items-center">
        <div className="flex items-center gap-1 w-1/3">
          <Skeleton className="h-5 w-full" /> {/* Downloads placeholder */}
        </div>
        <Skeleton className="h-9 w-24" /> {/* Button placeholder */}
      </CardFooter>
    </Card>
  )
}
