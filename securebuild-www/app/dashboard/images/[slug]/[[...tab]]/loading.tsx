import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col gap-6">
        <div className="h-6 w-48 bg-gray-200 animate-pulse rounded"></div>

        <div className="flex flex-col md:flex-row gap-6 items-start">
          <Skeleton className="w-24 h-24 rounded-lg" />
          <div className="flex-1">
            <Skeleton className="h-8 w-64 mb-4" />
            <Skeleton className="h-4 w-full max-w-md mb-4" />
            <div className="flex flex-wrap gap-4">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
          <div className="flex flex-col gap-2 w-full md:w-auto">
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-10 w-32" />
          </div>
        </div>

        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-20 w-full" />

        <div>
          <div className="flex gap-2 mb-4">
            <Skeleton className="h-10 w-20" />
            <Skeleton className="h-10 w-20" />
            <Skeleton className="h-10 w-20" />
            <Skeleton className="h-10 w-20" />
            <Skeleton className="h-10 w-20" />
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    </div>
  )
}
