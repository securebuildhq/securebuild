"use client"

import { useState } from "react"
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

interface Pipeline {
  id: number
  name: string
  repository: string
  type: string
  lastEdited: string
  lastExecution: string
  status: string
  successRate: number
  executionHistory: {
    date: string
    success: boolean
    duration: number
    idle: number
  }[]
}

interface PipelineDetailChartsProps {
  pipeline: Pipeline
}

export function PipelineDetailCharts({ pipeline: pkg }: PipelineDetailChartsProps) {
  const [activeTab, setActiveTab] = useState<"performance" | "success" | "frequency">("performance")

  // Transform data for the charts
  const chartData = pkg.executionHistory.map((item) => ({
    date: item.date,
    duration: item.duration,
    idle: item.idle / 3600, // Convert to hours for better visualization
    success: item.success ? 1 : 0,
    status: item.success ? "Success" : "Failed",
  }))

  // Custom tooltip formatter
  const tooltipFormatter = (value: string | number | (string | number)[] | undefined, name: string | number | undefined) => {
    if (value === undefined) return ["-", name ?? ""]
    const numValue = typeof value === 'number' ? value : (Array.isArray(value) ? Number(value[0]) : Number(value))
    if (name === "duration") return [numValue, "Duration (seconds)"]
    if (name === "idle") return [numValue.toFixed(1), "Idle Time (hours)"]
    if (name === "success") return [numValue === 1 ? "Success" : "Failed", "Status"]
    return [numValue, name ?? ""]
  }

  // Mock frequency data
  const frequencyData = [
    { date: "2023-01-01", count: 5 },
    { date: "2023-02-01", count: 3 },
    { date: "2023-03-01", count: 7 },
    { date: "2023-04-01", count: 2 },
    { date: "2023-05-01", count: 4 },
  ]

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
              <LineChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
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
              <BarChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip formatter={tooltipFormatter} />
                <Legend />
                <Bar dataKey="success" name="Success" fill="hsl(var(--success))" />
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
