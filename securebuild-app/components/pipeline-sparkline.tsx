"use client"

import { Line, LineChart, ResponsiveContainer } from "recharts"

interface ExecutionHistoryItem {
  date: string
  success: boolean
  duration: number
  idle: number
}

interface PackageSparklineProps {
  data: ExecutionHistoryItem[]
}

export function PackageSparkline({ data }: PackageSparklineProps) {
  // Transform data for the chart
  const chartData = data.map((item) => ({
    date: item.date,
    duration: item.duration,
    success: item.success ? 1 : 0,
  }))

  return (
    <div className="h-10 w-24">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <Line type="monotone" dataKey="duration" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} />
          <Line type="monotone" dataKey="success" stroke="hsl(var(--success))" strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
