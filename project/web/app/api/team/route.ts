import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getUserPlan } from "@/lib/plan-limits";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

const createSchema = z.object({ name: z.string().min(2).max(60) });

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + "-" + Math.random().toString(36).slice(2, 6);
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const memberships = await prisma.teamMember.findMany({
    where: { userId: session.user.id, joinedAt: { not: null } },
    include: { team: { include: { members: { include: { user: { select: { id: true, name: true, email: true, image: true } } } } } } },
  });
  return NextResponse.json({ teams: memberships.map(m => ({ ...m.team, myRole: m.role })) });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const plan = await getUserPlan(session.user.id);
  if (plan === "FREE") return NextResponse.json({ error: "Teams require Pro or Enterprise plan." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Name required (2-60 chars)" }, { status: 400 });

  const existing = await prisma.teamMember.count({ where: { userId: session.user.id, team: { ownerId: session.user.id } } });
  if (existing >= 3) return NextResponse.json({ error: "Max 3 teams per account." }, { status: 403 });

  const team = await prisma.team.create({
    data: {
      name: parsed.data.name,
      slug: slugify(parsed.data.name),
      ownerId: session.user.id,
      plan,
      members: { create: { userId: session.user.id, role: "OWNER", joinedAt: new Date() } },
    },
    include: { members: true },
  });

  await logAudit({ userId: session.user.id, action: "team.create", metadata: { teamId: team.id, name: team.name } });
  return NextResponse.json({ team });
}
