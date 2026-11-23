"use client";

import { useId, useRef, useState, useTransition } from "react";
import { formatYen } from "@/lib/month";
import type { ReminderRecipient, ReminderResult } from "@/lib/billingReminders";
import { previewBillingReminders, sendBillingReminder } from "./reminder-actions";

export default function BillingReminderPanel({ targetMonth }: { targetMonth: string }) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [recipients, setRecipients] = useState<ReminderRecipient[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, ReminderResult>>({});
  const [error, setError] = useState("");
  const [preparing, prepare] = useTransition();
  const [sending, send] = useTransition();
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const eligible = recipients.filter((person) => !person.unavailable && !results[person.id]);
  const outcomes = Object.values(results);
  const summary = [
    ["送信済み", outcomes.filter((result) => result.status === "sent").length],
    ["テスト受付", outcomes.filter((result) => result.status === "disabled").length],
    ["送信失敗", outcomes.filter((result) => result.status === "failed").length],
    ["要確認", outcomes.filter((result) => !["sent", "disabled", "failed"].includes(result.status)).length],
  ].filter(([, count]) => Number(count) > 0).map(([label, count]) => `${label} ${count}名`).join(" / ");
  function preview(form: FormData) {
    setError("");
    prepare(async () => {
      try {
      const result = await previewBillingReminders(form);
      if (!result.ok) { setError(result.message); return; }
      setRecipients(result.recipients);
      setSelected(new Set(result.recipients.filter((person) => !person.unavailable).map((person) => person.id)));
      setResults({}); setProgress({ done: 0, total: 0 });
      dialog.current?.showModal();
      } catch { setError("宛先を取得できませんでした。通信状態を確認してください。"); }
    });
  }
  function deliver() {
    const targets = eligible.filter((person) => selected.has(person.id));
    if (!targets.length || sending) return;
    setProgress({ done: 0, total: targets.length });
    send(async () => {
      for (const [index, person] of targets.entries()) {
        let result: ReminderResult;
        try { result = await sendBillingReminder(person.request); }
        catch { result = { status: "unknown", message: "送信結果を確認できませんでした。" }; }
        setResults((previous) => ({ ...previous, [person.id]: result }));
        setProgress({ done: index + 1, total: targets.length });
      }
      setSelected(new Set());
    });
  }
  return <section className="ui-card mt-6">
    <h2 className="ui-section-title">未払いメール</h2>
    <form action={preview} className="mt-4 grid min-w-0 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <label className="min-w-0 text-sm font-bold">対象月まで<input name="month" type="month" required defaultValue={targetMonth} className="ui-field mt-1" /></label>
      <label className="min-w-0 text-sm font-bold">費目<select name="category" className="ui-field mt-1" defaultValue="tuition"><option value="tuition">月謝</option><option value="all">すべての請求</option></select></label>
      <button disabled={preparing} className="ui-button ui-button-primary">{preparing ? "確認中…" : "宛先を確認"}</button>
    </form>
    {error && <p role="alert" className="mt-3 text-sm font-bold text-red-700">{error}</p>}
    <dialog ref={dialog} aria-labelledby={titleId} className="ui-dialog" onCancel={(event) => { if (sending) event.preventDefault(); }}>
      <div className="flex items-center justify-between gap-3"><h3 id={titleId} className="ui-section-title">送信内容の確認</h3><button type="button" disabled={sending} onClick={() => dialog.current?.close()} className="ui-icon-button" aria-label="閉じる">×</button></div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <label className="flex min-h-11 items-center gap-2 text-sm font-bold"><input type="checkbox" disabled={sending || !eligible.length} checked={eligible.length > 0 && eligible.every((person) => selected.has(person.id))} onChange={(event) => setSelected(event.target.checked ? new Set(eligible.map((person) => person.id)) : new Set())} />すべて選択</label>
        <span className="text-sm font-bold">{selected.size}名</span>
      </div>
      {!recipients.length && <p className="py-8 text-center font-bold text-gray-600">未払いの会員はいません</p>}
      <ul className="mt-2 space-y-3">
        {recipients.map((person) => <li key={person.id} className="min-w-0 rounded-xl border border-gray-200 p-3">
          <label className="flex min-h-11 items-start gap-3"><input type="checkbox" className="mt-1.5" disabled={sending || Boolean(person.unavailable) || Boolean(results[person.id])} checked={selected.has(person.id)} onChange={(event) => setSelected((previous) => { const next = new Set(previous); if (event.target.checked) next.add(person.id); else next.delete(person.id); return next; })} /><span className="min-w-0 flex-1"><span className="block break-words font-bold">{person.name}</span><span className="block break-all text-sm text-gray-600">{person.email || "メール未登録"}</span><span className="mt-1 block font-bold">{formatYen(person.total)}</span></span></label>
          {person.unavailable && <p className="mt-2 text-sm font-bold text-amber-800">{person.unavailable}</p>}
          {person.lastDelivery && <p className="mt-2 text-xs text-gray-600">{person.lastDelivery.status === "sent" ? "最終送信" : person.lastDelivery.status === "failed" ? "前回送信失敗" : "前回テスト"} {new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tokyo" }).format(new Date(person.lastDelivery.at))}</p>}
          {results[person.id] && <p role="status" className={`mt-2 text-sm font-bold ${results[person.id].status === "sent" || results[person.id].status === "disabled" ? "text-green-800" : "text-amber-800"}`}>{results[person.id].message}</p>}
          <details className="mt-2 text-sm"><summary className="cursor-pointer py-2 font-bold text-blue-700">本文を確認</summary><p className="mt-2 break-words font-bold">{person.subject}</p><p className="mt-2 whitespace-pre-wrap break-words leading-relaxed text-gray-700">{person.text}</p></details>
        </li>)}
      </ul>
      <div className="sticky bottom-0 -mx-4 mt-4 flex flex-col gap-2 border-t border-gray-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-end">
        {progress.total > 0 && <p role="status" className="text-sm font-bold">{sending ? `送信中 ${progress.done} / ${progress.total}` : summary}</p>}
        <button type="button" onClick={deliver} disabled={sending || !selected.size} className="ui-button ui-button-primary">{sending ? "送信中…" : selected.size ? `${selected.size}名に送信` : progress.total ? "処理済み" : "送信"}</button>
        <button type="button" onClick={() => dialog.current?.close()} disabled={sending} className="ui-button ui-button-secondary">閉じる</button>
      </div>
    </dialog>
  </section>;
}
