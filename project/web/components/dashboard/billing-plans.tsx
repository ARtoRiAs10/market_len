"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { PLAN_LIMITS } from "@/lib/plan-limits";
import { PlanTier } from "@prisma/client";
import { Loader2 } from "lucide-react";

interface RazorpayOptions {
  key: string;
  subscription_id: string;
  name: string;
  description: string;
  prefill?: { email?: string; name?: string };
  theme?: { color?: string };
  handler: (response: RazorpayVerificationResponse) => void;
  modal?: { ondismiss?: () => void };
}

interface RazorpayVerificationResponse {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void };
  }
}

let razorpayScriptPromise: Promise<void> | null = null;

function loadRazorpayScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (razorpayScriptPromise) return razorpayScriptPromise;
  razorpayScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      razorpayScriptPromise = null;
      reject(new Error("Could not load Razorpay Checkout"));
    };
    document.body.appendChild(script);
  });
  return razorpayScriptPromise;
}

export function BillingPlans({
  currentPlan,
  hasRazorpaySubscription,
}: {
  currentPlan: PlanTier;
  hasRazorpaySubscription: boolean;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState<string | null>(null);

  async function checkout(priceKey: "PRO_MONTHLY" | "PRO_YEARLY") {
    setLoading(priceKey);
    try {
      const res = await fetch("/api/razorpay/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: priceKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Couldn't start checkout", description: data.error, variant: "destructive" as any });
        return;
      }

      await loadRazorpayScript();
      const Razorpay = window.Razorpay;
      if (!Razorpay) throw new Error("Razorpay Checkout failed to load");

      const rzp = new Razorpay({
        key: data.keyId,
        subscription_id: data.subscriptionId,
        name: "MarketLens",
        description: priceKey === "PRO_YEARLY" ? "Pro — yearly" : "Pro — monthly",
        theme: { color: "#C99A2E" },
        handler: async (response) => {
          try {
            const verify = await fetch("/api/razorpay/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(response),
            });
            const result = await verify.json();
            if (!verify.ok) throw new Error(result.error ?? "Verification failed");
            window.location.href = "/dashboard/billing?success=true";
          } catch (err: any) {
            toast({ title: "Payment verification failed", description: err?.message, variant: "destructive" as any });
          }
        },
        modal: {
          ondismiss: () => setLoading(null),
        },
      });
      rzp.open();
    } catch (err: any) {
      toast({ title: "Couldn't start checkout", description: err?.message, variant: "destructive" as any });
      setLoading(null);
    }
  }

  async function cancelSubscription() {
    setLoading("cancel");
    try {
      const res = await fetch("/api/razorpay/cancel", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Couldn't cancel", description: data.error, variant: "destructive" as any });
        return;
      }
      toast({ title: "Subscription cancelled", description: "Your plan will return to Free." });
      window.location.reload();
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Upgrade to Pro</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="font-mono text-2xl">${PLAN_LIMITS.PRO.priceMonthly}<span className="text-sm text-muted-foreground">/mo</span></p>
          <div className="flex flex-wrap gap-2">
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
        <CardHeader><CardTitle className="text-base">Manage subscription</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Payments are processed securely by Razorpay. Cancel anytime; access continues until the end of the paid period.
          </p>
          <Button variant="outline" onClick={cancelSubscription} disabled={!!loading || !hasRazorpaySubscription}>
            {loading === "cancel" && <Loader2 className="h-4 w-4 animate-spin" />}
            Cancel subscription
          </Button>
          {!hasRazorpaySubscription && <p className="text-xs text-muted-foreground">No active Razorpay subscription found.</p>}
        </CardContent>
      </Card>
    </div>
  );
}