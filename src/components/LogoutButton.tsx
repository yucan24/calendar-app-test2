"use client";

import { logout } from "@/app/logout/actions";
import SubmitButton from "@/components/SubmitButton";

export default function LogoutButton({ className = "rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900" }: { className?: string }) {
  return <form action={logout}>
    <SubmitButton pendingText="ログアウト中…" className={className}>ログアウト</SubmitButton>
  </form>;
}
