import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { getOrCreateBotUser } from "@/lib/bot";

// POST /api/bot/reply — persist a bot reply addressed to the current user.
// Body: { content: string }
// We always force senderId = bot user, receiverId = current user — so the
// client cannot fake a message from another user.
export async function POST(req: NextRequest) {
  const me = getCurrentUser(req);
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { content } = await req.json();
    if (!content?.trim()) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    const bot = await getOrCreateBotUser();
    const msg = await prisma.message.create({
      data: { senderId: bot.id, receiverId: me.userId, content: content.trim() },
    });
    return NextResponse.json({ message: msg });
  } catch (err) {
    console.error("POST /api/bot/reply error", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
