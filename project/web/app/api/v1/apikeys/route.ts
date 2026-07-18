import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getUserPlan } from "@/lib/plan-limits";
import { logAudit } from "@/lib/audit";
import { z } from "zod";
import crypto from "crypto";

function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = "mkl_live_" + crypto.randomBytes(24).toString("base64url");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  const prefix = raw.slice(0, 16) + "...";
  return { raw, hash, prefix };
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const keys = await prisma.apiKey.findMany({
    where: { userId: session.user.id, revokedAt: null },
    select: { id: true, name: true, keyPrefix: true, lastUsedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ keys });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const plan = await getUserPlan(session.user.id);
  if (plan === "FREE") return NextResponse.json({ error: "API keys require a Pro or Enterprise plan." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = z.object({ name: z.string().min(1).max(80) }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const existing = await prisma.apiKey.count({ where: { userId: session.user.id, revokedAt: null } });
  if (existing >= 10) return NextResponse.json({ error: "Maximum 10 API keys per account." }, { status: 403 });

  const { raw, hash, prefix } = generateApiKey();
  const key = await prisma.apiKey.create({
    data: { userId: session.user.id, name: parsed.data.name, keyHash: hash, keyPrefix: prefix },
  });
  await logAudit({ userId: session.user.id, action: "apikey.create", metadata: { keyId: key.id } });

  // Return raw key ONCE — never stored in plaintext
  return NextResponse.json({ key: { id: key.id, name: key.name, keyPrefix: prefix, createdAt: key.createdAt }, rawKey: raw, warning: "Save this key now. It will never be shown again." });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { keyId } = await req.json().catch(() => ({}));
  if (!keyId) return NextResponse.json({ error: "keyId required" }, { status: 400 });
  await prisma.apiKey.updateMany({ where: { id: keyId, userId: session.user.id }, data: { revokedAt: new Date() } });
  await logAudit({ userId: session.user.id, action: "apikey.revoke", metadata: { keyId } });
  return NextResponse.json({ success: true });
}
