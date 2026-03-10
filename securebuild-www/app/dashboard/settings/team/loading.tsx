import { Skeleton } from "@/components/ui/skeleton"

export default function TeamLoading() {
  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex flex-col gap-6">
        <div>
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-4 w-96 mt-2" />
        </div>

        <Skeleton className="h-10 w-full max-w-md" />

        <div className="mt-6">
          <div className="flex justify-between items-center mb-6">
            <div>
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64 mt-1" />
            </div>
            <Skeleton className="h-10 w-32" />
          </div>

          <Skeleton className="h-[400px] w-full rounded-md" />
        </div>
      </div>
    </div>
  )
}
