import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export async function GET(req: NextRequest, { params }: { params: { ticker: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ticker = params.ticker.toUpperCase();

  const company = await prisma.company.findUnique({
    where: { ticker },
    include: {
      quarters: { orderBy: [{ fiscalYear: "asc" }, { fiscalQuarter: "asc" }] },
    },
  });

  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  return NextResponse.json({ company });
}

export async function DELETE(req: NextRequest, { params }: { params: { ticker: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ticker = params.ticker.toUpperCase();
  const company = await prisma.company.findUnique({ where: { ticker } });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  await prisma.watchlistItem.deleteMany({ where: { userId: session.user.id, companyId: company.id } });
  await logAudit({ userId: session.user.id, action: "watchlist.remove", metadata: { ticker } });

  return NextResponse.json({ success: true });
}
