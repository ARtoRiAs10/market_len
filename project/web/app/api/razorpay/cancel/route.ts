import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { razorpay, razorpayConfigured } from "@/lib/razorpay";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!razorpayConfigured()) {
    return NextResponse.json({ error: "Razorpay is not configured on this deployment." }, { status: 503 });
  }

  const sub = await prisma.subscription.findUnique({ where: { userId: session.user.id } });
  if (!sub?.razorpaySubscriptionId) {
    return NextResponse.json({ error: "No Razorpay subscription found." }, { status: 404 });
  }

  try {
    await razorpay.subscriptions.cancel(sub.razorpaySubscriptionId, false);
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: "CANCELED", cancelAtPeriodEnd: false },
    });
    return NextResponse.json({ cancelled: true });
  } catch (err: any) {
    console.error("[razorpay] cancel failed:", err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? "Could not cancel subscription." }, { status: 502 });
  }
}