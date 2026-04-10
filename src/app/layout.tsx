import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sovi Chat",
  description: "Realtime 1-1 chat",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
