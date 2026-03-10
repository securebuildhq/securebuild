"use client"

import { useSession } from "@/app/hooks/use-session"


export default function SubscriptionsPage() {
  const { session, isSessionLoading } = useSession()
  const user = session?.user

  if (isSessionLoading || !session || !user) {
    return <div>Loading...</div>
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Subscriptions</h1>
      <p className="text-slate-600 dark:text-slate-400">
        Subscription management page - coming soon
      </p>
    </div>
  )
}
