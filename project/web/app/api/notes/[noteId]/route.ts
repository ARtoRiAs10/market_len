import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";

export async function PATCH(req: NextRequest, { params }: { params: { noteId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const note = await prisma.analystNote.updateMany({
    where: { id: params.noteId, userId: session.user.id },
    data: { content: body.content, pinned: body.pinned },
  });
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest, { params }: { params: { noteId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prisma.analystNote.deleteMany({ where: { id: params.noteId, userId: session.user.id } });
  return NextResponse.json({ success: true });
}
