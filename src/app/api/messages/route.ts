import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

// POST /api/messages — create a message from current user to receiverId.
// Used for normal-user → bot messages (Socket.IO handles user → user).
export async function POST(req: NextRequest) {
  const me = getCurrentUser(req);
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { receiverId, content } = await req.json();
    if (!receiverId || !content?.trim()) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    const msg = await prisma.message.create({
      data: { senderId: me.userId, receiverId, content: content.trim() },
    });
    return NextResponse.json({ message: msg });
  } catch (err) {
    console.error("POST /api/messages error", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// GET /api/messages?peerId=xxx — fetch conversation history with a peer
export async function GET(req: NextRequest) {
  const me = getCurrentUser(req);
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const peerId = req.nextUrl.searchParams.get("peerId");
  if (!peerId) return NextResponse.json({ error: "peerId required" }, { status: 400 });

  const messages = await prisma.message.findMany({
    where: {
      OR: [
        { senderId: me.userId, receiverId: peerId },
        { senderId: peerId, receiverId: me.userId },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  return NextResponse.json({ messages });
}
