import { getPostBySlug, getAllPosts, getAuthorAvatar } from '@/lib/blog'
import { notFound } from 'next/navigation'
import { Metadata } from 'next'
import { formatDate } from '@/lib/utils'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import 'highlight.js/styles/github.css'
import Link from 'next/link'
import Image from 'next/image'
import { Clock, ArrowLeft } from 'lucide-react'


export async function generateStaticParams() {
  const posts = await getAllPosts()
  return posts.map((post) => ({
    slug: post.slug,
  }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const post = await getPostBySlug(slug)

  if (!post) {
    return {
      title: 'Post Not Found'
    }
  }

  return {
    title: `${post.title} | SecureBuild Blog`,
    description: post.excerpt,
    openGraph: {
      title: post.title,
      description: post.excerpt,
      type: 'article',
      publishedTime: post.date,
      authors: [post.author || 'SecureBuild Team'],
    },
  }
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = await getPostBySlug(slug)

  if (!post) {
    notFound()
  }

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      {/* Navigation Header */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-sm dark:bg-gray-900/80 border-b border-gray-200 dark:border-gray-800">
        <div className="container mx-auto px-4 py-4 max-w-4xl">
          <div className="flex items-center justify-between">
            {/* SecureBuild Branding */}
            <Link 
              href="https://securebuild.com" 
              className="flex items-center gap-3 hover:opacity-80 transition-opacity"
            >
              <Image src="/sb-192x192.png" alt="SecureBuild" width={24} height={24} />
              <span className="font-bold text-gray-900 dark:text-white">SecureBuild</span>
            </Link>

            {/* Back to Blog */}
            <Link
              href="/blog"
              className="flex items-center gap-2 text-gray-600 hover:text-teal-600 dark:text-gray-400 dark:hover:text-teal-400 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="font-medium">Back to Blog</span>
            </Link>
          </div>
        </div>
      </div>

      <article className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Article Header */}
        <header className="mb-12">
          <div className="max-w-3xl mx-auto text-center space-y-6">
            {/* Categories */}
            <div className="flex items-center justify-center gap-2">
              {Array.isArray(post.categories) ? post.categories.map((category: string, index: number) => (
                <span key={index} className="inline-block px-3 py-1 bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 rounded-full text-sm font-medium">
                  {category}
                </span>
              )) : (
                // Default categories if none specified
                <>
                  <span className="inline-block px-3 py-1 bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 rounded-full text-sm font-medium">
                    Security
                  </span>
                  <span className="inline-block px-3 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm font-medium">
                    DevSecOps
                  </span>
                </>
              )}
            </div>

            {/* Title */}
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 dark:text-white leading-tight">
              {post.title}
            </h1>

            {/* Excerpt */}
            {post.excerpt && (
              <p className="text-xl text-gray-600 dark:text-gray-300 leading-relaxed max-w-2xl mx-auto">
                {post.excerpt}
              </p>
            )}

            {/* Author and Meta */}
            <div className="flex items-center justify-center gap-6 pt-4">
              <div className="flex items-center gap-3">
                <Image
                  src={getAuthorAvatar(post.author || 'SecureBuild Team')}
                  alt={post.author || 'SecureBuild Team'}
                  width={56}
                  height={56}
                  className="rounded-full border-2 border-teal-100 dark:border-teal-900"
                />
                <div className="text-left">
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {post.author || 'SecureBuild Team'}
                  </p>
                  <div className="flex items-center gap-3 text-gray-500 dark:text-gray-400 text-sm">
                    {post.date && (
                      <time>{formatDate(post.date)}</time>
                    )}
                    {post.readingTime && (
                      <>
                        <span>•</span>
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>{post.readingTime} min read</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Article Content */}
        <div className="max-w-3xl mx-auto">
          <div className="prose prose-lg dark:prose-invert max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight, rehypeRaw]}
              components={{
                // Enhanced typography
                h1: ({ children }) => (
                  <h1 className="text-3xl font-bold mb-6 mt-12 text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-800 pb-4">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-2xl font-semibold mb-4 mt-10 text-gray-900 dark:text-white">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-xl font-semibold mb-3 mt-8 text-gray-900 dark:text-white">
                    {children}
                  </h3>
                ),
                p: ({ children }) => (
                  <p className="mb-6 leading-relaxed text-gray-700 dark:text-gray-300 text-lg">
                    {children}
                  </p>
                ),
                ul: ({ children }) => (
                  <ul className="mb-6 ml-6 list-disc space-y-2 text-gray-700 dark:text-gray-300">
                    {children}
                  </ul>
                ),
                ol: ({ children }) => (
                  <ol className="mb-6 ml-6 list-decimal space-y-2 text-gray-700 dark:text-gray-300">
                    {children}
                  </ol>
                ),
                li: ({ children }) => (
                  <li className="leading-relaxed">{children}</li>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="border-l-4 border-teal-500 dark:border-teal-400 bg-teal-50 dark:bg-teal-900/20 pl-6 pr-4 py-4 my-8 italic text-gray-800 dark:text-gray-200 rounded-r-lg">
                    {children}
                  </blockquote>
                ),
                code: ({ children, className }) => {
                  const isInline = !className
                  return isInline ? (
                    <code className="bg-gray-100 dark:bg-gray-800 text-teal-600 dark:text-teal-400 rounded px-2 py-1 text-sm font-mono">
                      {children}
                    </code>
                  ) : (
                    <code className={className}>{children}</code>
                  )
                },
                pre: ({ children }) => (
                  <pre className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 overflow-x-auto my-8 shadow-sm">
                    {children}
                  </pre>
                ),
                a: ({ children, href }) => (
                  <a
                    href={href}
                    className="text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 underline decoration-teal-300 hover:decoration-teal-500 transition-colors"
                    target={href?.startsWith('http') ? '_blank' : undefined}
                    rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {post.content}
            </ReactMarkdown>
          </div>
        </div>

        {/* Article Footer */}
        <footer className="max-w-3xl mx-auto mt-16 pt-8 border-t border-gray-200 dark:border-gray-800">
          {/* Author Bio */}
          <div className="bg-linear-to-r from-teal-50 to-blue-50 dark:from-teal-900/20 dark:to-blue-900/20 rounded-xl p-8 mb-8">
            <div className="flex items-start gap-4">
              <Image
                src={getAuthorAvatar(post.author || 'Grant Miller')}
                alt={post.author || 'Grant Miller'}
                width={80}
                height={80}
                className="rounded-full border-2 border-teal-200 dark:border-teal-800"
              />
              <div className="flex-1">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                  {post.author || 'Grant Miller'}
                </h3>
                <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
                  {post.author === 'Grant Miller' || !post.author ? (
                    <>
                      CEO of Replicated and Co-founder of SecureBuild, focused on making open source software more secure and sustainable. 
                      Helping maintainers monetize their projects while providing enterprise-grade security.
                    </>
                  ) : (
                    <>
                      Security experts focused on making open source software more secure and sustainable.
                      We help maintainers monetize their projects while providing enterprise-grade security.
                    </>
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* CTA Section */}
          <div className="text-center bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8">
            <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              Ready to Secure Your Project?
            </h3>
            <p className="text-gray-600 dark:text-gray-300 mb-6 max-w-2xl mx-auto">
              Partner with SecureBuild to offer secure, vulnerability-free builds while generating sustainable revenue for your open source project.
            </p>
            <Link
              href="/partner"
              className="inline-flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-8 py-3 rounded-lg font-semibold transition-colors"
            >
              Partner With Us
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
          </div>
        </footer>
      </article>
    </div>
  )
}
