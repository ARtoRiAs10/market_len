"use client";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils";
import { ArrowUpRight } from "lucide-react";

interface Row {
  ticker: string;
  name: string;
  sector: string | null;
  latestQuarter: string;
  revenue: string | null;
}

export function CompaniesTable({ rows }: { rows: Row[] }) {
  if (rows.length === 0) {
    return <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">No companies yet — add one above.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Ticker</th>
            <th className="py-2 pr-4 font-medium">Name</th>
            <th className="py-2 pr-4 font-medium">Sector</th>
            <th className="py-2 pr-4 font-medium">Latest quarter</th>
            <th className="py-2 pr-4 text-right font-medium">Revenue</th>
            <th className="py-2 pr-4" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ticker} className="border-b last:border-0 hover:bg-secondary/40">
              <td className="py-2.5 pr-4 font-mono font-medium">{r.ticker}</td>
              <td className="py-2.5 pr-4 text-muted-foreground">{r.name}</td>
              <td className="py-2.5 pr-4 text-muted-foreground">{r.sector ?? "—"}</td>
              <td className="py-2.5 pr-4 font-mono text-xs">{r.latestQuarter}</td>
              <td className="py-2.5 pr-4 text-right font-mono">{formatCurrency(r.revenue, { compact: true })}</td>
              <td className="py-2.5 pr-2 text-right">
                <Link href={`/dashboard/companies/${r.ticker}`} className="inline-flex text-muted-foreground hover:text-foreground">
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
