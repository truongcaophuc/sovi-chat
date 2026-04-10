"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, displayName, password, email, phone }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Register failed");
      return;
    }
    router.push("/chat");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={onSubmit} className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold text-center text-zalo-blue">Sovi Chat</h1>
        <p className="text-center text-sm text-gray-500">Tạo tài khoản mới</p>

        <div>
          <label className="block text-sm font-medium mb-1">Tên hiển thị</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zalo-blue"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Tên đăng nhập</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zalo-blue"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            Email <span className="text-gray-400 font-normal">(không bắt buộc)</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zalo-blue"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            Số điện thoại <span className="text-gray-400 font-normal">(không bắt buộc)</span>
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zalo-blue"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Mật khẩu</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zalo-blue"
            required
            minLength={4}
          />
        </div>

        {error && <div className="text-red-500 text-sm">{error}</div>}

        <button
          disabled={loading}
          className="w-full bg-zalo-blue text-white rounded-lg py-2 font-semibold hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Đang tạo..." : "Đăng ký"}
        </button>

        <p className="text-center text-sm text-gray-600">
          Đã có tài khoản?{" "}
          <Link href="/login" className="text-zalo-blue font-medium">
            Đăng nhập
          </Link>
        </p>
      </form>
    </div>
  );
}
