import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { mapRazorpayStatus, planTierFromRazorpayPlanId } from "@/lib/razorpay";
import crypto from "crypto";

export const runtime = "nodejs";

function signaturesMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Razorpay webhook is not configured." }, { status: 503 });
  }

  const body = await req.text();
  const signature = req.headers.get("x-razorpay-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing x-razorpay-signature header" }, { status: 400 });
  }

  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  if (!signaturesMatch(expected, signature)) {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const subscription = event?.payload?.subscription?.entity;
  if (!subscription?.id) {
    return NextResponse.json({ received: true, ignored: true });
  }

  try {
    await prisma.subscription.updateMany({
      where: { razorpaySubscriptionId: subscription.id },
      data: {
        plan: subscription.plan_id ? planTierFromRazorpayPlanId(subscription.plan_id) : undefined,
        razorpayPlanId: subscription.plan_id ?? undefined,
        status: mapRazorpayStatus(subscription.status),
        currentPeriodEnd: subscription.current_end ? new Date(subscription.current_end * 1000) : null,
        cancelAtPeriodEnd: Boolean(subscription.cancel_at_cycle_end),
      },
    });
  } catch (err: any) {
    console.error("[razorpay webhook] handler error:", err?.message ?? err);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true, event: event.event });
}