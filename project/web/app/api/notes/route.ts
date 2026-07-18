import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";

const schema = z.object({
  companyId: z.string(),
  fiscalYear: z.number().optional(),
  fiscalQuarter: z.number().optional(),
  content: z.string().min(1).max(2000),
  pinned: z.boolean().default(false),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const companyId = req.nextUrl.searchParams.get("companyId");
  const notes = await prisma.analystNote.findMany({
    where: { userId: session.user.id, ...(companyId ? { companyId } : {}) },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    include: { company: true },
  });
  return NextResponse.json({ notes });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });
  const note = await prisma.analystNote.create({
    data: { userId: session.user.id, ...parsed.data },
    include: { company: true },
  });
  return NextResponse.json({ note });
}
