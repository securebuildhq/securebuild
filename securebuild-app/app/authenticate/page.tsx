import { Suspense } from 'react'
import AuthenticateClient from './AuthenticateClient'

export default function AuthenticatePage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    }>
      <AuthenticateClient />
    </Suspense>
  )
}