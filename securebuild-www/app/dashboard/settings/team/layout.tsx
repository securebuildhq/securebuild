"use client"

import { Users, CreditCard, Home } from "lucide-react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { usePathname } from "next/navigation"
import Link from "next/link"

export default function TeamSettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  let activeTabValue = "overview"
  if (pathname === "/dashboard/settings/team/billing") {
    activeTabValue = "billing"
  } else if (pathname === "/dashboard/settings/team/members") {
    activeTabValue = "team"
  } else if (pathname === "/dashboard/settings/team") {
    activeTabValue = "overview"
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold">Team Settings</h1>
          <p className="text-muted-foreground mt-1">Manage your team&apos;s overview, members, and subscription</p>
        </div>

        <Tabs value={activeTabValue} className="w-full">
          <TabsList className="grid w-full max-w-lg grid-cols-3">
            <Link href="/dashboard/settings/team" passHref legacyBehavior>
              <TabsTrigger value="overview" asChild className="cursor-pointer">
                <a><Home className="mr-2 h-4 w-4" />Overview</a>
              </TabsTrigger>
            </Link>
            <Link href="/dashboard/settings/team/members" passHref legacyBehavior>
              <TabsTrigger value="team" asChild className="cursor-pointer">
                <a><Users className="mr-2 h-4 w-4" />Team Members</a>
              </TabsTrigger>
            </Link>
            <Link href="/dashboard/settings/team/billing" passHref legacyBehavior>
              <TabsTrigger value="billing" asChild className="cursor-pointer">
                <a><CreditCard className="mr-2 h-4 w-4" />Billing</a>
              </TabsTrigger>
            </Link>
          </TabsList>
          <div className="mt-6">
            {children}
          </div>
        </Tabs>
      </div>
    </div>
  )
}
