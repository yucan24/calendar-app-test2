"use client";
import { useActionState, type ReactNode } from "react";
import SubmitButton from "@/components/SubmitButton";
import { initialAccountState, type AccountState } from "@/lib/accountPolicy";
export default function AccountActionForm({ action, children, buttonText, danger = false, hideOnSuccess = false }: { action: (state: AccountState, form: FormData) => Promise<AccountState>; children: ReactNode; buttonText: string; danger?: boolean; hideOnSuccess?: boolean }) {
  const [state, submit] = useActionState(action, initialAccountState);
  return <form action={submit} className="space-y-3">
    {state.message && <p role="status" className={`rounded p-3 text-sm ${state.ok ? "bg-green-100 text-green-900" : "bg-red-100 text-red-900"}`}>{state.message}</p>}
    {state.url && <div className="rounded border p-3"><label className="block text-sm">本人への案内用リンク<input className="mt-1 w-full rounded border p-2" readOnly value={state.url} onFocus={e => e.currentTarget.select()} /></label><p className="mt-2 text-xs">この画面を閉じると再表示できません。第三者には共有しないでください。</p></div>}
    {!(hideOnSuccess && state.ok) && <>{children}<SubmitButton className={`rounded px-4 py-3 font-bold text-white ${danger ? "bg-red-700" : "bg-gray-900"}`}>{buttonText}</SubmitButton></>}
  </form>;
}
