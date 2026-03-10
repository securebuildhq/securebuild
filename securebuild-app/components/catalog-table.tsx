"use client"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { CatalogItem } from "@/lib/types/catalog"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { MoreHorizontal } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"

interface CatalogTableProps {
  catalogItems: CatalogItem[]
}

export function CatalogTable({ catalogItems }: CatalogTableProps) {
  const router = useRouter()

  const handleRowClick = (itemId: string) => {
    router.push(`/catalog/${itemId}`)
  }

  const calculateOverallBuildStatus = (item: CatalogItem): "success" | "failed" | "building" | "pending" | "no-builds" => {
    if (!item.images || item.images.length === 0) {
      return "no-builds";
    }

    const allStatuses = item.images.map(image => image.overallBuildStatus);
    
    if (allStatuses.some(status => status === "failed")) {
      return "failed";
    } else if (allStatuses.some(status => status === "building")) {
      return "building";
    } else if (allStatuses.some(status => status === "pending")) {
      return "pending";
    } else if (allStatuses.every(status => status === "success")) {
      return "success";
    } else {
      return "no-builds";
    }
  }

  const getBuildStatusBadge = (status: "success" | "failed" | "building" | "pending" | "no-builds") => {
    switch (status) {
      case "success":
        return <Badge variant="default" className="bg-green-100 text-green-800 hover:bg-green-200">Success</Badge>
      case "failed":
        return <Badge variant="destructive">Failed</Badge>
      case "building":
        return <Badge variant="secondary" className="bg-blue-100 text-blue-800 hover:bg-blue-200">Building</Badge>
      case "pending":
        return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 hover:bg-yellow-200">Pending</Badge>
      case "no-builds":
        return <Badge variant="outline">No Builds</Badge>
      default:
        return <Badge variant="outline">Unknown</Badge>
    }
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Description</TableHead>
          <TableHead>Created At</TableHead>
          <TableHead>Build Status</TableHead>
          <TableHead>Stripe Product ID</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {catalogItems.map((item) => (
          <TableRow 
            key={item.id} 
            className="cursor-pointer hover:bg-muted/50"
            onClick={() => handleRowClick(item.id)}
          >
            <TableCell>{item.name}</TableCell>
            <TableCell>{item.description}</TableCell>
            <TableCell>{new Date(item.createdAt).toLocaleDateString()}</TableCell>
            <TableCell>{getBuildStatusBadge(calculateOverallBuildStatus(item))}</TableCell>
            <TableCell>{item.stripeProductId}</TableCell>
            <TableCell className="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button 
                    variant="ghost" 
                    className="h-8 w-8 p-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="sr-only">Open menu</span>
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem>
                    <Link href={`/catalog/${item.id}/edit`} className="w-full" onClick={(e) => e.stopPropagation()}>
                      Edit
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
