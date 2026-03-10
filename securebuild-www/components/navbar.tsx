"use client"

import Link from "next/link"
import Image from "next/image"
import { useState } from "react"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Menu, X } from "lucide-react"
import { useSession } from "@/app/hooks/use-session"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"

interface NavbarProps {
  pageType?: "vendor" | "oss"
}

export default function Navbar({ pageType }: NavbarProps = { pageType: undefined }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { session, isSessionLoading } = useSession()
  const pathname = usePathname()

  const isHomePage = pathname === '/' || pathname === '/oss'
  const isVendorPage = pathname === '/' || pageType === 'vendor'
  const isOSSPage = pathname === '/oss' || pageType === 'oss'

  // For non-home pages, link back to homepage anchors; otherwise use current page anchors
  const getNavLink = (anchor: string) => {
    return isHomePage ? `#${anchor}` : `/#${anchor}`
  }

  // Image Catalog has special logic - show /images or featured-projects section
  const getImageCatalogLink = () => {
    return isHomePage ? "#featured-projects" : "/images"
  }

  if (isSessionLoading) {
    return (
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
        <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12 flex h-16 items-center justify-between">
          {/* Left: Logo */}
          <Link href="/" className="flex items-center gap-2">
            <Image src="/sb-192x192.png" alt="SecureBuild Logo" width={24} height={24} />
            <span className="text-xl font-bold">SecureBuild</span>
          </Link>

          {/* Middle: Actual Nav links */}
          <nav className="hidden md:flex gap-6">
            <Link href={getNavLink('how-it-works')} className="text-sm font-medium hover:text-teal-600 transition-colors">
              How It Works
            </Link>
            <Link href={getNavLink('benefits')} className="text-sm font-medium hover:text-teal-600 transition-colors">
              Benefits
            </Link>
            <Link href={getImageCatalogLink()} className="text-sm font-medium hover:text-teal-600 transition-colors">
              Catalog
            </Link>
            <Link href={getNavLink('launch-videos')} className="text-sm font-medium hover:text-teal-600 transition-colors">
              Videos
            </Link>
            <Link href={getNavLink('faq')} className="text-sm font-medium hover:text-teal-600 transition-colors">
              FAQ
            </Link>
            <Link href="/blog" className="text-sm font-medium hover:text-teal-600 transition-colors">
              Blog
            </Link>
          </nav>

          {/* Right: User menu/buttons placeholder */}
          <div className="flex items-center gap-4 md:min-w-52 md:justify-end" aria-hidden="true">
            {/* Desktop placeholders (mimicking logged-out state for max width) */}
            <div className="hidden md:block h-6 w-16 bg-muted rounded animate-pulse"></div> {/* For "Sign In" link */}
            <div className="hidden md:block h-10 w-32 bg-muted rounded animate-pulse"></div> {/* For "Partner" button */}

            {/* Mobile menu toggle placeholder */}
            <div className="md:hidden h-6 w-6 bg-muted rounded-full animate-pulse"></div>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
      <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12 flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/sb-192x192.png" alt="SecureBuild Logo" width={24} height={24} />
          <span className="text-xl font-bold">SecureBuild</span>
        </Link>
        <nav className="hidden md:flex gap-6">
          <Link href={getNavLink('how-it-works')} className="text-sm font-medium hover:text-teal-600 transition-colors">
            How It Works
          </Link>
          <Link href={getNavLink('benefits')} className="text-sm font-medium hover:text-teal-600 transition-colors">
            Benefits
          </Link>
          <Link
            href={getImageCatalogLink()}
            className="text-sm font-medium hover:text-teal-600 transition-colors"
          >
            Catalog
          </Link>
          <Link href={getNavLink('launch-videos')} className="text-sm font-medium hover:text-teal-600 transition-colors">
            Videos
          </Link>
          <Link href={getNavLink('faq')} className="text-sm font-medium hover:text-teal-600 transition-colors">
            FAQ
          </Link>
          <Link href="/blog" className="text-sm font-medium hover:text-teal-600 transition-colors">
            Blog
          </Link>
        </nav>
        <div className="flex items-center gap-4 md:min-w-52 md:justify-end">
          {session && session.user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild className="hidden md:block">
                <Button variant="ghost" className="relative h-10 w-10 rounded-full bottom-1.5">
                  <Avatar className="h-10 w-10">
                    <AvatarImage
                        src={session.user.picture || ""}
                        alt={(session.user.firstName && session.user.lastName)
                            ? `${session.user.firstName} ${session.user.lastName}`
                            : session.user.firstName || "User"}
                    />
                    <AvatarFallback>
                      {(session.user.firstName && session.user.lastName)
                        ? `${session.user.firstName[0]}${session.user.lastName[0]}`.toUpperCase()
                        : session.user.firstName
                            ? `${session.user.firstName[0]}`.toUpperCase()
                            : "U"}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">
                        {(session.user.firstName && session.user.lastName)
                            ? `${session.user.firstName} ${session.user.lastName}`
                            : session.user.firstName || "User"}
                    </p>
                    <p className="text-xs leading-none text-muted-foreground">
                      {session.user.email || "No email"}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/dashboard">Dashboard</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/partner">Partner With Us</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/logout">Logout</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Link href={`/login${pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`}`} className="text-sm font-medium hover:text-teal-600 transition-colors hidden md:block">
              Sign In
            </Link>
          )}
          {!(session && session.user) && (
            <>
              {isVendorPage ? (
                <Button className="bg-teal-600 hover:bg-teal-700" asChild>
                  <Link href="/enterprise">Request a Demo</Link>
                </Button>
              ) : (
                <Button className="bg-teal-600 hover:bg-teal-700" asChild>
                  <Link href="/partner">Partner With Us</Link>
                </Button>
              )}
            </>
          )}
          <button className="md:hidden" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label="Toggle menu">
            {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-background border-b">
          <div className="container mx-auto max-w-6xl px-4 py-4 space-y-3">
            <Link
              href={getNavLink('how-it-works')}
              className="block text-sm font-medium hover:text-teal-600 transition-colors py-2"
              onClick={() => setMobileMenuOpen(false)}
            >
              How It Works
            </Link>
            <Link
              href={getNavLink('benefits')}
              className="block text-sm font-medium hover:text-teal-600 transition-colors py-2"
              onClick={() => setMobileMenuOpen(false)}
            >
              Benefits
            </Link>
            <Link
              href={getImageCatalogLink()}
              className="block text-sm font-medium hover:text-teal-600 transition-colors py-2"
              onClick={() => setMobileMenuOpen(false)}
            >
              Catalog
            </Link>
            <Link
              href={getNavLink('launch-videos')}
              className="block text-sm font-medium hover:text-teal-600 transition-colors py-2"
              onClick={() => setMobileMenuOpen(false)}
            >
              Videos
            </Link>
            <Link
              href={getNavLink('faq')}
              className="block text-sm font-medium hover:text-teal-600 transition-colors py-2"
              onClick={() => setMobileMenuOpen(false)}
            >
              FAQ
            </Link>
            <Link
              href="/blog"
              className="block text-sm font-medium hover:text-teal-600 transition-colors py-2"
              onClick={() => setMobileMenuOpen(false)}
            >
              Blog
            </Link>
            {session && session.user ? (
              <>
                <Link
                  href="/dashboard"
                  className="block text-sm font-medium hover:text-teal-600 transition-colors py-2"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Dashboard
                </Link>
                <Link
                  href="/profile"
                  className="block text-sm font-medium hover:text-teal-600 transition-colors py-2"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Profile
                </Link>
                <Link
                  href="/partner"
                  className="block text-sm font-medium hover:text-teal-600 transition-colors py-2"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Partner With Us
                </Link>
                <Link
                  href="/logout"
                  className="block w-full text-left text-sm font-medium hover:text-teal-600 transition-colors py-2"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Logout
                </Link>
              </>
            ) : (
              <>
                <Link
                  href={`/login?next=${encodeURIComponent(pathname)}`}
                  className="block text-sm font-medium hover:text-teal-600 transition-colors py-2"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Sign In
                </Link>
                {isVendorPage ? (
                  <Button asChild className="bg-teal-600 hover:bg-teal-700 w-full">
                    <Link href="/enterprise" onClick={() => setMobileMenuOpen(false)}>Request a Demo</Link>
                  </Button>
                ) : (
                  <Button asChild className="bg-teal-600 hover:bg-teal-700 w-full">
                    <Link href="/partner" onClick={() => setMobileMenuOpen(false)}>Partner With Us</Link>
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </header>
  )
}
