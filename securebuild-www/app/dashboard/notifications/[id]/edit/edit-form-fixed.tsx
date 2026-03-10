"use client"

import React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { ArrowLeft } from 'lucide-react';
import { NotificationWithImage } from '@/lib/types/notification';


interface EditNotificationFormProps {
  notification: NotificationWithImage;
}

export default function EditNotificationForm({ notification }: EditNotificationFormProps) {
  const router = useRouter();


  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="flex items-center gap-4 mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <h1 className="text-2xl font-bold">Edit Notification</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Configuration Form */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
              <CardDescription>
                Update your notification settings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <form className="space-y-6">
                {/* Image Display (read-only) */}
                <div className="space-y-2">
                  <Label>Image</Label>
                  <div className="p-3 bg-gray-50 rounded-lg border">
                    <span className="font-mono text-sm">{notification.image.name}</span>
                    <p className="text-xs text-gray-500 mt-1">Image cannot be changed. Create a new notification for different images.</p>
                  </div>
                </div>

                {/* Rest of the form would go here... */}
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
