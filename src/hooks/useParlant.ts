"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ParlantClient } from "@/lib/parlant-client";

export type ParlantMessage = {
  id: string;
  role: "user" | "bot";
  content: string;
  createdAt: string;
};

export type ParlantConfig = {
  url: string;
  agentId?: string; // optional — if empty, picks first agent on server
  customerId: string;
  onBotMessage?: (text: string) => void; // called for each bot reply (for persistence)
};

/**
 * Lightweight Parlant integration for sovi-chat.
 * - createSession() khởi tạo customer + session
 * - send() gửi tin nhắn của user
 * - long-poll events → push tin nhắn của bot vào messages[]
 */
export function useParlant(config: ParlantConfig | null) {
  const [messages, setMessages] = useState<ParlantMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<ParlantClient | null>(null);
  const offsetRef = useRef(0);
  const pollingRef = useRef(false);
  const onBotMessageRef = useRef<((text: string) => void) | undefined>(undefined);

  // keep latest callback in ref so the polling loop can call it
  useEffect(() => {
    onBotMessageRef.current = config?.onBotMessage;
  }, [config?.onBotMessage]);

  // (re)create client when url changes
  useEffect(() => {
    if (!config?.url) {
      clientRef.current = null;
      return;
    }
    clientRef.current = new ParlantClient({ environment: config.url });
  }, [config?.url]);

  const startEventLoop = useCallback(
    async (sid: string) => {
      const client = clientRef.current;
      if (!client || pollingRef.current) return;
      pollingRef.current = true;

      while (pollingRef.current) {
        try {
          const events = await client.sessions.listEvents(sid, {
            minOffset: offsetRef.current,
            waitForData: 30,
            kinds: "message,status",
          });

          for (const ev of events) {
            const data = ev.data as any;

            if (ev.kind === "message" && (ev.source === "ai_agent" || ev.source === "human_agent")) {
              const raw = data?.message?.content ?? data?.message ?? data?.content ?? "";
              let text = "";
              if (typeof raw === "string") {
                // try to extract plain text from any JSON content blocks
                try {
                  const parsed = JSON.parse(raw);
                  if (Array.isArray(parsed)) {
                    text = parsed
                      .map((b) => (typeof b === "string" ? b : b?.text || b?.content || ""))
                      .filter(Boolean)
                      .join("\n");
                  } else if (parsed?.text) {
                    text = parsed.text;
                  } else {
                    text = raw;
                  }
                } catch {
                  text = raw;
                }
              } else if (typeof raw === "object" && raw) {
                text = raw.text || raw.content || JSON.stringify(raw);
              }

              if (text) {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: ev.id || `bot-${Date.now()}-${Math.random()}`,
                    role: "bot",
                    content: text,
                    createdAt: new Date().toISOString(),
                  },
                ]);
                // notify outside (e.g. for DB persistence)
                onBotMessageRef.current?.(text);
              }
              setStatus("");
              setBusy(false);
            } else if (ev.kind === "status") {
              const s = data?.status;
              if (s === "processing") {
                setStatus("Bot đang suy nghĩ...");
                setBusy(true);
              } else if (s === "typing") {
                setStatus("Bot đang nhập...");
                setBusy(true);
              } else if (s === "ready") {
                setStatus("");
                setBusy(false);
              }
            }

            offsetRef.current = Math.max(offsetRef.current, (ev.offset ?? 0) + 1);
          }
        } catch (err: any) {
          const isTimeout =
            err?.status === 504 ||
            err?.message?.includes("504") ||
            err?.message?.includes("timeout");
          if (isTimeout) continue;
          // brief pause then retry
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    },
    []
  );

  const createSession = useCallback(async () => {
    const client = clientRef.current;
    if (!client || !config) {
      setError("Parlant URL chưa được cấu hình");
      return false;
    }

    setError(null);
    setMessages([]);
    offsetRef.current = 0;

    try {
      let agentId = config.agentId;
      if (!agentId) {
        const agents = await client.agents.list();
        if (!agents || agents.length === 0) {
          setError("Server Parlant không có agent nào");
          return false;
        }
        agentId = agents[0].id;
      }

      try {
        await client.customers.retrieve(config.customerId);
      } catch {
        await client.customers.create({
          id: config.customerId,
          name: `Sovi User ${config.customerId.substring(0, 8)}`,
        });
      }

      const session = await client.sessions.create({
        agentId,
        customerId: config.customerId,
        title: `Sovi Chat ${new Date().toLocaleString()}`,
      });
      setSessionId(session.id);
      startEventLoop(session.id);
      return true;
    } catch (err: any) {
      console.error("Parlant init failed:", err);
      setError(err?.message || "Không kết nối được Parlant");
      return false;
    }
  }, [config, startEventLoop]);

  const send = useCallback(
    async (text: string) => {
      const client = clientRef.current;
      if (!client || !sessionId || !text.trim()) return;

      // optimistic add user message
      setMessages((prev) => [
        ...prev,
        {
          id: `user-${Date.now()}`,
          role: "user",
          content: text.trim(),
          createdAt: new Date().toISOString(),
        },
      ]);
      setBusy(true);
      setStatus("Đang gửi...");

      try {
        await client.sessions.createEvent(sessionId, {
          kind: "message",
          source: "customer",
          message: text.trim(),
        });
      } catch (err: any) {
        setError(err?.message || "Gửi tin thất bại");
        setBusy(false);
        setStatus("");
      }
    },
    [sessionId]
  );

  const stop = useCallback(() => {
    pollingRef.current = false;
    setSessionId(null);
    setMessages([]);
    setStatus("");
    setBusy(false);
    offsetRef.current = 0;
  }, []);

  useEffect(() => {
    return () => {
      pollingRef.current = false;
    };
  }, []);

  return { messages, sessionId, status, busy, error, createSession, send, stop };
}
