import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader } from "@/components/ui/card"

export default function ExecutionDetailLoading() {
  return (
    <div className="p-6">
          <div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0 mb-6">
            <div className="flex items-center gap-4">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div>
                <div className="flex items-center gap-2">
                  <Skeleton className="h-8 w-64" />
                  <Skeleton className="h-6 w-20 ml-2" />
                </div>
                <Skeleton className="h-4 w-48 mt-2" />
              </div>
            </div>
            <Skeleton className="h-10 w-32" />
          </div>

          <Skeleton className="h-16 w-full mb-6" />

          <div className="grid gap-6 grid-cols-1 md:grid-cols-3 mb-6">
            <Card>
              <CardHeader>
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-6 w-32" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-6 w-32" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-6 w-32" />
              </CardContent>
            </Card>
          </div>

          <div className="mb-6">
            <Skeleton className="h-10 w-full max-w-md" />
          </div>

          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64 mt-1" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-[400px] w-full" />
            </CardContent>
          </Card>
    </div>
  )
}
