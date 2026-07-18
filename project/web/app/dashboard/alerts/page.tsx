import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listStrategies } from "@/lib/strategies/registry";
import { AlertsManager } from "@/components/alerts/alerts-manager";

export default async function AlertsPage() {
  const session = await getServerSession(authOptions);
  const [alerts, watchlist, strategies] = await Promise.all([
    prisma.scoreAlert.findMany({ where: { userId: session!.user.id, active: true }, include: { company: true }, orderBy: { createdAt: "desc" } }),
    prisma.watchlistItem.findMany({ where: { userId: session!.user.id }, include: { company: true }, orderBy: { company: { ticker: "asc" } } }),
    Promise.resolve(listStrategies()),
  ]);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-display text-2xl">Score Alerts</h1>
        <p className="text-sm text-muted-foreground">Get notified when a company's strategy score changes beyond your thresholds.</p>
      </div>
      <AlertsManager
        initialAlerts={alerts.map(a => ({ id: a.id, companyId: a.companyId, ticker: a.company.ticker, strategySlug: a.strategySlug, condition: a.condition, threshold: a.threshold, notifyEmail: a.notifyEmail, createdAt: a.createdAt.toISOString() }))}
        companies={watchlist.map(w => ({ id: w.company.id, ticker: w.company.ticker, name: w.company.name }))}
        strategies={strategies.map(s => ({ slug: s.slug, name: s.name }))}
      />
    </div>
  );
}
