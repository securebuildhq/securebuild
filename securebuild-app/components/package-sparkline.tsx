"use client"

import { Line, LineChart, ResponsiveContainer } from "recharts"

interface PackageSparklineProps {
  data?: Array<{ date: string; success: boolean; duration: number }>
}

export function PackageSparkline({ data = [] }: PackageSparklineProps) {
  // Create sample data if no data is provided
  const chartData =
    data.length > 0
      ? data.map((item) => ({
          date: item.date,
          duration: item.duration,
          success: item.success ? 1 : 0,
        }))
      : [
          { date: "1", duration: 300, success: 1 },
          { date: "2", duration: 280, success: 1 },
          { date: "3", duration: 320, success: 0 },
          { date: "4", duration: 290, success: 1 },
          { date: "5", duration: 310, success: 1 },
        ]

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
