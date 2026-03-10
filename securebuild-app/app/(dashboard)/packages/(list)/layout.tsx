"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

const tabs = [
  {
    name: "Internal",
    href: "/packages/internal",
  },
]

export default function PackagesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()

  return (
    <div className="p-6">
      <div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0 mb-6">
        <div>
          <h1 className="text-3xl font-bold">Packages</h1>
          <p className="text-muted-foreground">View, create, manage all Melange build packages</p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-border mb-6">
        <nav className="-mb-px flex space-x-8">
          {tabs.map((tab) => {
            const isActive = pathname === tab.href || 
              (pathname === "/packages" && tab.href === "/packages/internal")
            
            return (
              <Link
                key={tab.name}
                href={tab.href}
                className={cn(
                  "whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm",
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-gray-300"
                )}
              >
                {tab.name}
              </Link>
            )
          })}
        </nav>
      </div>

      {children}
    </div>
  )
}