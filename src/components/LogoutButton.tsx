"use client";

import { logout } from "@/app/logout/actions";
import SubmitButton from "@/components/SubmitButton";

export default function LogoutButton({ className = "ui-button ui-button-secondary" }: { className?: string }) {
  return <form action={logout}>
    <SubmitButton pendingText="ログアウト中…" className={className}>ログアウト</SubmitButton>
  </form>;
}
