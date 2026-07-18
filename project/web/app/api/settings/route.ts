import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";

const settingsSchema = z.object({ name: z.string().min(1).max(80) });

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  await prisma.user.update({ where: { id: session.user.id }, data: { name: parsed.data.name } });
  return NextResponse.json({ success: true });
}
