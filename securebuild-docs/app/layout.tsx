import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { Footer, Layout, Navbar } from 'nextra-theme-docs'
import { Head } from 'nextra/components'
import { getPageMap } from 'nextra/page-map'
import 'nextra-theme-docs/style.css'
import '../styles/globals.css'
import { PackageCountProvider } from '../lib/context/PackageCountContext'
import { SearchWrapper } from '../components/SearchWrapper'

export const metadata: Metadata = {
  title: {
    default: 'SecureBuild Docs',
    template: '%s | SecureBuild Docs'
  },
  description: 'SecureBuild Documentation',
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
}

const navbar = (
  <Navbar
    logo={<span>SecureBuild Docs</span>}
  />
)

const footer = (
  <Footer>
    SecureBuild Documentation
  </Footer>
)

export default async function RootLayout({ children }: { children: ReactNode }) {
  const pageMap = await getPageMap()

  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head />
      <body>
        <PackageCountProvider packageCount={null}>
          <Layout
            navbar={navbar}
            footer={footer}
            pageMap={pageMap}
            editLink={null}
            feedback={{ content: null }}
            search={<SearchWrapper />}
            sidebar={{
              defaultMenuCollapseLevel: 1
            }}
          >
            {children}
          </Layout>
        </PackageCountProvider>
      </body>
    </html>
  )
}
