import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAppUrl } from "@/lib/env";
import { stripe } from "@/lib/stripe";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Billing is not configured on this deployment." }, { status: 503 });
  }

  const sub = await prisma.subscription.findUnique({ where: { userId: session.user.id } });
  if (!sub?.stripeCustomerId) {
    return NextResponse.json({ error: "No billing account found yet. Subscribe to a plan first." }, { status: 404 });
  }

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${getAppUrl()}/dashboard/billing`,
  });

  return NextResponse.json({ url: portalSession.url });
}
