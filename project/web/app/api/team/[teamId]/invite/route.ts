import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import crypto from "crypto";
import { z } from "zod";

const schema = z.object({ email: z.string().email(), role: z.enum(["ADMIN", "ANALYST", "VIEWER"]).default("ANALYST") });

export async function POST(req: NextRequest, { params }: { params: { teamId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const member = await prisma.teamMember.findUnique({ where: { teamId_userId: { teamId: params.teamId, userId: session.user.id } } });
  if (!member || !["OWNER","ADMIN"].includes(member.role)) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  const count = await prisma.teamMember.count({ where: { teamId: params.teamId } });
  if (count >= 25) return NextResponse.json({ error: "Max 25 members per team." }, { status: 403 });
  const token = crypto.randomBytes(24).toString("base64url");
  const invite = await prisma.teamInvite.create({ data: { teamId: params.teamId, email: parsed.data.email, role: parsed.data.role, token, expiresAt: new Date(Date.now() + 7*24*60*60*1000) } });
  const inviteUrl = (process.env.NEXTAUTH_URL ?? "http://localhost:3000") + "/invite/" + token;
  return NextResponse.json({ invite, inviteUrl });
}
