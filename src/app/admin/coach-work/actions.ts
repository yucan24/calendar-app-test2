"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/auth";

function cleanText(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function isValidDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseNonNegativeInteger(
  value: FormDataEntryValue | null,
  label: string
) {
  const text = String(value ?? "").trim();

  if (!text) return 0;

  const number = Number(text);

  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${label}は0以上の整数で入力してください`);
  }

  return number;
}

function parseMinutes(
  formData: FormData,
  hourName: string,
  minuteName: string,
  label: string
) {
  const hours = parseNonNegativeInteger(formData.get(hourName), `${label}の時間`);
  const minutes = parseNonNegativeInteger(
    formData.get(minuteName),
    `${label}の分`
  );

  if (minutes >= 60) {
    throw new Error(`${label}の分は0〜59で入力してください`);
  }

  return hours * 60 + minutes;
}

async function assertCoachIdsInAdminGroup(
  coachIds: string[],
  groupId: string
) {
  if (coachIds.length === 0) {
    throw new Error("対象指導者を1人以上選択してください");
  }

  const { data: coaches, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("group_id", groupId)
    .eq("role", "admin")
    .in("id", coachIds);

  if (error) {
    throw new Error(error.message);
  }

  const foundIds = new Set((coaches ?? []).map((coach) => coach.id));

  for (const coachId of coachIds) {
    if (!foundIds.has(coachId)) {
      throw new Error("対象指導者に不正なユーザーが含まれています");
    }
  }
}

async function assertCoachWorkLogInAdminGroup(logId: string, groupId: string) {
  const { data: log, error } = await supabase
    .from("coach_work_logs")
    .select("id, group_id")
    .eq("id", logId)
    .single();

  if (error || !log) {
    throw new Error("勤怠記録が見つかりません");
  }

  if (log.group_id !== groupId) {
    throw new Error("この勤怠記録を操作する権限がありません");
  }
}

export async function createCoachWorkLogs(formData: FormData) {
  const admin = await requireAdmin();

  const workDate = cleanText(formData.get("work_date"));

  const coachIds = Array.from(
    new Set(
      formData
        .getAll("coach_ids")
        .map((value) => String(value).trim())
        .filter(Boolean)
    )
  );

  if (!isValidDate(workDate)) {
    throw new Error("指導日が不正です");
  }

  await assertCoachIdsInAdminGroup(coachIds, admin.group_id);

  const coachingMinutes = parseMinutes(
    formData,
    "coaching_hours",
    "coaching_minutes",
    "指導時間"
  );

  const adminMinutes = parseMinutes(
    formData,
    "admin_hours",
    "admin_minutes",
    "事務作業時間"
  );

  const travelExpense = parseNonNegativeInteger(
    formData.get("travel_expense"),
    "交通費"
  );

  const otherExpense = parseNonNegativeInteger(
    formData.get("other_expense"),
    "その他立替費用"
  );

  const note = cleanText(formData.get("note"));
  const batchId = crypto.randomUUID();

  const rows = coachIds.map((coachId) => ({
    batch_id: batchId,
    group_id: admin.group_id,
    coach_id: coachId,
    entered_by: admin.id,
    work_date: workDate,
    coaching_minutes: coachingMinutes,
    admin_minutes: adminMinutes,
    travel_expense: travelExpense,
    other_expense: otherExpense,
    note,
    status: "submitted",
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from("coach_work_logs").insert(rows);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/coach-work");
}

export async function updateCoachWorkLog(formData: FormData) {
  const admin = await requireAdmin();

  const logId = cleanText(formData.get("log_id"));
  const coachId = cleanText(formData.get("coach_id"));
  const workDate = cleanText(formData.get("work_date"));

  if (!logId) {
    throw new Error("勤怠記録IDが不明です");
  }

  if (!coachId) {
    throw new Error("対象指導者を選択してください");
  }

  if (!isValidDate(workDate)) {
    throw new Error("指導日が不正です");
  }

  await assertCoachWorkLogInAdminGroup(logId, admin.group_id);
  await assertCoachIdsInAdminGroup([coachId], admin.group_id);

  const coachingMinutes = parseMinutes(
    formData,
    "coaching_hours",
    "coaching_minutes",
    "指導時間"
  );

  const adminMinutes = parseMinutes(
    formData,
    "admin_hours",
    "admin_minutes",
    "事務作業時間"
  );

  const travelExpense = parseNonNegativeInteger(
    formData.get("travel_expense"),
    "交通費"
  );

  const otherExpense = parseNonNegativeInteger(
    formData.get("other_expense"),
    "その他立替費用"
  );

  const note = cleanText(formData.get("note"));

  const { error } = await supabase
    .from("coach_work_logs")
    .update({
      coach_id: coachId,
      work_date: workDate,
      coaching_minutes: coachingMinutes,
      admin_minutes: adminMinutes,
      travel_expense: travelExpense,
      other_expense: otherExpense,
      note,
      updated_at: new Date().toISOString(),
    })
    .eq("id", logId)
    .eq("group_id", admin.group_id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/coach-work");
}

export async function updateCoachWorkLogStatus(formData: FormData) {
  const admin = await requireAdmin();

  const logId = cleanText(formData.get("log_id"));
  const status = cleanText(formData.get("status"));

  if (!logId) {
    throw new Error("勤怠記録IDが不明です");
  }

  if (status !== "submitted" && status !== "approved") {
    throw new Error("状態が不正です");
  }

  await assertCoachWorkLogInAdminGroup(logId, admin.group_id);

  const { error } = await supabase
    .from("coach_work_logs")
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", logId)
    .eq("group_id", admin.group_id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/coach-work");
}