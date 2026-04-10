"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import { useParlant } from "@/hooks/useParlant";

type User = { id: string; username: string; displayName: string };
type MeUser = User & {
  botEnabled?: boolean;
  botParlantUrl?: string | null;
  botAgentId?: string | null;
};
type Message = {
  id: string;
  content: string;
  senderId: string;
  receiverId: string;
  createdAt: string;
};

const SETTINGS_KEY = "sovi-chat:parlant-settings";
const DEFAULT_PARLANT_URL = "https://ecom-openai.demo.securityzone.vn";

type ParlantSettings = {
  enabled: boolean;
  url: string;
  agentId: string;
};

function loadSettings(): ParlantSettings {
  if (typeof window === "undefined") return { enabled: false, url: "", agentId: "" };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { enabled: false, url: DEFAULT_PARLANT_URL, agentId: "" };
}

export default function ChatPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [peer, setPeer] = useState<User | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [peerTyping, setPeerTyping] = useState(false);

  // Parlant bot
  const [settings, setSettings] = useState<ParlantSettings>({
    enabled: false,
    url: DEFAULT_PARLANT_URL,
    agentId: "",
  });
  const [showSettings, setShowSettings] = useState(false);
  const [bot, setBot] = useState<User | null>(null); // bot user record from DB

  // Persist a bot reply to DB and append to messages list (only when bot is active peer)
  const persistBotReply = async (text: string) => {
    try {
      const r = await fetch("/api/bot/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      if (!r.ok) return;
      const { message: saved } = await r.json();
      setMessages((prev) =>
        prev.some((m) => m.id === saved.id) ? prev : [...prev, saved]
      );
    } catch (err) {
      console.error("persistBotReply error", err);
    }
  };
  const persistBotReplyRef = useRef(persistBotReply);
  persistBotReplyRef.current = persistBotReply;

  const parlantConfig = useMemo(() => {
    if (!settings.enabled || !me) return null;
    return {
      url: settings.url,
      agentId: settings.agentId || undefined,
      customerId: me.id,
      onBotMessage: (text: string) => persistBotReplyRef.current(text),
    };
  }, [settings, me]);

  const parlant = useParlant(parlantConfig);

  const socketRef = useRef<Socket | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // load settings from localStorage on mount
  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  // fetch bot user record when bot is enabled
  useEffect(() => {
    if (!settings.enabled) {
      setBot(null);
      return;
    }
    (async () => {
      try {
        const r = await fetch("/api/bot");
        if (!r.ok) return;
        const d = await r.json();
        setBot(d.bot);
      } catch (err) {
        console.error("fetch /api/bot failed", err);
      }
    })();
  }, [settings.enabled]);

  // bootstrap: load me + users
  useEffect(() => {
    (async () => {
      const r = await fetch("/api/auth/me");
      if (!r.ok) {
        router.push("/login");
        return;
      }
      const data = await r.json();
      setMe(data.user);
      setToken(data.token);

      const ru = await fetch("/api/users");
      const du = await ru.json();
      setUsers(du.users);
    })();
  }, [router]);

  // socket setup
  useEffect(() => {
    if (!token || !me) return;
    const socket = io({ auth: { token } });
    socketRef.current = socket;

    socket.on("presence:snapshot", (userIds: string[]) => {
      setOnline(new Set(userIds));
    });

    socket.on("presence", ({ userId, online: isOnline }) => {
      setOnline((prev) => {
        const next = new Set(prev);
        if (isOnline) next.add(userId);
        else next.delete(userId);
        return next;
      });
    });

    socket.on("message:new", (msg: Message) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });

    socket.on("typing", ({ userId, typing }) => {
      if (peer && userId === peer.id) setPeerTyping(typing);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, me]);

  const isBotPeer = !!peer && !!bot && peer.id === bot.id;

  // when peer changes: load history. For non-bot also join socket room.
  useEffect(() => {
    if (!peer) return;

    (async () => {
      const r = await fetch(`/api/messages?peerId=${peer.id}`);
      const d = await r.json();
      setMessages(d.messages || []);
    })();

    if (!isBotPeer && socketRef.current) {
      const socket = socketRef.current;
      socket.emit("conversation:join", { peerId: peer.id });
      return () => {
        socket.emit("conversation:leave", { peerId: peer.id });
        setMessages([]);
        setPeerTyping(false);
      };
    }

    return () => {
      setMessages([]);
      setPeerTyping(false);
    };
  }, [peer, isBotPeer]);

  // when peer becomes bot: init Parlant session
  useEffect(() => {
    if (!isBotPeer || !parlantConfig) return;
    parlant.createSession();
    return () => {
      parlant.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBotPeer, parlantConfig?.url, parlantConfig?.agentId]);

  // autoscroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, peerTyping, parlant.status]);

  // if bot is disabled while selected, deselect
  useEffect(() => {
    if (isBotPeer && !settings.enabled) setPeer(null);
  }, [settings.enabled, isBotPeer]);

  // if bot is selected but its record reloads with a different id, refresh peer
  useEffect(() => {
    if (peer && bot && peer.username === bot.username && peer.id !== bot.id) {
      setPeer(bot);
    }
  }, [peer, bot]);

  async function send() {
    const text = input.trim();
    if (!text || !peer) return;

    if (isBotPeer) {
      // 1) persist user → bot in DB
      try {
        const r = await fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ receiverId: peer.id, content: text }),
        });
        if (r.ok) {
          const { message: saved } = await r.json();
          setMessages((prev) =>
            prev.some((m) => m.id === saved.id) ? prev : [...prev, saved]
          );
        }
      } catch (err) {
        console.error("save user→bot msg failed", err);
      }
      // 2) forward to Parlant; the reply will be persisted via onBotMessage
      parlant.send(text);
      setInput("");
      return;
    }

    if (!socketRef.current) return;
    socketRef.current.emit("message:send", { receiverId: peer.id, content: text });
    setInput("");
  }

  function handleTyping(value: string) {
    setInput(value);
    if (!peer || isBotPeer || !socketRef.current) return;
    socketRef.current.emit("typing", { receiverId: peer.id, typing: !!value });
  }

  async function logout() {
    await fetch("/api/auth/me", { method: "DELETE" });
    router.push("/login");
    router.refresh();
  }

  function saveSettings(next: ParlantSettings) {
    setSettings(next);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {}
  }

  const sortedUsers = useMemo(
    () =>
      [...users].sort((a, b) => {
        const ao = online.has(a.id) ? 0 : 1;
        const bo = online.has(b.id) ? 0 : 1;
        return ao - bo;
      }),
    [users, online]
  );

  if (!me) return <div className="p-8 text-center">Đang tải...</div>;

  // Unified message list (DB-backed for both normal and bot conversations)
  const displayMessages = messages.map((m) => ({
    id: m.id,
    mine: m.senderId === me.id,
    content: m.content,
    createdAt: m.createdAt,
  }));

  return (
    <div className="h-screen flex">
      {/* Sidebar */}
      <aside className="w-72 bg-white border-r flex flex-col">
        <div className="p-4 border-b flex items-center justify-between">
          <div className="min-w-0">
            <div className="font-semibold truncate">{me.displayName}</div>
            <div className="text-xs text-gray-500 truncate">@{me.username}</div>
          </div>
          <button
            onClick={() => setShowSettings(true)}
            className="text-xs text-gray-500 hover:text-zalo-blue"
            title="Cài đặt Parlant Bot"
          >
            ⚙️
          </button>
        </div>

        {/* Bot section */}
        {settings.enabled && bot && (
          <>
            <div className="px-4 py-2 text-xs uppercase text-gray-400">AI Assistant</div>
            <button
              onClick={() => setPeer(bot)}
              className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left ${
                isBotPeer ? "bg-blue-50" : ""
              }`}
            >
              <div className="relative w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 text-white flex items-center justify-center font-semibold">
                🤖
                <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white bg-green-500" />
              </div>
              <div className="min-w-0">
                <div className="font-medium truncate">Parlant Bot</div>
                <div className="text-xs text-gray-500 truncate">AI Assistant</div>
              </div>
            </button>
          </>
        )}

        <div className="px-4 py-2 text-xs uppercase text-gray-400">Liên hệ</div>
        <div className="flex-1 overflow-y-auto">
          {sortedUsers.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              Chưa có người dùng nào khác.
            </div>
          )}
          {sortedUsers.map((u) => (
            <button
              key={u.id}
              onClick={() => setPeer(u)}
              className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left ${
                peer?.id === u.id ? "bg-blue-50" : ""
              }`}
            >
              <div className="relative w-10 h-10 rounded-full bg-zalo-blue text-white flex items-center justify-center font-semibold">
                {u.displayName.charAt(0).toUpperCase()}
                <span
                  className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white ${
                    online.has(u.id) ? "bg-green-500" : "bg-gray-300"
                  }`}
                />
              </div>
              <div className="min-w-0">
                <div className="font-medium truncate">{u.displayName}</div>
                <div className="text-xs text-gray-500 truncate">@{u.username}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Logout footer */}
        <div className="border-t p-3">
          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm text-red-500 hover:bg-red-50 font-medium"
          >
            <span>↩</span>
            <span>Đăng xuất</span>
          </button>
        </div>
      </aside>

      {/* Chat panel */}
      <main className="flex-1 flex flex-col">
        {!peer ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            Chọn một liên hệ để bắt đầu trò chuyện
          </div>
        ) : (
          <>
            <header className="p-4 border-b bg-white flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-full text-white flex items-center justify-center font-semibold ${
                  isBotPeer
                    ? "bg-gradient-to-br from-purple-500 to-pink-500"
                    : "bg-zalo-blue"
                }`}
              >
                {isBotPeer ? "🤖" : peer.displayName.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{peer.displayName}</div>
                <div className="text-xs text-gray-500 truncate">
                  {isBotPeer
                    ? parlant.error
                      ? `❌ ${parlant.error}`
                      : parlant.sessionId
                      ? "AI Assistant — sẵn sàng"
                      : "Đang kết nối Parlant..."
                    : online.has(peer.id)
                    ? "Đang hoạt động"
                    : "Ngoại tuyến"}
                </div>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-zalo-bg">
              {displayMessages.length === 0 && isBotPeer && !parlant.error && (
                <div className="text-center text-sm text-gray-400 py-8">
                  Bắt đầu cuộc trò chuyện với Parlant Bot 👋
                </div>
              )}
              {displayMessages.map((m) => (
                <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[70%] px-4 py-2 rounded-2xl shadow-sm ${
                      m.mine
                        ? "bg-zalo-blue text-white rounded-br-sm"
                        : "bg-white text-gray-900 rounded-bl-sm"
                    }`}
                  >
                    <div className="whitespace-pre-wrap break-words">{m.content}</div>
                    <div
                      className={`text-[10px] mt-1 ${
                        m.mine ? "text-blue-100" : "text-gray-400"
                      }`}
                    >
                      {new Date(m.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                </div>
              ))}
              {isBotPeer && parlant.status && (
                <BotStatusBubble status={parlant.status} />
              )}
              {!isBotPeer && peerTyping && (
                <div className="flex justify-start">
                  <div className="bg-white rounded-2xl rounded-bl-sm shadow-sm px-4 py-3 flex items-center gap-1">
                    <TypingDots />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <div className="p-4 border-t bg-white flex gap-2">
              <input
                value={input}
                onChange={(e) => handleTyping(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                disabled={isBotPeer && (!parlant.sessionId || !!parlant.error)}
                placeholder={
                  isBotPeer && !parlant.sessionId ? "Đang kết nối..." : "Nhập tin nhắn..."
                }
                className="flex-1 border rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-zalo-blue disabled:bg-gray-100"
              />
              <button
                onClick={send}
                disabled={isBotPeer && (!parlant.sessionId || parlant.busy)}
                className="bg-zalo-blue text-white px-5 rounded-full font-semibold hover:opacity-90 disabled:opacity-50"
              >
                Gửi
              </button>
            </div>
          </>
        )}
      </main>

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          settings={settings}
          autoReply={{
            enabled: !!me.botEnabled,
            url: me.botParlantUrl || "",
            agentId: me.botAgentId || "",
          }}
          onClose={() => setShowSettings(false)}
          onSave={async (s, ar) => {
            saveSettings(s);
            try {
              const r = await fetch("/api/auth/me/bot", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  enabled: ar.enabled,
                  parlantUrl: ar.url,
                  agentId: ar.agentId,
                }),
              });
              if (r.ok) {
                const { user } = await r.json();
                setMe((prev) => (prev ? { ...prev, ...user } : prev));
              }
            } catch (err) {
              console.error("save auto-reply settings failed", err);
            }
            setShowSettings(false);
          }}
        />
      )}
    </div>
  );
}

type AutoReplySettings = { enabled: boolean; url: string; agentId: string };

function SettingsModal({
  settings,
  autoReply,
  onSave,
  onClose,
}: {
  settings: ParlantSettings;
  autoReply: AutoReplySettings;
  onSave: (s: ParlantSettings, ar: AutoReplySettings) => void;
  onClose: () => void;
}) {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [url, setUrl] = useState(settings.url || DEFAULT_PARLANT_URL);
  const [agentId, setAgentId] = useState(settings.agentId);

  const [arEnabled, setArEnabled] = useState(autoReply.enabled);
  const [arUrl, setArUrl] = useState(autoReply.url || DEFAULT_PARLANT_URL);
  const [arAgentId, setArAgentId] = useState(autoReply.agentId);

  const inputCls =
    "w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zalo-blue";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">⚙️ Parlant Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        {/* Section 1: Sidebar Bot (chat directly) */}
        <section className="space-y-3">
          <div className="text-xs uppercase tracking-wide text-gray-400 font-semibold">
            1. Chat trực tiếp với bot
          </div>

          <label className="flex items-center justify-between cursor-pointer">
            <div className="pr-3">
              <div className="font-medium">Bật Parlant Bot trong sidebar</div>
              <div className="text-xs text-gray-500">
                Hiện một AI Assistant trong sidebar để bạn chat trực tiếp
              </div>
            </div>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="w-5 h-5 accent-zalo-blue"
            />
          </label>

          <div>
            <label className="block text-sm font-medium mb-1">Parlant Server URL</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://10.123.10.202:8801"
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Agent ID{" "}
              <span className="text-gray-400 font-normal">(trống = dùng agent đầu tiên)</span>
            </label>
            <input
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              placeholder="agent_xxx"
              className={inputCls}
            />
          </div>
        </section>

        <hr />

        {/* Section 2: Auto-reply on my account */}
        <section className="space-y-3">
          <div className="text-xs uppercase tracking-wide text-gray-400 font-semibold">
            2. Auto-reply cho tài khoản của tôi
          </div>

          <label className="flex items-center justify-between cursor-pointer">
            <div className="pr-3">
              <div className="font-medium">Bot trả lời thay tôi</div>
              <div className="text-xs text-gray-500">
                Khi người khác chat với bạn, Parlant agent sẽ trả lời thay (kể cả khi bạn offline). Cài đặt lưu trên tài khoản, áp dụng mọi thiết bị.
              </div>
            </div>
            <input
              type="checkbox"
              checked={arEnabled}
              onChange={(e) => setArEnabled(e.target.checked)}
              className="w-5 h-5 accent-zalo-blue"
            />
          </label>

          <div>
            <label className="block text-sm font-medium mb-1">Parlant Server URL</label>
            <input
              value={arUrl}
              onChange={(e) => setArUrl(e.target.value)}
              placeholder="http://10.123.10.202:8801"
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Agent ID{" "}
              <span className="text-gray-400 font-normal">(trống = dùng agent đầu tiên)</span>
            </label>
            <input
              value={arAgentId}
              onChange={(e) => setArAgentId(e.target.value)}
              placeholder="9MsyTjNp7l"
              className={inputCls}
            />
          </div>
        </section>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border hover:bg-gray-50">
            Huỷ
          </button>
          <button
            onClick={() =>
              onSave(
                { enabled, url: url.trim(), agentId: agentId.trim() },
                { enabled: arEnabled, url: arUrl.trim(), agentId: arAgentId.trim() }
              )
            }
            className="px-4 py-2 rounded-lg bg-zalo-blue text-white font-semibold hover:opacity-90"
          >
            Lưu
          </button>
        </div>
      </div>
    </div>
  );
}

function TypingDots({ color = "bg-gray-400" }: { color?: string }) {
  return (
    <div className="flex items-center gap-1">
      <span
        className={`w-2 h-2 rounded-full ${color} animate-bounce`}
        style={{ animationDelay: "0ms", animationDuration: "1s" }}
      />
      <span
        className={`w-2 h-2 rounded-full ${color} animate-bounce`}
        style={{ animationDelay: "150ms", animationDuration: "1s" }}
      />
      <span
        className={`w-2 h-2 rounded-full ${color} animate-bounce`}
        style={{ animationDelay: "300ms", animationDuration: "1s" }}
      />
    </div>
  );
}

function BotStatusBubble({ status }: { status: string }) {
  const lower = status.toLowerCase();
  let icon = "💭";
  if (lower.includes("nhập") || lower.includes("typing")) icon = "✍️";
  else if (lower.includes("gửi") || lower.includes("sending")) icon = "📤";
  else if (lower.includes("suy nghĩ") || lower.includes("thinking")) icon = "💭";

  return (
    <div className="flex justify-start fade-in">
      <div className="flex items-end gap-2">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 text-white flex items-center justify-center text-sm shadow-sm">
          🤖
        </div>
        <div className="bg-white rounded-2xl rounded-bl-sm shadow-sm px-4 py-2.5 flex items-center gap-2 border border-gray-100">
          <TypingDots color="bg-purple-400" />
          <span className="text-xs text-gray-500 font-medium flex items-center gap-1">
            <span>{icon}</span>
            {status}
          </span>
        </div>
      </div>
    </div>
  );
}
