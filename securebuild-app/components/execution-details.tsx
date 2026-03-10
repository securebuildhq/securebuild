"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Download } from "lucide-react"

interface ExecutionDetailsProps {
  execution: {
    id: number
    packageName: string
    status: string
    createdAt: string
    completedAt: string | null
    version?: string
    commit?: string
    cause?: string
    causeId?: string
    logs?: string[]
    artifacts?: {
      name: string
      size: string
      type: string
    }[]
    testResults?: {
      total: number
      passed: number
      failed: number
      skipped: number
    }
  }
}

export function ExecutionDetails({ execution }: ExecutionDetailsProps) {
  const [activeTab, setActiveTab] = useState("logs")

  // Calculate duration
  const startDate = new Date(execution.createdAt)
  const endDate = execution.completedAt ? new Date(execution.completedAt) : new Date()
  const durationMs = endDate.getTime() - startDate.getTime()
  const durationMinutes = Math.floor(durationMs / 60000)
  const durationSeconds = Math.floor((durationMs % 60000) / 1000)
  const durationFormatted = `${durationMinutes}m ${durationSeconds}s`

  return (
    <div className="space-y-6">
      <div className="grid gap-6 grid-cols-1 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Package</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-medium">{execution.packageName}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge
              variant={
                execution.status === "completed" || execution.status === "success"
                  ? "success"
                  : execution.status === "testing"
                    ? "warning"
                    : execution.status === "in_progress" || execution.status === "building" || execution.status === "publishing"
                      ? "default"
                      : "destructive"
              }
            >
              {execution.status}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Duration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-medium">{durationFormatted}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 grid-cols-1 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Version</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-medium">{execution.version || "-"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Commit</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-medium">{execution.commit || "-"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Triggered By</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-medium">{execution.cause || "manual"}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
          <TabsTrigger value="tests">Test Results</TabsTrigger>
        </TabsList>
        <TabsContent value="logs">
          <Card>
            <CardHeader>
              <CardTitle>Build Logs</CardTitle>
              <CardDescription>Output from the build process</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="bg-black text-green-400 font-mono text-sm p-4 rounded-md overflow-auto max-h-[500px]">
                {execution.logs ? (
                  execution.logs.map((log, index) => (
                    <div key={index} className="whitespace-pre-wrap">
                      <span className="text-gray-500">$</span> {log}
                    </div>
                  ))
                ) : (
                  <div>No logs available</div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="artifacts">
          <Card>
            <CardHeader>
              <CardTitle>Build Artifacts</CardTitle>
              <CardDescription>Files generated during the build</CardDescription>
            </CardHeader>
            <CardContent>
              {execution.artifacts && execution.artifacts.length > 0 ? (
                <div className="space-y-4">
                  {execution.artifacts.map((artifact, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between border-b pb-4 last:border-0 last:pb-0"
                    >
                      <div>
                        <div className="font-medium">{artifact.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {artifact.type} • {artifact.size}
                        </div>
                      </div>
                      <Button variant="outline" size="sm">
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6">
                  <p className="text-muted-foreground">No artifacts available</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="tests">
          <Card>
            <CardHeader>
              <CardTitle>Test Results</CardTitle>
              <CardDescription>Results from test execution</CardDescription>
            </CardHeader>
            <CardContent>
              {execution.testResults ? (
                <div className="space-y-6">
                  <div className="grid grid-cols-4 gap-4">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Total</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">{execution.testResults.total}</div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Passed</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold text-green-500">{execution.testResults.passed}</div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Failed</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold text-red-500">{execution.testResults.failed}</div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Skipped</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold text-yellow-500">{execution.testResults.skipped}</div>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="h-4 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500"
                      style={{
                        width: `${(execution.testResults.passed / execution.testResults.total) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="text-center py-6">
                  <p className="text-muted-foreground">No test results available</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
