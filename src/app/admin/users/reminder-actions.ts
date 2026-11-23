"use server";

import { requireAdmin } from "@/lib/auth";
import { prepareReminders, deliverReminder, type ReminderFilter, type ReminderRecipient, type ReminderRequest, type ReminderResult } from "@/lib/billingReminders";

export async function previewBillingReminders(form: FormData): Promise<{ ok: boolean; message: string; recipients: ReminderRecipient[] }> {
  const admin = await requireAdmin();
  const filter = { month: String(form.get("month") ?? ""), category: String(form.get("category") ?? "") } as ReminderFilter;
  try { return { ok: true, message: "", recipients: await prepareReminders(admin, filter) }; }
  catch { return { ok: false, message: "宛先を取得できませんでした。対象月・費目を確認してお試しください。", recipients: [] }; }
}

export async function sendBillingReminder(request: ReminderRequest): Promise<ReminderResult> {
  const admin = await requireAdmin();
  try { return await deliverReminder(admin, request); }
  catch { return { status: "blocked", message: "送信状況を確認できませんでした。時間をおいてお試しください。" }; }
}
