"use client"

import { useState, useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import VendorLandingPage from "./components/VendorLandingPage"
import ProjectsLandingPage from "./components/ProjectsLandingPage"

export default function Home() {
  const pathname = usePathname()
  const router = useRouter()
  const [activePath, setActivePath] = useState<"vendors" | "projects">(
    pathname === "/oss" ? "projects" : "vendors"
  )

  // Update active path when URL changes
  // This single useEffect handles: initial load, direct navigation, and browser back/forward
  useEffect(() => {
    if (pathname === "/oss") {
      setActivePath("projects")
    } else if (pathname === "/") {
      setActivePath("vendors")
    }
  }, [pathname])

  // Function to switch paths and update URL
  const handlePathChange = (path: "vendors" | "projects") => {
    // Update the URL using Next.js router (properly syncs with usePathname)
    const newPath = path === "projects" ? "/oss" : "/"
    router.push(newPath)
    
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  useEffect(() => {
    // Handle hash navigation
    const handleHashChange = () => {
      const hash = window.location.hash
      
      if (!hash) return
      
      // All common sections now exist on both pages (how-it-works, benefits, featured-projects, launch-videos, faq)
      // No need to switch pages - just scroll to the section on the currently active page
      
      // Wait for React to re-render and mount the new page component
      // Use requestAnimationFrame to ensure DOM has been updated
      const scrollToElement = () => {
        const element = document.querySelector(hash)
        if (element) {
          element.scrollIntoView({ behavior: 'smooth' })
        } else {
          // If element not found, try again after a short delay (handles slow renders)
          setTimeout(() => {
            const retryElement = document.querySelector(hash)
            if (retryElement) {
              retryElement.scrollIntoView({ behavior: 'smooth' })
            }
          }, 150)
        }
      }
      
      requestAnimationFrame(() => {
        setTimeout(scrollToElement, 50)
      })
    }

    // Listen for hash changes
    window.addEventListener('hashchange', handleHashChange)
    
    // Handle hash scrolling when page switches or on initial load
    if (window.location.hash) {
      handleHashChange()
    }

    return () => {
      window.removeEventListener('hashchange', handleHashChange)
    }
  }, [activePath]) // Re-run when activePath changes to handle page switches with hash

  return (
    <div className="min-h-screen">
      {/* Only render the active page - this prevents duplicate IDs in the DOM */}
      {activePath === "vendors" ? (
        <VendorLandingPage activePath={activePath} setActivePath={handlePathChange} />
      ) : (
        <ProjectsLandingPage activePath={activePath} setActivePath={handlePathChange} />
      )}
    </div>
  )
}
