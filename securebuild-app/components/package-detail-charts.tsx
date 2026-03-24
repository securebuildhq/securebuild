"use client"

import { useState } from "react"
import type { TooltipProps } from "recharts"
import { Button } from "@/components/ui/button"
import {
  Line,
  LineChart,
  Bar,
  BarChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts"

interface PackageDetailChartsProps {
  data?: {
    buildDurations?: Array<{ date: string; duration: number }>
    buildSuccesses?: Array<{ date: string; success: boolean }>
    buildFrequency?: Array<{ date: string; count: number }>
  }
}

export function PackageDetailCharts({ data }: PackageDetailChartsProps) {
  const [activeTab, setActiveTab] = useState<"performance" | "success" | "frequency">("performance")

  // Sample data if no data is provided
  const buildDurations = data?.buildDurations || [
    { date: "2023-05-01", duration: 320 },
    { date: "2023-05-05", duration: 310 },
    { date: "2023-05-10", duration: 400 },
    { date: "2023-05-15", duration: 290 },
    { date: "2023-05-20", duration: 300 },
  ]

  const buildSuccesses = data?.buildSuccesses || [
    { date: "2023-05-01", success: true },
    { date: "2023-05-05", success: true },
    { date: "2023-05-10", success: false },
    { date: "2023-05-15", success: true },
    { date: "2023-05-20", success: true },
  ]

  const buildFrequency = data?.buildFrequency || [
    { date: "2023-05-01", count: 2 },
    { date: "2023-05-05", count: 1 },
    { date: "2023-05-10", count: 3 },
    { date: "2023-05-15", count: 0 },
    { date: "2023-05-20", count: 4 },
  ]

  // Transform data for the charts
  const performanceData = buildDurations.map((item) => ({
    date: item.date,
    duration: item.duration,
  }))

  const successData = buildSuccesses.map((item) => ({
    date: item.date,
    success: item.success ? 1 : 0,
    failure: item.success ? 0 : 1,
  }))

  const frequencyData = buildFrequency

  const tooltipFormatter: NonNullable<TooltipProps["formatter"]> = (value, name) => {
    if (value === undefined) return ["-", name ?? ""]
    const numValue =
      typeof value === "number" ? value : Array.isArray(value) ? Number(value[0]) : Number(value)
    if (name === "duration") return [numValue, "Duration (seconds)"]
    if (name === "success") return [numValue === 1 ? "Success" : "Failed", "Status"]
    if (name === "failure") return [numValue === 1 ? "Failed" : "Success", "Status"]
    if (name === "count") return [numValue, "Executions"]
    return [numValue, name ?? ""]
  }

  return (
    <div className="w-full">
      <div className="flex space-x-2 mb-4">
        <Button
          variant={activeTab === "performance" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveTab("performance")}
        >
          Performance
        </Button>
        <Button
          variant={activeTab === "success" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveTab("success")}
        >
          Success Rate
        </Button>
        <Button
          variant={activeTab === "frequency" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveTab("frequency")}
        >
          Build Frequency
        </Button>
      </div>

      {activeTab === "performance" && (
        <div className="border rounded-md p-4">
          <h3 className="text-lg font-medium mb-2">Build Duration</h3>
          <p className="text-sm text-muted-foreground mb-4">Duration of each build execution in seconds</p>
          <div style={{ height: "300px", width: "100%" }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={performanceData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip formatter={tooltipFormatter} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="duration"
                  name="Duration"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {activeTab === "success" && (
        <div className="border rounded-md p-4">
          <h3 className="text-lg font-medium mb-2">Build Success Rate</h3>
          <p className="text-sm text-muted-foreground mb-4">Success and failure of each build execution</p>
          <div style={{ height: "300px", width: "100%" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={successData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip formatter={tooltipFormatter} />
                <Legend />
                <Bar dataKey="success" name="Success" fill="hsl(var(--success))" stackId="a" />
                <Bar dataKey="failure" name="Failed" fill="hsl(var(--destructive))" stackId="a" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {activeTab === "frequency" && (
        <div className="border rounded-md p-4">
          <h3 className="text-lg font-medium mb-2">Build Frequency</h3>
          <p className="text-sm text-muted-foreground mb-4">Number of builds per day</p>
          <div style={{ height: "300px", width: "100%" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={frequencyData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis allowDecimals={false} />
                <Tooltip formatter={tooltipFormatter} />
                <Legend />
                <Bar dataKey="count" name="Builds" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
