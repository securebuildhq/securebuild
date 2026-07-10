"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, Rocket, Package, Image, Users, Users2, CreditCard, FolderTree, FileCode, Shield, FileSearch, Key } from "lucide-react"
import { VERSION } from "@/lib/build-info";

export default function DashboardSidebar() {
  const pathname = usePathname()

  // Helper function to check if a path is active
  const isActive = (path: string) => {
    return pathname === path || pathname?.startsWith(path + '/')
  }

  return (
    <div className="hidden md:flex w-64 flex-col border-r bg-zinc-50 dark:bg-zinc-900">
      <div className="flex flex-col gap-2 p-4 flex-grow">
        <Link
          href="/dashboard"
          className={`flex items-center gap-2 rounded-lg px-3 py-2 transition-all hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
            isActive('/dashboard') 
              ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-50' 
              : 'text-zinc-900 dark:text-zinc-50'
          }`}
        >
          <LayoutDashboard className="h-5 w-5" />
          Dashboard
        </Link>
        <Link
          href="/catalog"
          className={`flex items-center gap-2 rounded-lg px-3 py-2 transition-all hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
            isActive('/catalog') 
              ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-50' 
              : 'text-zinc-900 dark:text-zinc-50'
          }`}
        >
          <Package className="h-5 w-5" />
          Catalog
        </Link>
        <Link
          href="/images"
          className={`flex items-center gap-2 rounded-lg px-3 py-2 transition-all hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
            isActive('/images')
              ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-50'
              : 'text-zinc-900 dark:text-zinc-50'
          }`}
        >
          <Image className="h-5 w-5" />
          Images
        </Link>
        <Link
          href="/packages"
          data-testid="packages-link"
          className={`flex items-center gap-2 rounded-lg px-3 py-2 transition-all hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
            isActive('/packages')
              ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-50'
              : 'text-zinc-900 dark:text-zinc-50'
          }`}
        >
          <Package className="h-5 w-5" />
          Packages
        </Link>
        <Link
          href="/package-families"
          className={`flex items-center gap-2 rounded-lg px-3 py-2 transition-all hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
            isActive('/package-families') 
              ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-50' 
              : 'text-zinc-900 dark:text-zinc-50'
          }`}
        >
          <FolderTree className="h-5 w-5" />
          Package Families
        </Link>
        
        {/* Executions with always-visible sub-items */}
        <div>
          <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-zinc-900 dark:text-zinc-50">
            <Rocket className="h-5 w-5" />
            <span className="flex-1 font-medium">Executions</span>
          </div>
          <div className="ml-4 mt-1 space-y-1">
            <Link
              href="/executions/packages"
              className={`flex items-center gap-2 rounded-lg px-3 py-2 transition-all hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm ${
                isActive('/executions/packages') 
                  ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-50' 
                  : 'text-zinc-900 dark:text-zinc-50'
              }`}
            >
              <Package className="h-4 w-4" />
              Packages
            </Link>
            <Link
              href="/executions/images"
              className={`flex items-center gap-2 rounded-lg px-3 py-2 transition-all hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm ${
                isActive('/executions/images')
                  ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-50'
                  : 'text-zinc-900 dark:text-zinc-50'
              }`}
            >
              <Image className="h-4 w-4" />
              Images
            </Link>
            <Link
              href="/executions/vulnerability-scans"
              className={`flex items-center gap-2 rounded-lg px-3 py-2 transition-all hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm ${
                isActive('/executions/vulnerability-scans')
                  ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-50'
                  : 'text-zinc-900 dark:text-zinc-50'
              }`}
            >
              <Shield className="h-4 w-4" />
              Vulnerability Scans
            </Link>
            <Link
              href="/executions/sbom-scans"
              className={`flex items-center gap-2 rounded-lg px-3 py-2 transition-all hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm ${
                isActive('/executions/sbom-scans')
                  ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-50'
                  : 'text-zinc-900 dark:text-zinc-50'
              }`}
            >
              <FileSearch className="h-4 w-4" />
              SBOM generations
            </Link>
          </div>
        </div>

        <Link
          href="/pipelines"
          className={`flex items-center gap-2 rounded-lg px-3 py-2 transition-all hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
            isActive('/pipelines')
              ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-50'
              : 'text-zinc-900 dark:text-zinc-50'
          }`}
        >
          <FileCode className="h-5 w-5" />
          Pipelines
        </Link>
        <Link
          href="/builders"
          className={`flex items-center gap-2 rounded-lg px-3 py-2 transition-all hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
            isActive('/builders')
              ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-50'
              : 'text-zinc-900 dark:text-zinc-50'
          }`}
        >
          <LayoutDashboard className="h-5 w-5" />
          Builders
        </Link>
        <div className="border-t border-zinc-200 dark:border-zinc-700 my-2"></div>
        <Link
          href="/users"
          className={`flex items-center gap-2 rounded-lg px-3 py-2 transition-all hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
            isActive('/users') 
              ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-50' 
              : 'text-zinc-900 dark:text-zinc-50'
          }`}
        >
          <Users className="h-5 w-5" />
          Users
        </Link>
        <Link
          href="/teams"
          className={`flex items-center gap-2 rounded-lg px-3 py-2 transition-all hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
            isActive('/teams') 
              ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-50' 
              : 'text-zinc-900 dark:text-zinc-50'
          }`}
        >
          <Users2 className="h-5 w-5" />
          Teams
        </Link>
        <Link
          href="/subscriptions"
          className={`flex items-center gap-2 rounded-lg px-3 py-2 transition-all hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
            isActive('/subscriptions') 
              ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-50' 
              : 'text-zinc-900 dark:text-zinc-50'
          }`}
        >
          <CreditCard className="h-5 w-5" />
          Subscriptions
        </Link>
        <Link
          href="/settings/system-tokens"
          className={`flex items-center gap-2 rounded-lg px-3 py-2 transition-all hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
            isActive('/settings/system-tokens')
              ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-50'
              : 'text-zinc-900 dark:text-zinc-50'
          }`}
        >
          <Key className="h-5 w-5" />
          System Tokens
        </Link>
      </div>
      <div className="p-4 mt-auto border-t border-zinc-200 dark:border-zinc-700">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Version: {VERSION}</p>
      </div>
    </div>
  )
}
