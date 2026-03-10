"use client"

import { useSession } from "@/app/hooks/use-session"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function BuildsPage() {
  const { session, isSessionLoading } = useSession()
  const user = session?.user

  if (isSessionLoading || !session || !user) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <div>Loading builds...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
    <div className="container mx-auto">
      <h1 className="text-3xl font-bold mb-6">Builds</h1>
      <Card>
        <CardHeader>
          <CardTitle>Image Builds</CardTitle>
          <CardDescription>
            View build details from the Images page by clicking on a specific image and going to the Builds tab.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            This page shows individual build details. To view builds for a specific image, navigate to the Images page 
            and select the Builds tab for the image you're interested in.
          </p>
        </CardContent>
      </Card>
    </div>
    </div>
  )
} 