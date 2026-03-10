"use client"

import type React from "react"

import Link from "next/link"
import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
import { Shield, Users, Package, LayoutDashboard, Menu, LogOut, AlertTriangle, Check, ChevronRight, ExternalLink, Bell, Container } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useState, useRef, useEffect } from "react"
import { cn } from "@/lib/utils"
import { jwtDecode } from "jwt-decode"
import { useSession } from "../hooks/use-session"
import { setSelectedTeamAction } from "@/lib/team/actions/set-selected-team"
import { leaveGodModeAction } from "@/lib/team/actions/leave-god-mode"
import { Toaster } from "@/components/ui/toaster"
import { hasCustomImages } from "@/lib/custom-apko/actions"
import { hasCustomPackages } from "@/lib/custom-packages/actions"

interface UserProfile {
  firstName?: string
  lastName?: string
  email?: string
  picture?: string
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [teamsMenuOpen, setTeamsMenuOpen] = useState(false)
  const [godModeMenuOpen, setGodModeMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
  const [showCustomImages, setShowCustomImages] = useState(false)
  const lastCustomImagesTeamId = useRef<string | undefined>(undefined)
  const [showCustomPackages, setShowCustomPackages] = useState(false)
  const { session, isSessionLoading, refreshSession } = useSession()

  useEffect(() => {
    // In a real app, you would parse the session cookie here.
    // For demonstration, we'll simulate fetching user data.
    // Replace this with actual cookie parsing logic.
    const cookieString = document.cookie
      .split("; ")
      .find((row) => row.startsWith("session="))
      ?.split("=")[1]

    if (cookieString) {
      try {
        // Assuming the cookie is a JWT
        const decodedToken: UserProfile = jwtDecode(cookieString);
        setUserProfile({
            firstName: decodedToken.firstName,
            lastName: decodedToken.lastName,
            email: decodedToken.email,
            picture: decodedToken.picture
        });
      } catch (error) {
        console.error("Failed to decode JWT session cookie:", error)
        // Fallback or default user data if cookie parsing fails
        setUserProfile({
          firstName: "Guest",
          lastName: "",
          email: "guest@example.com",
        })
      }
    } else {
      // Fallback or default user data if no cookie
      setUserProfile({
        firstName: "Guest",
        lastName: "",
        email: "guest@example.com",
      })
    }
  }, [])

  // Check if team has custom images to show menu item
  useEffect(() => {
    if (session?.selectedTeamId && session.selectedTeamId !== lastCustomImagesTeamId.current) {
      lastCustomImagesTeamId.current = session.selectedTeamId;
      hasCustomImages().then(setShowCustomImages).catch(() => setShowCustomImages(false));
      hasCustomPackages().then(setShowCustomPackages).catch(() => setShowCustomPackages(false));
    } else if (!session?.selectedTeamId) {
      setShowCustomImages(false);
      setShowCustomPackages(false);
      lastCustomImagesTeamId.current = undefined;
    }
  }, [session?.selectedTeamId])

  const handleLogout = () => {
    // In a real app, you would handle logout logic here
    router.push("/login")
  }

  // Close the user menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [])

  const navItems = [
    {
      title: "Dashboard",
      items: [
        { href: "/dashboard", label: "Overview", icon: <LayoutDashboard className="h-4 w-4" /> },
        { href: "/dashboard/images", label: "Org Images", icon: <Package className="h-4 w-4" /> },
        { href: "/dashboard/external-images", label: "External Images", icon: <ExternalLink className="h-4 w-4" /> },
        ...(showCustomImages ? [{ href: "/dashboard/custom-images", label: "Custom Images", icon: <Container className="h-4 w-4" /> }] : []),
        ...(showCustomPackages ? [{ href: "/dashboard/custom-packages", label: "Custom Packages", icon: <Package className="h-4 w-4" /> }] : []),
        { href: "/dashboard/catalog", label: "Catalog", icon: <Shield className="h-4 w-4" /> },
        { href: "/dashboard/service-accounts", label: "Service Accounts", icon: <Package className="h-4 w-4" /> },
        { href: "/dashboard/notifications", label: "Notifications", icon: <Bell className="h-4 w-4" /> },
        { href: "/dashboard/notifications/history", label: "Notification History", icon: <Bell className="h-4 w-4" />, isChild: true },
      ],
    },
  ]

  // Handle redirect to login if not authenticated
  useEffect(() => {
    if (!isSessionLoading && !session) {
      router.push(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [isSessionLoading, session, pathname, router]);

  // Show loading state while checking session
  if (isSessionLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 border-4 border-teal-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  // Don't render dashboard if no session (redirect will happen in useEffect)
  if (!session) {
    return null;
  }

  const godModeTeam = session.godModeTeams?.find((team: { id: string; name: string }) => team.id === session.selectedTeamId);

  return (
    <div className="flex min-h-screen flex-col">
      <div className="sticky top-0 z-50 w-full">
        {godModeTeam && (
          <div className="flex items-center justify-center bg-black p-2 text-center font-bold text-white">
            <AlertTriangle className="mr-2 h-5 w-5 text-yellow-400" />
            <span>You are in God Mode for team: {godModeTeam.name}</span>
            <Button
              variant="destructive"
              size="sm"
              className="ml-4"
              onClick={async () => {
                const newSessionToken = await leaveGodModeAction(session, godModeTeam.id)
                if (newSessionToken) {
                  document.cookie = `session=${newSessionToken}; path=/;`
                  await refreshSession()
                  router.refresh()
                }
              }}
            >
              Leave God Mode
            </Button>
          </div>
        )}
        {/* Header */}
        <header className="w-full border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
          <div className="flex h-16 items-center justify-between px-4">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setSidebarOpen(!sidebarOpen)}>
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle menu</span>
              </Button>
              <Link href="/">
                <div className="flex items-center gap-2">
                  <Image src="/sb-192x192.png" alt="SecureBuild Logo" width={24} height={24} />
                  <span className="text-xl font-bold">SecureBuild</span>
                </div>
              </Link>
            </div>

            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" className="gap-1" asChild>
                <Link href="/dashboard/settings/team">
                  <Users className="h-4 w-4" />
                  <span>Team</span>
                </Link>
              </Button>

              {/* Custom User Menu */}
              <div className="relative" ref={userMenuRef}>
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center focus:outline-hidden"
                  aria-expanded={userMenuOpen}
                  aria-haspopup="true"
                >
                  <Avatar className="h-8 w-8 cursor-pointer hover:ring-3 hover:ring-offset-2 hover:ring-teal-500 transition-all">
                    {userProfile?.picture ? (
                      <AvatarImage src={userProfile.picture} alt={`${userProfile.firstName || ""} ${userProfile.lastName || ""}`} />
                    ) : null}
                    <AvatarFallback className="bg-teal-100 text-teal-700">
                      {userProfile?.firstName ? userProfile.firstName.charAt(0).toUpperCase() : "U"}
                    </AvatarFallback>
                  </Avatar>
                </button>

                {/* Dropdown Menu */}
                {userMenuOpen && (
                  <div className="absolute right-0 mt-2 w-56 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-50">
                    <div className="py-1">
                      <div className="px-4 py-2 border-b">
                        <p className="text-sm font-medium">{userProfile?.email || "Loading..."}</p>
                        <p className="text-xs text-gray-500">
                          {userProfile?.firstName || userProfile?.lastName
                            ? `${userProfile.firstName || ""} ${userProfile.lastName || ""}`.trim()
                            : "User"}
                        </p>
                      </div>
                      {(session.teams.length > 1 || godModeTeam) && (
                        <div key="teams-menu" className="relative border-b" onMouseEnter={() => setTeamsMenuOpen(true)} onMouseLeave={() => setTeamsMenuOpen(false)}>
                          <button className="flex items-center justify-between w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
                            <span>Teams</span>
                            <ChevronRight className="h-4 w-4" />
                          </button>

                          {teamsMenuOpen && (
                            <div className="absolute right-full top-0 mr-1 w-56 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-50">
                              <div className="py-1">
                                <div className="px-4 py-2 border-b">
                                  <p className="text-sm font-medium">Switch Team</p>
                                </div>
                                {session.teams.map((team: { id: string; name: string }) => (
                                  <button
                                    key={team.id}
                                    className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                                    onClick={async () => {
                                      if (session && session.selectedTeamId !== team.id) {
                                        setUserMenuOpen(false)
                                        setTeamsMenuOpen(false)
                                        const newSessionToken = await setSelectedTeamAction(session, team.id)
                                        if (newSessionToken) {
                                          document.cookie = `session=${newSessionToken}; path=/;`
                                          await refreshSession()
                                          router.refresh()
                                        }
                                      } else {
                                        setUserMenuOpen(false)
                                        setTeamsMenuOpen(false)
                                      }
                                    }}
                                  >
                                    <div className="w-6">
                                      {session.selectedTeamId === team.id && <Check className="h-4 w-4 text-teal-600" />}
                                    </div>
                                    <span>{team.name}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      {session.godModeTeams && session.godModeTeams.length > 0 && (
                        <div key="god-mode-menu" className="relative border-b" onMouseEnter={() => setGodModeMenuOpen(true)} onMouseLeave={() => setGodModeMenuOpen(false)}>
                          <button className="flex items-center justify-between w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
                            <span>God Mode</span>
                            <ChevronRight className="h-4 w-4" />
                          </button>
                          {godModeMenuOpen && (
                            <div className="absolute right-full top-0 mr-1 w-56 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-50">
                              <div className="py-1">
                                <div className="px-4 py-2 border-b">
                                  <p className="text-sm font-medium">God Mode Teams</p>
                                </div>
                                {session.godModeTeams.map((team: { id: string; name: string }) => (
                                  <button
                                    key={team.id}
                                    className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                                    onClick={async () => {
                                      if (session && session.selectedTeamId !== team.id) {
                                        setUserMenuOpen(false)
                                        setGodModeMenuOpen(false)
                                        const newSessionToken = await setSelectedTeamAction(session, team.id)
                                        if (newSessionToken) {
                                          document.cookie = `session=${newSessionToken}; path=/;`
                                          await refreshSession()
                                          router.refresh()
                                        }
                                      } else {
                                        setUserMenuOpen(false)
                                        setGodModeMenuOpen(false)
                                      }
                                    }}
                                  >
                                    <div className="w-6">
                                      {session.selectedTeamId === team.id && <Check className="h-4 w-4 text-teal-600" />}
                                    </div>
                                    <span>{team.name}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      <button
                        onClick={() => {
                          handleLogout()
                          setUserMenuOpen(false)
                        }}
                        className="flex items-center w-full px-4 py-2 text-sm text-red-600 hover:bg-gray-100"
                      >
                        <LogOut className="mr-2 h-4 w-4" />
                        <span>Logout</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>
      </div>

      <div className="flex flex-1">
        {/* Mobile Sidebar Overlay */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-40 bg-black/80 md:hidden" onClick={() => setSidebarOpen(false)} />
        )}

        {/* Sidebar */}
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-40 w-64 flex-col border-r bg-background pt-16 transition-transform md:static md:z-0 md:translate-x-0 md:pt-0",
            sidebarOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="flex flex-col gap-1 p-4 overflow-y-auto h-full">
            {navItems.map((section, i) => (
              <div key={i} className="mb-4">
                <div className="px-2 py-2">
                  <h2 className="text-lg font-semibold tracking-tight">{section.title}</h2>
                </div>
                <nav className="grid gap-1 px-2">
                  {section.items.map((item, j) => {
                    const isActive =
                      pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`))
                    return (
                      <Link
                        key={j}
                        href={item.href}
                        className={cn(
                          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium",
                          isActive
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-accent hover:text-accent-foreground",
                          (item as { isChild?: boolean }).isChild && "ml-4 text-muted-foreground"
                        )}
                        onClick={() => setSidebarOpen(false)}
                      >
                        {item.icon}
                        <span>{item.label}</span>
                      </Link>
                    )
                  })}
                </nav>
              </div>
            ))}
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">{children}</main>
      </div>

      <Toaster />

      {/* Footer */}
      <footer className="w-full py-6 bg-gray-100 dark:bg-gray-800">
        <div className="px-4">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="flex items-center gap-2">
              <Image src="/sb-192x192.png" alt="SecureBuild Logo" width={20} height={20} />
              <span className="text-sm font-medium">SecureBuild</span>
            </div>
            <p className="text-xs text-muted-foreground mt-2 md:mt-0">
              &copy; {new Date().getFullYear()} SecureBuild. All rights reserved.
            </p>
            <div className="flex gap-4 mt-2 md:mt-0">
              <Link href="terms" className="text-xs text-muted-foreground hover:text-teal-600">
                Terms
              </Link>
              <Link href="/privacy" className="text-xs text-muted-foreground hover:text-teal-600">
                Privacy
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
