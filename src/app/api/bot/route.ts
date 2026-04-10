import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getOrCreateBotUser } from "@/lib/bot";

// GET /api/bot — returns the bot user record (creates it if missing).
export async function GET(req: NextRequest) {
  const me = getCurrentUser(req);
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const bot = await getOrCreateBotUser();
  return NextResponse.json({
    bot: { id: bot.id, username: bot.username, displayName: bot.displayName },
  });
}
