// Custom Next.js server with Socket.IO for realtime chat.
// Also handles auto-reply: when a recipient has botEnabled=true, the server
// forwards the incoming message to a Parlant agent and replies on their behalf.
const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);
const SECRET = process.env.JWT_SECRET || "dev-secret";

const app = next({ dev });
const handle = app.getRequestHandler();
const prisma = new PrismaClient();

// userId -> Set<socketId>
const onlineUsers = new Map();

// Cache: "ownerId|peerId" -> { sessionId, parlantUrl, lastOffset }
// Re-created on server restart (sessions live in Parlant though).
const botSessions = new Map();

function pairKey(a, b) {
  return [a, b].sort().join(":");
}

// ---------- Parlant helpers ----------

async function pFetch(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Parlant ${res.status} ${url}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function ensureCustomer(baseUrl, customerId, name) {
  try {
    await pFetch(`${baseUrl}/customers/${customerId}`);
  } catch {
    await pFetch(`${baseUrl}/customers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: customerId, name }),
    });
  }
}

async function getFirstAgentId(baseUrl) {
  const agents = await pFetch(`${baseUrl}/agents`);
  if (!Array.isArray(agents) || agents.length === 0) {
    throw new Error("No agents available on Parlant server");
  }
  return agents[0].id;
}

async function createParlantSession(baseUrl, agentId, customerId) {
  const session = await pFetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_id: agentId,
      customer_id: customerId,
      title: `Sovi auto-reply ${new Date().toISOString()}`,
    }),
  });
  return session.id;
}

async function postMessage(baseUrl, sessionId, message) {
  return pFetch(`${baseUrl}/sessions/${sessionId}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "message", source: "customer", message }),
  });
}

async function listEvents(baseUrl, sessionId, minOffset, waitForData = 30) {
  const params = new URLSearchParams({
    min_offset: String(minOffset),
    wait_for_data: String(waitForData),
    kinds: "message,status",
  });
  return pFetch(`${baseUrl}/sessions/${sessionId}/events?${params}`);
}

function extractText(raw) {
  if (raw == null) return "";
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      if (Array.isArray(p)) {
        return p
          .map((b) => (typeof b === "string" ? b : b?.text || b?.content || ""))
          .filter(Boolean)
          .join("\n");
      }
      if (p?.text) return p.text;
      return raw;
    } catch {
      return raw;
    }
  }
  if (typeof raw === "object") {
    return raw.text || raw.content || JSON.stringify(raw);
  }
  return String(raw);
}

// Long-poll until we get a bot message reply or hit timeoutMs.
async function waitForBotReply(baseUrl, sessionId, startOffset, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let offset = startOffset;
  while (Date.now() < deadline) {
    let events;
    try {
      events = await listEvents(baseUrl, sessionId, offset, 20);
    } catch (err) {
      if (String(err.message).includes("504")) continue;
      throw err;
    }
    for (const ev of events) {
      offset = Math.max(offset, (ev.offset ?? 0) + 1);
      if (
        ev.kind === "message" &&
        (ev.source === "ai_agent" || ev.source === "human_agent")
      ) {
        const data = ev.data || {};
        const raw =
          (data.message && (data.message.content ?? data.message)) ??
          data.content ??
          "";
        const text = extractText(raw);
        if (text) return { text, offset };
      }
    }
  }
  return null;
}

/**
 * Fire-and-forget: when a message is delivered to `ownerId` and they have
 * botEnabled=true, forward the message to Parlant and emit the bot's reply
 * back to the conversation as if from `ownerId`.
 */
