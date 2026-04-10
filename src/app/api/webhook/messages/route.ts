import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/webhook/messages
 *
 * External webhook for systems outside of Sovi Chat to inject a message into
 * a 1-1 conversation. The message is persisted in DB and broadcast via
 * Socket.IO to any online clients in that conversation.
 *
 * Auth:  header `X-API-Key: <WEBHOOK_API_KEY>` (must match .env value)
 * Body:
 *   {
 *     "fromUserId": "cuid...",
 *     "toUserId":   "cuid...",
 *     "content":    "hello"
 *   }
 *
 * Both users must already exist. Auto-reply (if recipient has botEnabled) is
 * triggered just like a normal Socket.IO message:send.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.WEBHOOK_API_KEY;
  if (!expected) {
    return NextResponse.json(
      { error: "WEBHOOK_API_KEY not configured on server" },
      { status: 500 }
    );
  }

  const provided = req.headers.get("x-api-key");
  if (!provided || provided !== expected) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { fromUserId, toUserId, content } = body || {};
  if (!fromUserId || !toUserId || !content?.trim()) {
    return NextResponse.json(
      { error: "fromUserId, toUserId, content are required" },
      { status: 400 }
    );
  }
  if (fromUserId === toUserId) {
    return NextResponse.json({ error: "fromUserId and toUserId must differ" }, { status: 400 });
  }

  // Both users must exist
  const [from, to] = await Promise.all([
    prisma.user.findUnique({ where: { id: fromUserId }, select: { id: true } }),
    prisma.user.findUnique({ where: { id: toUserId }, select: { id: true } }),
  ]);
  if (!from) {
    return NextResponse.json({ error: `fromUserId not found: ${fromUserId}` }, { status: 404 });
  }
  if (!to) {
    return NextResponse.json({ error: `toUserId not found: ${toUserId}` }, { status: 404 });
  }

  const text = String(content).trim();
  const msg = await prisma.message.create({
    data: { senderId: fromUserId, receiverId: toUserId, content: text },
  });

  // Broadcast via Socket.IO if available (custom server exposes it on globalThis)
  const sovi = (globalThis as any).__sovi as
    | {
        io: any;
        pairKey: (a: string, b: string) => string;
        maybeAutoReply: (ownerId: string, peerId: string, text: string) => Promise<void>;
      }
    | undefined;

  let broadcasted = false;
  if (sovi?.io) {
    const room = `conv:${sovi.pairKey(fromUserId, toUserId)}`;
    sovi.io.to(room).emit("message:new", msg);
    sovi.io.to(`user:${toUserId}`).emit("message:notify", msg);
    broadcasted = true;

    // Trigger auto-reply (fire-and-forget) so external messages also kick the bot.
    sovi.maybeAutoReply(toUserId, fromUserId, text).catch((e) =>
      console.error("webhook maybeAutoReply error:", e)
    );
  } else {
    console.warn("webhook: globalThis.__sovi not available — message saved but not broadcast");
  }

  return NextResponse.json({ ok: true, message: msg, broadcasted });
}
