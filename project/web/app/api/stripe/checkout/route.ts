import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { stripe, STRIPE_PRICE_IDS } from "@/lib/stripe";
import { z } from "zod";

const checkoutSchema = z.object({
  priceId: z.enum(["PRO_MONTHLY", "PRO_YEARLY"]),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const priceId = STRIPE_PRICE_IDS[parsed.data.priceId];

  let sub = await prisma.subscription.findUnique({ where: { userId: session.user.id } });

  let customerId = sub?.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: session.user.email ?? undefined,
      metadata: { userId: session.user.id },
    });
    customerId = customer.id;
    sub = await prisma.subscription.upsert({
      where: { userId: session.user.id },
      create: { userId: session.user.id, stripeCustomerId: customerId, plan: "FREE", status: "NONE" },
      update: { stripeCustomerId: customerId },
    });
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${process.env.NEXTAUTH_URL}/dashboard/billing?success=true`,
    cancel_url: `${process.env.NEXTAUTH_URL}/dashboard/billing?canceled=true`,
    subscription_data: { metadata: { userId: session.user.id } },
    allow_promotion_codes: true,
  });

  return NextResponse.json({ url: checkoutSession.url });
}