async function maybeAutoReply(io, ownerId, peerId, incomingText) {
  let owner;
  try {
    owner = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { id: true, displayName: true, botEnabled: true, botParlantUrl: true, botAgentId: true },
    });
  } catch (err) {
    console.error("auto-reply: load owner failed", err);
    return;
  }
  if (!owner?.botEnabled) return;
  const baseUrl = (owner.botParlantUrl || "").replace(/\/$/, "");
  if (!baseUrl) {
    console.warn("auto-reply: owner", ownerId, "has botEnabled but no parlantUrl");
    return;
  }

  const room = `conv:${pairKey(ownerId, peerId)}`;
  const cacheKey = `${ownerId}|${peerId}`;

  try {
    // Show "typing" indicator on behalf of owner
    io.to(room).emit("typing", { userId: ownerId, typing: true });

    let entry = botSessions.get(cacheKey);
    // Re-create session if URL changed since last cache
    if (entry && entry.parlantUrl !== baseUrl) entry = null;

    if (!entry) {
      const agentId = owner.botAgentId || (await getFirstAgentId(baseUrl));
      // Use peerId as customer so Parlant remembers per-peer context
      const customerId = `sovi:${peerId}`;
      await ensureCustomer(baseUrl, customerId, `Sovi peer ${peerId.slice(0, 8)}`);
      const sessionId = await createParlantSession(baseUrl, agentId, customerId);
      entry = { sessionId, parlantUrl: baseUrl, lastOffset: 0 };
      botSessions.set(cacheKey, entry);
      console.log(`auto-reply: new Parlant session ${sessionId} for ${cacheKey}`);
    }

    await postMessage(baseUrl, entry.sessionId, incomingText);

    const reply = await waitForBotReply(baseUrl, entry.sessionId, entry.lastOffset, 60000);
    if (!reply) {
      console.warn(`auto-reply: timed out waiting for reply on session ${entry.sessionId}`);
      return;
    }
    entry.lastOffset = reply.offset;

    // Save bot reply as a message from owner -> peer
    const saved = await prisma.message.create({
      data: { senderId: ownerId, receiverId: peerId, content: reply.text },
    });
    io.to(room).emit("message:new", saved);
    io.to(`user:${peerId}`).emit("message:notify", saved);
  } catch (err) {
    console.error("auto-reply error:", err.message || err);
    // On failure, drop the cached session so next attempt creates a fresh one
    botSessions.delete(cacheKey);
  } finally {
    io.to(room).emit("typing", { userId: ownerId, typing: false });
  }
}

// ---------- Server ----------

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  const io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
  });

  // Expose io + helpers to Next route handlers (which run in the same process).
  // Next routes can read these via `globalThis.__sovi`.
  globalThis.__sovi = {
    io,
    pairKey,
    maybeAutoReply: (ownerId, peerId, text) => maybeAutoReply(io, ownerId, peerId, text),
  };

  io.use((socket, nextMw) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return nextMw(new Error("no token"));
      const payload = jwt.verify(token, SECRET);
      socket.data.userId = payload.userId;
      socket.data.username = payload.username;
      nextMw();
    } catch (err) {
      nextMw(new Error("invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId;

    // Send the current online snapshot to the just-connected user BEFORE we
    // mark them online — so they don't see themselves in the list.
    socket.emit("presence:snapshot", Array.from(onlineUsers.keys()));

    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);
    socket.join(`user:${userId}`);
    io.emit("presence", { userId, online: true });

    socket.on("conversation:join", ({ peerId }) => {
      if (!peerId) return;
      socket.join(`conv:${pairKey(userId, peerId)}`);
    });

    socket.on("conversation:leave", ({ peerId }) => {
      if (!peerId) return;
      socket.leave(`conv:${pairKey(userId, peerId)}`);
    });

    socket.on("message:send", async ({ receiverId, content }, ack) => {
      try {
        if (!receiverId || !content?.trim()) {
          return ack?.({ ok: false, error: "invalid payload" });
        }
        const text = content.trim();
        const msg = await prisma.message.create({
          data: { senderId: userId, receiverId, content: text },
        });
        const room = `conv:${pairKey(userId, receiverId)}`;
        io.to(room).emit("message:new", msg);
        io.to(`user:${receiverId}`).emit("message:notify", msg);
        ack?.({ ok: true, message: msg });

        // Fire-and-forget: trigger auto-reply if recipient has bot enabled.
        // Don't await — we don't want to block the sender's ack on Parlant.
        maybeAutoReply(io, receiverId, userId, text).catch((e) =>
          console.error("maybeAutoReply unhandled:", e)
        );
      } catch (err) {
        console.error("message:send error", err);
        ack?.({ ok: false, error: "server error" });
      }
    });

    socket.on("typing", ({ receiverId, typing }) => {
      if (!receiverId) return;
      io.to(`conv:${pairKey(userId, receiverId)}`).emit("typing", {
        userId,
        typing: !!typing,
      });
    });

    socket.on("disconnect", () => {
      const set = onlineUsers.get(userId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) {
          onlineUsers.delete(userId);
          io.emit("presence", { userId, online: false });
        }
      }
    });
  });

  httpServer.listen(port, () => {
    console.log(`> Sovi Chat ready on http://localhost:${port}`);
  });
});
