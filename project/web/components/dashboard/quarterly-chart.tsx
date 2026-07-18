"use client";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

interface Point {
  label: string;
  revenue: number | null;
  netIncome: number | null;
}

export function QuarterlyChart({ data }: { data: Point[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fontFamily: "var(--font-jbmono)" }} stroke="hsl(var(--muted-foreground))" />
          <YAxis
            tick={{ fontSize: 11, fontFamily: "var(--font-jbmono)" }}
            stroke="hsl(var(--muted-foreground))"
            tickFormatter={(v) => `$${(v / 1_000_000).toFixed(0)}M`}
          />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 6,
              fontSize: 12,
            }}
            formatter={(value: number) => `$${(value / 1_000_000).toFixed(1)}M`}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="revenue" stroke="hsl(var(--signal-positive))" strokeWidth={2} dot={false} name="Revenue" />
          <Line type="monotone" dataKey="netIncome" stroke="hsl(var(--signal-amber))" strokeWidth={2} dot={false} name="Net Income" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
