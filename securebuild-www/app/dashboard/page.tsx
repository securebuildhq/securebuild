"use client"

import { Package, Download, Users, CreditCard } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { useSession } from "../hooks/use-session"
import { useEffect } from "react"
import { Activity, ImageUsage } from "@/lib/types/activity"
import { useState } from "react"
import { listTeamRecentActivityAction } from "@/lib/team/actions/list-recent-activity"
import { timeAgo } from "@/lib/time-ago"
import { listRecentUsageAction } from "@/lib/team/actions/list-recent-usage"
import Link from "next/link"

export default function DashboardPage() {
  const { session } = useSession();

  const [activityLog, setActivityLog] = useState<Activity[]>([]);
  const [imageUsage, setImageUsage] = useState<ImageUsage[]>([]);

  useEffect(() => {
    if (session) {
      listRecentUsageAction(session).then(setImageUsage);
    }
  }, [session]);

  useEffect(() => {
    if (session) {
      const fetcher = () => {
        listTeamRecentActivityAction(session).then(newActivities => {
          setActivityLog(prevLog => {
            const prevIds = new Set(prevLog.map(a => a.id));
            if (prevIds.size === 0) {
              return newActivities.map(a => ({ ...a, isNew: false })); // initial load
            }
            return newActivities.map(activity => ({
              ...activity,
              isNew: !prevIds.has(activity.id)
            }));
          });
        });
      };
      fetcher();
      const interval = setInterval(fetcher, 5000);
      return () => clearInterval(interval);
    }
  }, [session]);

  useEffect(() => {
    const newItems = activityLog.filter(a => a.isNew);
    if (newItems.length > 0) {
      const timer = setTimeout(() => {
        setActivityLog(currentLog =>
          currentLog.map(item => item.isNew ? { ...item, isNew: false } : item)
        );
      }, 2000); // Animation duration
      return () => clearTimeout(timer);
    }
  }, [activityLog]);

  const chartData = imageUsage
    .slice()
    .reverse()
    .map(usage => {
      const totalPulls = usage.pulls.reduce((sum, pull) => sum + Number(pull.pullCount || 0), 0);
      const day = new Date(usage.startDate).toLocaleDateString('en-US', { weekday: 'short' });
      return { day, totalPulls };
    });

  const maxPulls = Math.max(...chartData.map(d => d.totalPulls), 1);

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col gap-6">
        {/* Dashboard Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold">Dashboard</h1>
            <p className="text-muted-foreground">Overview of your SecureBuild platform</p>
          </div>
        </div>


        {/* Usage and Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-1 gap-4">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>Image Usage</CardTitle>
              <CardDescription>Daily downloads across your images</CardDescription>
            </CardHeader>
            <CardContent className="pb-2">
              <div className="h-[200px] flex items-end justify-between gap-2 pt-4">
                {chartData.map((data, index) => (
                  <div key={index} className="w-full h-full flex flex-col justify-end items-center gap-1">
                    <div className="group relative w-full flex-1 flex items-end">
                      <div
                        className="w-full bg-teal-500 rounded-t-md transition-all duration-300"
                        style={{ height: data.totalPulls > 0 ? `${(data.totalPulls / maxPulls) * 100}%` : '2px' }}
                      />
                      <div className="absolute bottom-full mb-2 w-max px-2 py-1 text-xs bg-gray-800 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none left-1/2 -translate-x-1/2">
                        {data.totalPulls} pulls
                      </div>
                    </div>
                    <span className="text-xs text-center text-muted-foreground">{data.day}</span>
                  </div>
                ))}
              </div>
            </CardContent>
            <CardFooter className="pt-0">

            </CardFooter>
          </Card>


        </div>

        {/* Quick Actions and Recent Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>Common tasks and shortcuts</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Button variant="outline" className="w-full justify-start">
                  <Package className="mr-2 h-4 w-4" />
                  <Link href="/dashboard/catalog">Subscribe To A New Image</Link>
                </Button>
                <Button variant="outline" className="w-full justify-start">
                  <Users className="mr-2 h-4 w-4" />
                  <Link href="/dashboard/settings/team/members">Invite Team Member</Link>
                </Button>
                <Button variant="outline" className="w-full justify-start">
                  <CreditCard className="mr-2 h-4 w-4" />
                  <Link href="/dashboard/settings/team/billing">Manage Subscriptions</Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>Latest actions across your account</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {activityLog.map((activity) => (
                  <div key={activity.id} className={`flex items-start gap-4 p-2 rounded-lg transition-colors duration-1000 ${activity.isNew ? 'bg-teal-100' : 'bg-transparent'}`}>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100">
                      <Download className="h-4 w-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        Pull of{" "}
                        <span className="font-semibold">
                          {activity.imageName}:{activity.imageTag}
                        </span>
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                        <span>{timeAgo(activity.createdAt)}</span>
                        <span>•</span>
                        <span>{activity.serviceAccountName}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
            <CardFooter>

            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  )
}
