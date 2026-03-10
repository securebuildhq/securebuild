"use client"

import React, { useState, useEffect } from "react"
import Image from "next/image"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FileText, AlertCircle, Loader2 } from "lucide-react"
import { useInspect } from "../inspect-context"
import { getImageReadmeAction } from "@/lib/image/actions/get-readme"
import { useSession } from "@/app/hooks/use-session"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkEmoji from "remark-emoji"
import rehypeRaw from "rehype-raw"

export default function ReadmePage() {
  const { image, selectedTag, selectedArchitecture, hasReadme } = useInspect()
  const { session } = useSession()
  const [readmeContent, setReadmeContent] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load readme content when tag or architecture changes
  useEffect(() => {
    if (!image || !hasReadme) {
      setReadmeContent(null)
      setIsLoading(false)
      return
    }

    const loadReadme = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const content = await getImageReadmeAction(
          session ?? undefined,
          image.name,
          selectedTag,
          selectedArchitecture
        )
        setReadmeContent(content)
      } catch (err) {
        console.error('Error loading readme:', err)
        setError('Failed to load README content')
        setReadmeContent(null)
      } finally {
        setIsLoading(false)
      }
    }

    loadReadme()
  }, [image, selectedTag, selectedArchitecture, session, hasReadme])



  if (!image) {
    return (
      <div className="text-center py-8">
        <div className="flex justify-center mb-4">
          <AlertCircle className="h-16 w-16 text-muted-foreground" />
        </div>
        <p className="text-muted-foreground text-lg">
          No image data available
        </p>
      </div>
    )
  }

  if (!hasReadme) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="py-12 flex flex-col items-center justify-center text-center">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
              <FileText className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No README Available</h3>
            <p className="text-muted-foreground max-w-md">
              This image doesn&apos;t have a README file. Check the other tabs for technical details like security information and SBOM.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="py-12 flex flex-col items-center justify-center text-center">
            <div className="flex justify-center mb-4">
              <AlertCircle className="h-16 w-16 text-red-500" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Error Loading README</h3>
            <p className="text-red-600 dark:text-red-400 max-w-md">{error}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Documentation
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-muted-foreground">Loading README content...</p>
              </div>
            </div>
          ) : readmeContent ? (
            <div className="prose prose-slate dark:prose-invert max-w-none prose-pre:bg-muted prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:font-mono prose-code:before:content-none prose-code:after:content-none prose-ul:list-disc prose-ol:list-decimal prose-li:list-item prose-img:inline prose-img:m-0">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkEmoji]}
                rehypePlugins={[rehypeRaw]}
                components={{
                  // Heading components
                  h1: ({ ...props }) => (
                    <h1 className="text-3xl font-bold mb-4 mt-6 text-gray-900 dark:text-gray-100" {...props} />
                  ),
                  h2: ({ ...props }) => (
                    <h2 className="text-2xl font-semibold mb-3 mt-5 text-gray-900 dark:text-gray-100" {...props} />
                  ),
                  h3: ({ ...props }) => (
                    <h3 className="text-xl font-medium mb-2 mt-4 text-gray-900 dark:text-gray-100" {...props} />
                  ),
                  h4: ({ ...props }) => (
                    <h4 className="text-lg font-medium mb-2 mt-3 text-gray-900 dark:text-gray-100" {...props} />
                  ),
                  h5: ({ ...props }) => (
                    <h5 className="text-base font-medium mb-2 mt-3 text-gray-900 dark:text-gray-100" {...props} />
                  ),
                  h6: ({ ...props }) => (
                    <h6 className="text-sm font-medium mb-2 mt-3 text-gray-900 dark:text-gray-100" {...props} />
                  ),
                  // Only override specific components that need custom styling
                  a: ({ href, children, ...props }) => {
                    // Handle GitHub theme-specific links
                    if (href?.includes('#gh-dark-mode-only')) {
                      // Hide dark mode content since we only support light mode
                      return null
                    }

                    if (href?.includes('#gh-light-mode-only')) {
                      // Show light mode content without the link wrapper
                      return <span>{children}</span>
                    }

                    // Regular links
                    return (
                      <a
                        href={href}
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                        target="_blank"
                        rel="noopener noreferrer"
                        {...props}
                      >
                        {children}
                      </a>
                    )
                  },
                  // GitHub-style tables
                  table: ({ ...props }) => (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-300 dark:divide-gray-700" {...props} />
                    </div>
                  ),
                  thead: ({ ...props }) => (
                    <thead className="bg-gray-50 dark:bg-gray-800" {...props} />
                  ),
                  th: ({ ...props }) => (
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-300 dark:border-gray-700" {...props} />
                  ),
                                     td: ({ ...props }) => (
                     <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 border-b border-gray-200 dark:border-gray-700" {...props} />
                   ),
                   // Ensure list styling is preserved
                   ul: ({ ...props }) => (
                     <ul className="list-disc pl-6 mb-4 space-y-2" {...props} />
                   ),
                   ol: ({ ...props }) => (
                     <ol className="list-decimal pl-6 mb-4 space-y-2" {...props} />
                   ),
                   li: ({ ...props }) => (
                     <li className="pl-1" {...props} />
                   ),
                                      // Make images inline (especially badges)
                   img: ({ ...props }) => {
                     const { src, alt = "", width = 150, height = 100 } = props;
                     const srcString = typeof src === 'string' ? src : '';
                     return (
                       <Image 
                         className="inline mr-1" 
                         src={srcString || ""} 
                         alt={alt} 
                         width={typeof width === 'string' ? parseInt(width, 10) : width}
                         height={typeof height === 'string' ? parseInt(height, 10) : height}
                         style={{ display: 'inline' }}
                       />
                     );
                   },
                 }}
              >
                {readmeContent}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <div className="flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4 mx-auto">
                <FileText className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2 text-foreground">No README for this tag</h3>
              <p className="max-w-md mx-auto">
                No README content is available for tag <code className="bg-muted px-1.5 py-0.5 rounded">{selectedTag}</code> on {selectedArchitecture} architecture.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
