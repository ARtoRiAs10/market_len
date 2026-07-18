import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";

const createSchema = z.object({
  companyId: z.string(),
  strategySlug: z.string(),
  condition: z.enum(["SCORE_ABOVE", "SCORE_BELOW", "SCORE_CHANGE", "VERDICT_CHANGE"]),
  threshold: z.number().optional(),
  changeMagnitude: z.number().optional(),
  notifyEmail: z.boolean().default(true),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const alerts = await prisma.scoreAlert.findMany({
    where: { userId: session.user.id, active: true },
    include: { company: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ alerts });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });
  const existing = await prisma.scoreAlert.count({ where: { userId: session.user.id, active: true } });
  if (existing >= 20) return NextResponse.json({ error: "Max 20 alerts per account." }, { status: 403 });
  const alert = await prisma.scoreAlert.create({
    data: { userId: session.user.id, ...parsed.data },
    include: { company: true },
  });
  return NextResponse.json({ alert });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { alertId } = await req.json().catch(() => ({}));
  if (!alertId) return NextResponse.json({ error: "alertId required" }, { status: 400 });
  await prisma.scoreAlert.updateMany({ where: { id: alertId, userId: session.user.id }, data: { active: false } });
  return NextResponse.json({ success: true });
}
