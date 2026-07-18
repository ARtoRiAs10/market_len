import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sub = await prisma.subscription.findUnique({ where: { userId: session.user.id } });
  if (!sub?.stripeCustomerId) {
    return NextResponse.json({ error: "No billing account found yet. Subscribe to a plan first." }, { status: 404 });
  }

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${process.env.NEXTAUTH_URL}/dashboard/billing`,
  });

  return NextResponse.json({ url: portalSession.url });
}
