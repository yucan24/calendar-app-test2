"use server";

import { randomUUID } from "crypto";
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

function parseHoursToMinutes(
  formData: FormData,
  fieldName: string,
  label: string
) {
  const hours = parseNonNegativeInteger(formData.get(fieldName), label);
  return hours * 60;
}

function getCoachIds(formData: FormData) {
  return Array.from(
    new Set(
      formData
        .getAll("coach_ids")
        .map((value) => String(value).trim())
        .filter(Boolean)
    )
  );
}

function getDateKeys(formData: FormData) {
  return Array.from(
    new Set(
      formData
        .getAll("date_keys")
        .map((value) => String(value).trim())
        .filter(Boolean)
    )
  ).sort();
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

async function insertCoachWorkRows(input: {
  formData: FormData;
  dateKeys: string[];
}) {
  const admin = await requireAdmin();
  const dateKeys = input.dateKeys;

  if (dateKeys.length === 0) {
    throw new Error("日付を1日以上選択してください");
  }

  for (const dateKey of dateKeys) {
    if (!isValidDate(dateKey)) {
      throw new Error("日付が不正です");
    }
  }

  const coachIds = getCoachIds(input.formData);
  await assertCoachIdsInAdminGroup(coachIds, admin.group_id);

  const coachingMinutes = parseHoursToMinutes(
    input.formData,
    "coaching_hours",
    "指導時間"
  );

  const adminMinutes = parseHoursToMinutes(
    input.formData,
    "admin_hours",
    "事務作業時間"
  );

  const travelExpense = parseNonNegativeInteger(
    input.formData.get("travel_expense"),
    "交通費"
  );

  const otherExpense = parseNonNegativeInteger(
    input.formData.get("other_expense"),
    "その他立替費用"
  );

  const note = cleanText(input.formData.get("note"));
  const batchId = randomUUID();

  const rows = dateKeys.flatMap((dateKey) =>
    coachIds.map((coachId) => ({
      batch_id: batchId,
      group_id: admin.group_id,
      coach_id: coachId,
      entered_by: admin.id,
      work_date: dateKey,
      coaching_minutes: coachingMinutes,
      admin_minutes: adminMinutes,
      travel_expense: travelExpense,
      other_expense: otherExpense,
      note,
      updated_at: new Date().toISOString(),
    }))
  );

  const { error } = await supabase.from("coach_work_logs").insert(rows);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/coach-work");
}

export async function createCoachWorkLogs(formData: FormData) {
  const workDate = cleanText(formData.get("work_date"));

  await insertCoachWorkRows({
    formData,
    dateKeys: [workDate],
  });
}

export async function createCoachWorkLogsForDates(formData: FormData) {
  const dateKeys = getDateKeys(formData);

  await insertCoachWorkRows({
    formData,
    dateKeys,
  });
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

  const coachingMinutes = parseHoursToMinutes(
    formData,
    "coaching_hours",
    "指導時間"
  );

  const adminMinutes = parseHoursToMinutes(
    formData,
    "admin_hours",
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

export async function deleteCoachWorkLog(formData: FormData) {
  const admin = await requireAdmin();

  const logId = cleanText(formData.get("log_id"));

  if (!logId) {
    throw new Error("勤怠記録IDが不明です");
  }

  await assertCoachWorkLogInAdminGroup(logId, admin.group_id);

  const { error } = await supabase
    .from("coach_work_logs")
    .delete()
    .eq("id", logId)
    .eq("group_id", admin.group_id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/coach-work");
}