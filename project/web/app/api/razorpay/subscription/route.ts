import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  razorpay,
  razorpayConfigured,
  getRazorpayKeyId,
  getRazorpayPlanId,
  type RazorpayPlanKey,
} from "@/lib/razorpay";
import { z } from "zod";

const schema = z.object({
  plan: z.enum(["PRO_MONTHLY", "PRO_YEARLY", "ENTERPRISE_MONTHLY"]),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!razorpayConfigured()) {
    return NextResponse.json({ error: "Razorpay is not configured on this deployment." }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid plan" }, { status: 400 });

  const planKey = parsed.data.plan as RazorpayPlanKey;
  const planId = getRazorpayPlanId(planKey);
  if (!planId) {
    return NextResponse.json({ error: `Razorpay plan is not configured for ${planKey}.` }, { status: 503 });
  }

  try {
    const subscription = await razorpay.subscriptions.create({
      plan_id: planId,
      total_count: planKey === "PRO_YEARLY" ? 1 : 12,
      customer_notify: 1,
      notes: { userId: session.user.id, planKey },
    });

    await prisma.subscription.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        plan: "FREE",
        status: "INCOMPLETE",
        razorpaySubscriptionId: subscription.id,
        razorpayPlanId: planId,
      },
      update: {
        status: "INCOMPLETE",
        razorpaySubscriptionId: subscription.id,
        razorpayPlanId: planId,
      },
    });

    return NextResponse.json({
      keyId: getRazorpayKeyId(),
      subscriptionId: subscription.id,
      planKey,
    });
  } catch (err: any) {
    console.error("[razorpay] create subscription failed:", err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? "Could not create Razorpay subscription." }, { status: 502 });
  }
}