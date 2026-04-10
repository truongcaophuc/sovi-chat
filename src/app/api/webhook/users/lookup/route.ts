import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { BOT_USERNAME } from "@/lib/bot";

/**
 * GET /api/webhook/users/lookup
 *
 * Look up a user by one of: id, email, phone, username.
 * Returns the public profile (no password hash).
 *
 * Auth:  header `X-API-Key: <WEBHOOK_API_KEY>`
 *
 * Query params (provide exactly one):
 *   ?id=cuid...
 *   ?email=alice@example.com
 *   ?phone=0901234567
 *   ?username=alice
 *
 * Responses:
 *   200 { user: { id, username, displayName, email, phone, botEnabled, createdAt } }
 *   400 if no/multiple query params
 *   401 if API key invalid
 *   404 if no user matches
 */
export async function GET(req: NextRequest) {
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

  const sp = req.nextUrl.searchParams;
  const id = sp.get("id")?.trim() || null;
  const email = sp.get("email")?.trim().toLowerCase() || null;
  const phone = sp.get("phone")?.trim() || null;
  const username = sp.get("username")?.trim() || null;

  const provided_keys = [id, email, phone, username].filter(Boolean);
  if (provided_keys.length === 0) {
    return NextResponse.json(
      { error: "Provide one of: id, email, phone, username" },
      { status: 400 }
    );
  }
  if (provided_keys.length > 1) {
    return NextResponse.json(
      { error: "Provide exactly one of: id, email, phone, username" },
      { status: 400 }
    );
  }

  const where = id
    ? { id }
    : email
    ? { email }
    : phone
    ? { phone }
    : { username: username! };

  const user = await prisma.user.findUnique({
    where,
    select: {
      id: true,
      username: true,
      displayName: true,
      email: true,
      phone: true,
      botEnabled: true,
      createdAt: true,
    },
  });

  if (!user || user.username === BOT_USERNAME) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ user });
}
