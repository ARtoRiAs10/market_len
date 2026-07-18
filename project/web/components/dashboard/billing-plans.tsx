"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { PLAN_LIMITS } from "@/lib/plan-limits";
import { PlanTier } from "@prisma/client";
import { Loader2 } from "lucide-react";

export function BillingPlans({ currentPlan, hasStripeCustomer }: { currentPlan: PlanTier; hasStripeCustomer: boolean }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState<string | null>(null);

  async function checkout(priceKey: "PRO_MONTHLY" | "PRO_YEARLY") {
    setLoading(priceKey);
    const res = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priceId: priceKey }),
    });
    const data = await res.json();
    setLoading(null);
    if (!res.ok) {
      toast({ title: "Couldn't start checkout", description: data.error, variant: "destructive" as any });
      return;
    }
    window.location.href = data.url;
  }

  async function openPortal() {
    setLoading("portal");
    const res = await fetch("/api/stripe/portal", { method: "POST" });
    const data = await res.json();
    setLoading(null);
    if (!res.ok) {
      toast({ title: "Couldn't open billing portal", description: data.error, variant: "destructive" as any });
      return;
    }
    window.location.href = data.url;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Upgrade to Pro</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="font-mono text-2xl">${PLAN_LIMITS.PRO.priceMonthly}<span className="text-sm text-muted-foreground">/mo</span></p>
          <div className="flex gap-2">
            <Button onClick={() => checkout("PRO_MONTHLY")} disabled={!!loading || currentPlan !== "FREE"}>
              {loading === "PRO_MONTHLY" && <Loader2 className="h-4 w-4 animate-spin" />}
              Monthly
            </Button>
            <Button variant="outline" onClick={() => checkout("PRO_YEARLY")} disabled={!!loading || currentPlan !== "FREE"}>
              {loading === "PRO_YEARLY" && <Loader2 className="h-4 w-4 animate-spin" />}
              Yearly (save ~20%)
            </Button>
          </div>
          {currentPlan !== "FREE" && <p className="text-xs text-muted-foreground">You're already on a paid plan.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Manage billing</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Update payment method, view invoices, or cancel your plan.</p>
          <Button variant="outline" onClick={openPortal} disabled={!!loading || !hasStripeCustomer}>
            {loading === "portal" && <Loader2 className="h-4 w-4 animate-spin" />}
            Open billing portal
          </Button>
          {!hasStripeCustomer && <p className="text-xs text-muted-foreground">Subscribe to a plan to unlock the billing portal.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
