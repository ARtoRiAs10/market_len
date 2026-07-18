import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe, STRIPE_PRICE_IDS } from "@/lib/stripe";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { PlanTier, SubscriptionStatus } from "@prisma/client";

export const runtime = "nodejs";

function mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "active": return "ACTIVE";
    case "trialing": return "TRIALING";
    case "past_due": return "PAST_DUE";
    case "canceled": return "CANCELED";
    case "incomplete": return "INCOMPLETE";
    case "incomplete_expired": return "CANCELED";
    case "unpaid": return "UNPAID";
    default: return "NONE";
  }
}

function mapPriceToPlan(priceId: string | undefined): PlanTier {
  if (!priceId) return "FREE";
  if (priceId === STRIPE_PRICE_IDS.PRO_MONTHLY || priceId === STRIPE_PRICE_IDS.PRO_YEARLY) return "PRO";
  if (priceId === STRIPE_PRICE_IDS.ENTERPRISE_MONTHLY) return "ENTERPRISE";
  return "FREE";
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    console.error("[stripe webhook] signature verification failed:", err.message);
    return NextResponse.json({ error: `Webhook signature verification failed` }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const checkoutSession = event.data.object as Stripe.Checkout.Session;
        if (checkoutSession.mode === "subscription" && checkoutSession.subscription) {
          const subscription = await stripe.subscriptions.retrieve(checkoutSession.subscription as string);
          await syncSubscription(subscription);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await syncSubscription(subscription);
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.customer) {
          await prisma.subscription.updateMany({
            where: { stripeCustomerId: invoice.customer as string },
            data: { status: "PAST_DUE" },
          });
        }
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error("[stripe webhook] handler error:", err);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function syncSubscription(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;
  const priceId = subscription.items.data[0]?.price.id;
  const plan = mapPriceToPlan(priceId);
  const status = mapStripeStatus(subscription.status);

  const existing = await prisma.subscription.findFirst({ where: { stripeCustomerId: customerId } });
  if (!existing) {
    console.warn(`[stripe webhook] No local subscription found for customer ${customerId}`);
    return;
  }

  await prisma.subscription.update({
    where: { id: existing.id },
    data: {
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      plan,
      status,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    },
  });

  await logAudit({
    userId: existing.userId,
    action: "billing.subscription_synced",
    metadata: { plan, status, subscriptionId: subscription.id },
  });
}
