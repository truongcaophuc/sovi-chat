import { prisma } from "./prisma";

export const BOT_USERNAME = "__parlant_bot";
export const BOT_DISPLAY_NAME = "🤖 Parlant Bot";

/**
 * Returns the bot user record, creating it on first call.
 * Bot is a normal User row so all messages can live in the same Message table.
 * Password hash is set to a random non-loginable value.
 */
export async function getOrCreateBotUser() {
  const existing = await prisma.user.findUnique({ where: { username: BOT_USERNAME } });
  if (existing) return existing;

  return prisma.user.create({
    data: {
      username: BOT_USERNAME,
      displayName: BOT_DISPLAY_NAME,
      // not a real bcrypt hash → impossible to login as the bot
      passwordHash: "!disabled!",
    },
  });
}

export function isBotUsername(username: string) {
  return username === BOT_USERNAME;
}
