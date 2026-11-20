import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "チーム運営管理",
  description: "バスケットボールチームの予定・出欠・請求・会計管理",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
