"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import SubmitButton from "@/components/SubmitButton";
import { accountStatusLabels } from "@/lib/accountPolicy";
import MemberProfileForm from "./MemberProfileForm";
import { filterMembers, memberFilters, type Member, type MemberNotice, type MemberListState } from "./memberView";

const initialState: MemberListState = { ok: false, message: "" };
const mailNames: Record<string, string> = { registration: "管理者への申請通知", approved: "承認のご案内", setup: "初期設定メール", reset: "再設定メール", admin_reset: "再設定メール", verify_email: "メール確認", email_change: "メール変更の確認" };

export default function MemberManagement({ memberAction, members, notices, adminId, testEnvironment, testInbox }: { memberAction: (previous: MemberListState, form: FormData) => Promise<MemberListState>; members: Member[]; notices: MemberNotice[]; adminId: string; testEnvironment: boolean; testInbox: string }) {
  const [state, action, pending] = useActionState(memberAction, initialState);
  const [filter, setFilter] = useState("all"), [search, setSearch] = useState("");
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => { if (state.message) feedback.current?.focus(); }, [state]);
  const visible = filterMembers(members, filter, search);
  const pendingCount = filterMembers(members, "pending", "").length;
  const lastMail = new Map(notices.map(notice => [notice.profile_id, notice]));

  function actionForm(member: Member, operation: string, intent: string, label: string, options: { danger?: boolean; children?: ReactNode } = {}) {
    return <form action={action} className="space-y-3">
      <input type="hidden" name="operation" value={operation} /><input type="hidden" name="member_id" value={member.id} /><input type="hidden" name="intent" value={intent} />
      {options.children}
      <SubmitButton disabled={pending} pendingText="処理中…" className={`ui-button w-full sm:w-auto ${options.danger ? "ui-button-danger" : "ui-button-primary"}`}>{label}</SubmitButton>
    </form>;
  }

  return <>
    {testEnvironment && <aside className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"><strong>テスト環境</strong><p>{testInbox ? <>メール宛先：<span className="break-all font-bold">{testInbox}</span></> : "メール送信停止中"}</p></aside>}

    <div ref={feedback} tabIndex={-1} role={state.ok ? "status" : "alert"} aria-live="polite" className={state.message ? `scroll-mt-6 space-y-3 rounded-xl border p-5 focus:outline-2 focus:outline-blue-600 ${state.ok ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-red-200 bg-red-50 text-red-950"}` : "sr-only"}>
      {state.message && <><p className="text-sm leading-6">{state.url ? "設定リンクを発行しました" : state.message}</p>
        {state.url && <div className="space-y-2 rounded-lg border bg-white p-3"><label className="block text-sm font-bold">設定リンク<input readOnly value={state.url} onFocus={event => event.currentTarget.select()} className="ui-field mt-2 w-full font-normal" /></label><p className="text-sm">有効期限30分・1回限り</p></div>}
        <button type="button" onClick={() => { setFilter("all"); setSearch(""); }} className="text-sm font-bold underline underline-offset-4">会員をすべて表示する</button>
      </>}
    </div>

    <section aria-labelledby="member-list-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="member-list-title" className="ui-section-title">会員一覧</h2>{pendingCount > 0 && <button type="button" onClick={() => { setFilter("pending"); setSearch(""); }} className="ui-button ui-button-primary bg-amber-100 text-amber-950">承認待ち {pendingCount}件 →</button>}</div>
      <label className="block"><span className="sr-only">名前・メールアドレスで会員を検索</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="名前・メールアドレスで検索" className="ui-field w-full" /></label>
      <div aria-label="会員の状態で絞り込み" className="flex flex-wrap gap-2">{memberFilters.map(item => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)} className="ui-tab">{item.label} <span className="ml-1 tabular-nums">{filterMembers(members, item.id, "").length}</span></button>)}</div>
      <p role="status" className="text-sm text-gray-600">{visible.length}人を表示{search && `（「${search}」で検索）`}</p>
      {visible.length === 0 && <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center"><p className="font-bold">該当する会員はいません</p></div>}
      <div className="space-y-4">{visible.map(member => {
        const self = member.id === adminId, status = member.account_status, notice = lastMail.get(member.id);
        const canSend = ["active", "invited"].includes(status);
        return <article key={member.id} id={`member-${member.id}`} className="ui-card space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words text-xl font-bold">{member.name}{self && <span className="ml-2 text-sm font-normal text-gray-500">自分</span>}</h3><p className="mt-1 break-all text-sm text-gray-600">{member.email || "メールアドレス未登録"}</p></div><div className="flex flex-wrap gap-2 text-xs font-bold"><span className={`rounded-full px-3 py-1 ${["pending", "review"].includes(status) ? "bg-amber-100 text-amber-950" : status === "active" ? "bg-emerald-100 text-emerald-950" : "bg-slate-100 text-slate-700"}`}>{status === "invited" ? "本人の設定待ち" : status === "review" ? "登録情報の確認が必要" : accountStatusLabels[status]}</span><span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">{member.role === "admin" ? "管理者" : "一般会員"}</span>{status === "active" && <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">{member.email_verified_at ? "メール確認済み" : "メール未確認"}</span>}</div></div>
          {notice && <div className={`rounded-lg p-3 text-sm leading-6 ${notice.delivery_status === "failed" ? "bg-red-50 text-red-900" : "bg-slate-50 text-gray-600"}`}><p>直近の案内：{mailNames[notice.kind] || "案内メール"} ／ {notice.delivery_status === "sent" ? "送信済み" : notice.delivery_status === "disabled" ? "送信停止中" : "送信に失敗しました"}</p>{notice.delivery_status === "failed" && !["suspended", "deleted"].includes(status) && <div className="mt-3">{actionForm(member, "mail", "retry_email", "失敗した案内を再送する")}</div>}</div>}
          {status !== "deleted" && (self ? <Link href="/account" className="ui-button ui-button-secondary">自分のアカウント設定 →</Link> : <>
            {["pending", "review"].includes(status) && actionForm(member, "manage", "approve", status === "pending" ? "承認・初期設定メール送信" : "利用許可・案内メール送信")}
            {status === "invited" && actionForm(member, "mail", "reset_email", "初期設定メールを再送")}
            {status === "suspended" && actionForm(member, "manage", "resume", "利用を再開")}
            <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              <details className="p-4"><summary className="cursor-pointer text-sm font-bold">登録情報を編集</summary><MemberProfileForm member={member} action={action} pending={pending} /></details>
              {canSend && <details className="p-4"><summary className="cursor-pointer text-sm font-bold">{status === "invited" ? "メールが使えない場合" : "4桁コードを再設定"}</summary><div className="mt-4 space-y-5">
                {status === "active" && actionForm(member, "mail", "reset_email", "再設定メールを送信")}
                {actionForm(member, "mail", "manual_reset", "設定リンクを発行", { children: <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="identity_confirmed" required className="mt-1 size-4" />本人確認済み</label> })}
              </div></details>}
              <details className="p-4"><summary className="cursor-pointer text-sm font-bold text-gray-700">利用停止・権限変更・会員削除</summary><div className="mt-4 space-y-5">
                {["active", "invited"].includes(status) && <div className="space-y-2">{actionForm(member, "manage", "suspend", "利用を停止", { danger: true })}</div>}
                <div className="space-y-2">{actionForm(member, "manage", member.role === "admin" ? "role_user" : "role_admin", member.role === "admin" ? "一般会員に変更" : "管理者に変更", { danger: true })}</div>
                <div className="space-y-3 border-t border-red-100 pt-4"><h4 className="text-sm font-bold text-red-800">会員を削除する</h4>{actionForm(member, "manage", "delete", "会員を削除", { danger: true, children: <label className="block text-sm font-bold">会員名を入力<input name="confirm_name" placeholder={member.name} required autoComplete="off" className="ui-field mt-2 w-full border-red-300 font-normal" /></label> })}</div>
              </div></details>
            </div>
          </>)}
        </article>;
      })}</div>
    </section>
  </>;
}
