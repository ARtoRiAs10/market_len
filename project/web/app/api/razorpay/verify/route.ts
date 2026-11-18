import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { razorpay, razorpayConfigured, planTierFromRazorpayPlanId, mapRazorpayStatus } from "@/lib/razorpay";
import crypto from "crypto";
import { z } from "zod";

const schema = z.object({
  razorpay_payment_id: z.string().min(1),
  razorpay_subscription_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

function signaturesMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!razorpayConfigured() || !process.env.RAZORPAY_KEY_SECRET) {
    return NextResponse.json({ error: "Razorpay is not configured on this deployment." }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid Razorpay response" }, { status: 400 });

  const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = parsed.data;
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
    .digest("hex");

  if (!signaturesMatch(expected, razorpay_signature)) {
    return NextResponse.json({ error: "Invalid Razorpay signature" }, { status: 400 });
  }

  const local = await prisma.subscription.findUnique({ where: { razorpaySubscriptionId: razorpay_subscription_id } });
  if (!local || local.userId !== session.user.id) {
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
  }

  try {
    const remote = await razorpay.subscriptions.fetch(razorpay_subscription_id);
    await prisma.subscription.update({
      where: { id: local.id },
      data: {
        plan: planTierFromRazorpayPlanId(remote.plan_id),
        razorpayPlanId: remote.plan_id,
        status: mapRazorpayStatus(remote.status),
        currentPeriodEnd: remote.current_end ? new Date(remote.current_end * 1000) : null,
        cancelAtPeriodEnd: Boolean((remote as any).cancel_at_cycle_end),
      },
    });
  } catch (err: any) {
    console.error("[razorpay] fetch subscription after verify failed:", err?.message ?? err);
    // The signature is valid, so activate locally even if the fetch fails.
    await prisma.subscription.update({
      where: { id: local.id },
      data: { status: "ACTIVE", cancelAtPeriodEnd: false },
    });
  }

  return NextResponse.json({ verified: true });
}