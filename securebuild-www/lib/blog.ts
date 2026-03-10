import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'

const postsDirectory = path.join(process.cwd(), 'posts')

export interface BlogPost {
  slug: string
  title: string
  date?: string
  author?: string
  excerpt?: string
  content: string
  readingTime?: number
  [key: string]: unknown
}

// Calculate reading time (average 200 words per minute)
function calculateReadingTime(content: string): number {
  const wordsPerMinute = 200
  const wordCount = content.split(/\s+/).length
  const readingTime = Math.ceil(wordCount / wordsPerMinute)
  return readingTime
}

// Generate author avatar URL
export function getAuthorAvatar(authorName: string): string {
  // Use Grant Miller's photo for Grant Miller
  if (authorName === 'Grant Miller') {
    return '/images/glm.jpg'
  }
  
  // Use SecureBuild logo for SecureBuild Team
  if (authorName === 'SecureBuild Team') {
    return '/sb-192x192.png'
  }
  
  // Fallback to DiceBear for other authors
  const encodedName = encodeURIComponent(authorName)
  return `https://api.dicebear.com/7.x/initials/svg?seed=${encodedName}&backgroundColor=0d9488&textColor=ffffff`
}

export async function getAllPosts(): Promise<BlogPost[]> {
  // Create posts directory if it doesn't exist
  if (!fs.existsSync(postsDirectory)) {
    fs.mkdirSync(postsDirectory, { recursive: true })
    return []
  }

  const fileNames = fs.readdirSync(postsDirectory)
  const allPostsData = fileNames
    .filter((fileName) => fileName.endsWith('.md'))
    .map((fileName) => {
      const slug = fileName.replace(/\.md$/, '')
      const fullPath = path.join(postsDirectory, fileName)
      const fileContents = fs.readFileSync(fullPath, 'utf8')
      const { data, content } = matter(fileContents)

      return {
        slug,
        content,
        title: data.title || slug,
        date: data.date,
        author: data.author || 'Grant Miller',
        excerpt: data.excerpt,
        readingTime: calculateReadingTime(content),
        ...data,
      } as BlogPost
    })

  // Sort posts by date (newest first)
  return allPostsData.sort((a, b) => {
    if (!a.date && !b.date) return 0
    if (!a.date) return 1
    if (!b.date) return -1
    return new Date(b.date).getTime() - new Date(a.date).getTime()
  })
}

export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
  const fullPath = path.join(postsDirectory, `${slug}.md`)
  
  if (!fs.existsSync(fullPath)) {
    return null
  }

  const fileContents = fs.readFileSync(fullPath, 'utf8')
  const { data, content } = matter(fileContents)

  return {
    slug,
    content,
    title: data.title || slug,
    date: data.date,
    author: data.author || 'Grant Miller',
    excerpt: data.excerpt,
    readingTime: calculateReadingTime(content),
    ...data,
  } as BlogPost
} 