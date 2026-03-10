import { getAllPosts, getAuthorAvatar } from '@/lib/blog'
import Link from 'next/link'
import Image from 'next/image'
import { formatDate } from '@/lib/utils'
import { Clock, User, ArrowLeft } from 'lucide-react'

export default async function BlogPage() {
  const posts = await getAllPosts()

  return (
    <div className="min-h-screen bg-linear-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-800">
      {/* Header */}
      <div className="border-b bg-white/80 backdrop-blur-sm dark:bg-gray-900/80 dark:border-gray-800">
        <div className="container mx-auto px-4 py-8 max-w-4xl">
          {/* Back to Home Link */}
          <div className="mb-6">
            <Link 
              href="/" 
              className="inline-flex items-center gap-2 text-gray-600 hover:text-teal-600 dark:text-gray-400 dark:hover:text-teal-400 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="font-medium">Back to Home</span>
            </Link>
          </div>
          
          <div className="text-center space-y-4">
            <div className="flex items-center justify-center gap-3 mb-4">
              <Image src="/sb-192x192.png" alt="SecureBuild Logo" width={32} height={32} />
              <h1 className="text-4xl font-bold text-gray-900 dark:text-white">SecureBuild Blog</h1>
            </div>
            <p className="text-xl text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
              Announcements and updates from the team at SecureBuild
            </p>
            <div className="inline-block bg-teal-100 dark:bg-teal-900/30 px-4 py-2 rounded-full">
              <span className="text-teal-700 dark:text-teal-300 font-medium text-sm">
                Latest from our security experts
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Blog Posts */}
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        {posts.length === 0 && (
          <div className="text-center py-16">
            <div className="mx-auto w-24 h-24 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-6">
              <User className="w-12 h-12 text-gray-400" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">No posts yet</h3>
            <p className="text-gray-600 dark:text-gray-400">
              Check back soon for insights on secure software development!
            </p>
          </div>
        )}

        <div className="space-y-12">
          {posts.map((post, index) => (
            <article key={post.slug} className={`group ${index === 0 ? 'featured-post' : ''}`}>
              <Link href={`/blog/${post.slug}`} className="block">
                <div className={`
                  bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 
                  hover:shadow-lg hover:border-teal-200 dark:hover:border-teal-800 
                  transition-all duration-300 overflow-hidden
                  ${index === 0 ? 'lg:p-12 p-8' : 'p-8'}
                `}>
                  {/* Author Info */}
                  <div className="flex items-center gap-4 mb-6">
                    <div className="relative">
                      <Image
                        src={getAuthorAvatar(post.author || 'SecureBuild Team')}
                        alt={post.author || 'SecureBuild Team'}
                        width={48}
                        height={48}
                        className="rounded-full border-2 border-teal-100 dark:border-teal-900"
                      />
                      <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-teal-600 rounded-full border-2 border-white dark:border-gray-900"></div>
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-gray-900 dark:text-white text-sm">
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

                  {/* Content */}
                  <div className="space-y-4">
                    <h2 className={`
                      font-bold text-gray-900 dark:text-white group-hover:text-teal-700 dark:group-hover:text-teal-300 
                      transition-colors duration-200 leading-tight
                      ${index === 0 ? 'text-3xl lg:text-4xl' : 'text-2xl'}
                    `}>
                      {post.title}
                    </h2>
                    
                    {post.excerpt && (
                      <p className={`
                        text-gray-600 dark:text-gray-300 leading-relaxed
                        ${index === 0 ? 'text-lg' : 'text-base'}
                      `}>
                        {post.excerpt}
                      </p>
                    )}

                    {/* Tags/Categories */}
                    <div className="flex items-center gap-2 pt-4">
                      {Array.isArray(post.categories) ? post.categories.map((category: string, index: number) => (
                        <span key={index} className="inline-block px-3 py-1 bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 rounded-full text-xs font-medium">
                          {category}
                        </span>
                      )) : (
                        // Default categories if none specified
                        <>
                          <span className="inline-block px-3 py-1 bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 rounded-full text-xs font-medium">
                            Security
                          </span>
                          <span className="inline-block px-3 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-xs font-medium">
                            DevSecOps
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Read More Arrow */}
                  <div className="flex items-center gap-2 mt-6 text-teal-600 dark:text-teal-400 font-medium group-hover:gap-3 transition-all duration-200">
                    <span>Read full article</span>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                  </div>
                </div>
              </Link>
            </article>
          ))}
        </div>

        {/* Newsletter Signup (Optional) */}
        {posts.length > 0 && (
          <div className="mt-16 bg-linear-to-r from-teal-50 to-blue-50 dark:from-teal-900/20 dark:to-blue-900/20 rounded-2xl p-8 text-center border border-teal-100 dark:border-teal-800">
            <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              Stay Updated with SecureBuild
            </h3>
            <p className="text-gray-600 dark:text-gray-300 mb-6 max-w-2xl mx-auto">
              Get the latest insights on secure software development, DevSecOps best practices, and platform updates delivered to your inbox.
            </p>
            <Link 
              href="/partner" 
              className="inline-flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
            >
              Partner With Us
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
          </div>
        )}
      </div>
    </div>
  )
} 