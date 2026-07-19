import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const ACTION_COLORS: Record<string, "positive" | "negative" | "amber" | "outline"> = {
  "auth.login": "outline", "auth.signup": "positive",
  "strategy.run": "positive", "screener.run": "positive",
  "etl.start": "amber", "watchlist.add": "positive", "watchlist.remove": "negative",
  "billing.subscription_synced": "amber", "apikey.create": "positive", "apikey.revoke": "negative",
  "ai.openrouter": "outline", "api.v1.run": "outline",
};

export default async function AuditLogPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");
  const logs = await prisma.auditLog.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-display text-2xl">Audit Log</h1>
        <p className="text-sm text-muted-foreground">Full activity history for your account. Last 100 events.</p>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Activity ({logs.length} events)</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2 text-left font-medium">Time</th>
              <th className="px-4 py-2 text-left font-medium">Action</th>
              <th className="px-4 py-2 text-left font-medium">Details</th>
            </tr></thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} className="border-b last:border-0 hover:bg-secondary/20">
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={ACTION_COLORS[log.action] ?? "outline"} className="font-mono text-[10px]">{log.action}</Badge>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground max-w-xs truncate">
                    {log.metadata ? JSON.stringify(log.metadata).slice(1, -1).replace(/"/g, "").slice(0, 80) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">No activity yet.</div>}
        </CardContent>
      </Card>
    </div>
  );
}
