import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export default function AdvisoriesLoading() {
  return (
    <div className="container mx-auto px-4 py-6">
      <div className="flex flex-col space-y-8">
        {/* Header */}
        <div className="flex flex-col space-y-2">
          <Skeleton className="h-8 w-[300px]" />
          <Skeleton className="h-4 w-[500px]" />
        </div>

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          {Array(4)
            .fill(null)
            .map((_, i) => (
              <div key={i} className="rounded-lg border bg-card p-4 shadow-sm">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-5 rounded-full" />
                  <Skeleton className="h-4 w-[100px]" />
                </div>
                <div className="mt-2">
                  <Skeleton className="h-8 w-[60px]" />
                  <Skeleton className="mt-1 h-3 w-[80px]" />
                </div>
              </div>
            ))}
        </div>

        {/* Search and Filters */}
        <div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0">
          <Skeleton className="h-10 w-[300px]" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-10 w-[130px]" />
            <Skeleton className="h-10 w-[130px]" />
            <Skeleton className="h-10 w-[130px]" />
            <Skeleton className="h-10 w-[100px]" />
          </div>
        </div>

        {/* Advisories Table */}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px]">
                  <Skeleton className="h-4 w-[80px]" />
                </TableHead>
                <TableHead>
                  <Skeleton className="h-4 w-[200px]" />
                </TableHead>
                <TableHead className="w-[100px]">
                  <Skeleton className="h-4 w-[60px]" />
                </TableHead>
                <TableHead className="w-[120px]">
                  <Skeleton className="h-4 w-[80px]" />
                </TableHead>
                <TableHead className="w-[120px]">
                  <Skeleton className="h-4 w-[80px]" />
                </TableHead>
                <TableHead className="w-[120px]">
                  <Skeleton className="h-4 w-[80px]" />
                </TableHead>
                <TableHead className="w-[120px]">
                  <Skeleton className="h-4 w-[80px]" />
                </TableHead>
                <TableHead className="w-[100px]">
                  <Skeleton className="h-4 w-[60px]" />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array(5)
                .fill(null)
                .map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-4 w-[100px]" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-[250px]" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-6 w-[80px] rounded-full" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-6 w-[100px] rounded-full" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-[80px]" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-[100px]" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-[80px]" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-8 w-[60px]" />
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-[200px]" />
          <div className="flex items-center space-x-2">
            <Skeleton className="h-8 w-[80px]" />
            <Skeleton className="h-8 w-[40px]" />
            <Skeleton className="h-8 w-[80px]" />
          </div>
        </div>
      </div>
    </div>
  )
}
