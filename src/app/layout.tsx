import type { Metadata } from "next";
import { cookies } from "next/headers";
import SessionSync from "@/components/SessionSync";
import { sessionVersionCookieName } from "@/lib/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "NSCT-U15BBC webapp",
  applicationName: "NSCT-U15BBC webapp",
  description: "バスケットボールチームの予定・出欠・請求・会計管理",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieName = sessionVersionCookieName();
  const version = (await cookies()).get(cookieName)?.value || "";
  return (
    <html
      lang="ja"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col"><SessionSync cookieName={cookieName} version={version} />{children}</body>
    </html>
  );
}
