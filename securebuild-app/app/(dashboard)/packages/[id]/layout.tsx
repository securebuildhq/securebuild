import { PackageProvider } from "./package-context"

export default function PackageDetailLayout({ children }: { children: React.ReactNode }) {
  return (
    <PackageProvider>
      {children}
    </PackageProvider>
  )
}
