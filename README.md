# Sovi Chat

Ứng dụng chat realtime 1-1 kiểu Zalo, xây bằng **Next.js 14 (App Router) + Prisma + Socket.IO + Tailwind**, dùng PostgreSQL trên `10.123.30.21`.

## Tính năng

- Đăng ký / Đăng nhập (JWT trong httpOnly cookie, mật khẩu băm bcrypt)
- Danh sách liên hệ + trạng thái online/offline realtime
- Chat 1-1 realtime qua Socket.IO
- Lưu lịch sử tin nhắn trong PostgreSQL (Prisma)
- Indicator "đang nhập..."

## Yêu cầu

- Node.js >= 18
- Có quyền truy cập PostgreSQL tại `10.123.30.21:5432` (DB `chat_app` đã được tạo sẵn)

## Cài đặt

```bash
cd d:/Users/ACER/Documents/sovi-chat
npm install
```

## Khởi tạo database (lần đầu)

```bash
npx prisma generate
npx prisma db push
```

Lệnh `db push` sẽ tự tạo các bảng `User`, `Message` trong DB `chat_app`.

## Chạy dev

```bash
npm run dev
```

Mở [http://localhost:3000](http://localhost:3000).

> Lưu ý: app dùng **custom server** (`server.js`) để gắn Socket.IO, nên không dùng `next dev` mà dùng `node server.js` (đã được wrap trong `npm run dev`).

## Test thử

1. Mở 2 trình duyệt (hoặc 1 trình duyệt chế độ ẩn danh).
2. Đăng ký 2 tài khoản khác nhau.
3. Mỗi bên chọn người còn lại trong sidebar và bắt đầu chat.

## Cấu trúc

```
sovi-chat/
├── prisma/schema.prisma         # Schema User + Message
├── server.js                    # Next.js custom server + Socket.IO
├── src/
│   ├── lib/
│   │   ├── prisma.ts            # Prisma client singleton
│   │   └── auth.ts              # JWT helpers
│   └── app/
│       ├── layout.tsx
│       ├── page.tsx             # redirect /login or /chat
│       ├── login/page.tsx
│       ├── register/page.tsx
│       ├── chat/page.tsx        # UI chat chính
│       └── api/
│           ├── auth/{register,login,me}/route.ts
│           ├── users/route.ts
│           └── messages/route.ts
├── .env                         # DATABASE_URL, JWT_SECRET
└── package.json
```

## Biến môi trường (.env)

```env
DATABASE_URL="postgresql://postgres:abc123456@10.123.30.21:5432/chat_app?schema=public"
JWT_SECRET="sovi-chat-dev-secret-change-me-in-prod"
PORT=3000
```

## Socket events

| Event (client → server) | Payload | Mô tả |
|---|---|---|
| `conversation:join`     | `{ peerId }` | Tham gia phòng chat 1-1 |
| `conversation:leave`    | `{ peerId }` | Rời phòng |
| `message:send`          | `{ receiverId, content }` | Gửi tin nhắn (có ack) |
| `typing`                | `{ receiverId, typing }`  | Báo đang nhập |

| Event (server → client) | Payload | Mô tả |
|---|---|---|
| `presence`     | `{ userId, online }`  | Ai online/offline |
| `message:new`  | `Message`             | Tin nhắn mới trong phòng |
| `message:notify` | `Message`           | Thông báo (khi không mở phòng) |
| `typing`       | `{ userId, typing }`  | Đang nhập |

## Parlant Bot tích hợp (tuỳ chọn)

App có sẵn tích hợp với [Parlant](https://parlant.io) — một AI agent framework — để hoạt động như chatbot trong sidebar.

### Cách bật

1. Vào trang `/chat`, click icon **⚙️** ở góc trên-trái sidebar.
2. Bật toggle **"Bật Parlant Bot"**.
3. Điền:
   - **Parlant Server URL**: ví dụ `https://ecom-openai.demo.securityzone.vn` hoặc URL Parlant server riêng của bạn.
   - **Agent ID**: bỏ trống để app tự dùng agent đầu tiên trên server, hoặc điền `agent_xxx` cụ thể.
4. Lưu → một liên hệ **🤖 Parlant Bot** sẽ xuất hiện ở đầu sidebar.
5. Click vào để bắt đầu chat — app tự tạo customer (theo `userId` của bạn) và session, rồi long-poll events từ Parlant.

### Cấu trúc

| File | Vai trò |
|---|---|
| [src/lib/parlant-client.ts](src/lib/parlant-client.ts) | Browser-compatible REST client gọi `/agents`, `/customers`, `/sessions/:id/events` của Parlant |
| [src/hooks/useParlant.ts](src/hooks/useParlant.ts) | React hook quản lý session + long-poll event loop, expose `messages`, `send()`, `status`, `busy`, `error` |
| [src/app/chat/page.tsx](src/app/chat/page.tsx) | Trang chat — có Settings modal và phân nhánh: nếu `peer.id === BOT_ID` thì dùng `useParlant` thay cho Socket.IO |

### Lưu ý

- Settings được lưu trong `localStorage` (key `sovi-chat:parlant-settings`), không lưu vào DB.
- Lịch sử chat với bot **không** lưu DB (chỉ tồn tại trong session client).
- Mỗi user dùng `userId` của họ làm `customerId` trên Parlant → Parlant nhận diện liên tục giữa các phiên.

## Mở rộng tiếp theo (gợi ý)

- Group chat (thêm bảng `Conversation` + `ConversationMember`)
- Đã đọc / chưa đọc (`readAt`)
- Upload ảnh / file (S3 / local storage)
- Push notification
- E2E encryption
