import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PLAN_LIMITS } from "@/lib/plan-limits";
import { BillingPlans } from "@/components/dashboard/billing-plans";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function fmt(d: Date) {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export default async function BillingPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");
  const sub = await prisma.subscription.findUnique({ where: { userId: session.user.id } });
  const plan = sub?.plan ?? "FREE";
  const limits = PLAN_LIMITS[plan];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="font-display text-2xl">Billing</h1>
        <p className="text-sm text-muted-foreground">Manage your subscription and view plan limits.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Current plan <Badge variant={plan === "FREE" ? "outline" : "amber"}>{limits.label}</Badge>
          </CardTitle>
          {sub?.currentPeriodEnd && (
            <CardDescription>
              {sub.cancelAtPeriodEnd ? "Cancels" : "Renews"} on {fmt(new Date(sub.currentPeriodEnd))}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            {limits.features.map((f) => (
              <li key={f} className="flex gap-2"><span className="text-signal-positive">—</span> {f}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <BillingPlans currentPlan={plan} hasRazorpaySubscription={!!sub?.razorpaySubscriptionId} />
    </div>
  );
}
