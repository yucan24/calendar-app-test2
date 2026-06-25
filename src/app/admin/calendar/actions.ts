"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/auth";

type AttendanceStatus = "attend" | "absent" | "pending";

type AttendanceObjectInput = {
  eventId?: string;
  event_id?: string;
  status?: string;
  note?: string;
};

type AttendanceInput = FormData | AttendanceObjectInput;

type EventObjectInput = {
  [key: string]: unknown;

  eventId?: string;
  event_id?: string;

  dateKey?: string;
  date_key?: string;
  date?: string;

  title?: string;
  description?: string;
  location?: string;

  timeText?: string;
  time_text?: string;

  isHoliday?: boolean | string;
  is_holiday?: boolean | string;

  titleColor?: string;
  title_color?: string;
  locationColor?: string;
  location_color?: string;
  timeColor?: string;
  time_color?: string;

  attendanceRequired?: boolean | string;
  attendance_required?: boolean | string;

  displayType?: string;
  display_type?: string;
};

type EventInput = FormData | EventObjectInput;

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function getInputValue(input: AttendanceInput | EventInput, key: string) {
  if (input instanceof FormData) {
    return cleanText(input.get(key));
  }

  return cleanText(input[key]);
}

function getRawValue(input: EventInput, key: string) {
  if (input instanceof FormData) {
    return input.get(key);
  }

  return input[key];
}

function hasInputKey(input: EventInput, key: string) {
  if (input instanceof FormData) {
    return input.has(key);
  }

  return Object.prototype.hasOwnProperty.call(input, key);
}

function getBooleanValue(
  input: EventInput,
  keys: string[],
  defaultValue: boolean
) {
  for (const key of keys) {
    if (!hasInputKey(input, key)) continue;

    const raw = getRawValue(input, key);

    if (typeof raw === "boolean") return raw;

    const value = cleanText(raw).toLowerCase();

    if (value === "true" || value === "1" || value === "on" || value === "yes") {
      return true;
    }

    if (
      value === "false" ||
      value === "0" ||
      value === "off" ||
      value === "no" ||
      value === ""
    ) {
      return false;
    }
  }

  return defaultValue;
}

function getEventId(input: AttendanceInput | EventInput) {
  return (
    getInputValue(input, "eventId") ||
    getInputValue(input, "event_id") ||
    getInputValue(input, "id")
  );
}

function validateStatus(value: string): AttendanceStatus {
  if (value === "attend" || value === "absent" || value === "pending") {
    return value;
  }

  throw new Error("出欠の値が不正です");
}

function isValidDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toUtcISOStringFromDateKey(dateKey: string) {
  if (!isValidDateKey(dateKey)) {
    throw new Error("日付が不正です");
  }

  return new Date(`${dateKey}T00:00:00+09:00`).toISOString();
}

function safeColor(value: string, fallback = "#000000") {
  if (/^#[0-9a-fA-F]{6}$/.test(value)) {
    return value;
  }

  return fallback;
}

function normalizeDisplayType(value: string) {
  if (value === "period") return "period";
  return "normal";
}

function getDateKey(input: EventInput) {
  const dateKey =
    getInputValue(input, "dateKey") ||
    getInputValue(input, "date_key") ||
    getInputValue(input, "date") ||
    getInputValue(input, "start_date");

  if (!isValidDateKey(dateKey)) {
    throw new Error("予定日が不正です");
  }

  return dateKey;
}

function getDateKeys(input: EventInput) {
  if (input instanceof FormData) {
    const values = input
      .getAll("date_keys")
      .map((value) => cleanText(value))
      .filter(Boolean);

    if (values.length > 0) {
      return Array.from(new Set(values)).sort();
    }

    const singleDate = getDateKey(input);
    return [singleDate];
  }

  const rawDateKeys = input.dateKeys;

  if (Array.isArray(rawDateKeys)) {
    return Array.from(new Set(rawDateKeys.map(cleanText).filter(Boolean))).sort();
  }

  return [getDateKey(input)];
}

function buildEventPayload(input: EventInput, adminId: string) {
  const dateKey = getDateKey(input);

  const title = getInputValue(input, "title");
  const description = getInputValue(input, "description");
  const location = getInputValue(input, "location");
  const timeText =
    getInputValue(input, "timeText") || getInputValue(input, "time_text");

  const titleColor =
    getInputValue(input, "titleColor") || getInputValue(input, "title_color");
  const locationColor =
    getInputValue(input, "locationColor") ||
    getInputValue(input, "location_color");
  const timeColor =
    getInputValue(input, "timeColor") || getInputValue(input, "time_color");

  const displayType = normalizeDisplayType(
    getInputValue(input, "displayType") || getInputValue(input, "display_type")
  );

  const isPeriod = displayType === "period";

  const attendanceRequired = isPeriod
    ? false
    : getBooleanValue(input, ["attendanceRequired", "attendance_required"], true);

  if (!title) {
    throw new Error("予定名を入力してください");
  }

  return {
    title,
    description: description || null,
    location: location || null,
    time_text: timeText || null,
    start_at: toUtcISOStringFromDateKey(dateKey),
    end_at: null,
    is_holiday: getBooleanValue(input, ["isHoliday", "is_holiday"], false),
    title_color: safeColor(titleColor || "#000000"),
    location_color: safeColor(locationColor || "#000000"),
    time_color: safeColor(timeColor || "#000000"),
    attendance_required: attendanceRequired,
    display_type: displayType,
    created_by: adminId,
    updated_at: new Date().toISOString(),
  };
}

async function getEventOrThrow(eventId: string, groupId: string) {
  if (!eventId) {
    throw new Error("予定IDが不明です");
  }

  const { data: event, error } = await supabase
    .from("calendar_events")
    .select("id, group_id, attendance_required, display_type")
    .eq("id", eventId)
    .single();

  if (error || !event) {
    throw new Error("予定が見つかりません");
  }

  if (event.group_id !== groupId) {
    throw new Error("この予定を操作する権限がありません");
  }

  return event;
}

/**
 * 管理者・指導者側の出欠保存。
 *
 * 重要：
 * user_id はクライアントから受け取らず、ログイン中の管理者IDを使う。
 * これで eventId / status / note の引数ズレによるエラーを防ぐ。
 */
export async function updateAdminCalendarAttendance(
  input: AttendanceInput | string,
  statusArg?: string,
  noteArg?: string
) {
  const admin = await requireAdmin();

  const eventId =
    typeof input === "string"
      ? cleanText(input)
      : getEventId(input);

  const status =
    typeof input === "string"
      ? validateStatus(cleanText(statusArg))
      : validateStatus(getInputValue(input, "status"));

  const note =
    typeof input === "string"
      ? cleanText(noteArg)
      : getInputValue(input, "note");

  const event = await getEventOrThrow(eventId, admin.group_id);

  if (event.display_type === "period") {
    throw new Error("期間予定には出欠回答できません");
  }

  if (!event.attendance_required) {
    throw new Error("この予定は出欠回答不要です");
  }

  const { error } = await supabase.from("event_responses").upsert(
    {
      event_id: eventId,
      user_id: admin.id,
      status,
      note,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "event_id,user_id",
    }
  );

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/calendar");
  revalidatePath("/user/calendar");
}

export async function createAdminCalendarEventFromModal(input: EventInput) {
  const admin = await requireAdmin();

  const payload = buildEventPayload(input, admin.id);

  const { error } = await supabase.from("calendar_events").insert({
    ...payload,
    group_id: admin.group_id,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/calendar");
  revalidatePath("/user/calendar");
}

export async function updateAdminCalendarEventFromModal(input: EventInput) {
  const admin = await requireAdmin();

  const eventId = getEventId(input);

  await getEventOrThrow(eventId, admin.group_id);

  const payload = buildEventPayload(input, admin.id);

  const { error } = await supabase
    .from("calendar_events")
    .update({
      title: payload.title,
      description: payload.description,
      location: payload.location,
      time_text: payload.time_text,
      start_at: payload.start_at,
      end_at: payload.end_at,
      is_holiday: payload.is_holiday,
      title_color: payload.title_color,
      location_color: payload.location_color,
      time_color: payload.time_color,
      attendance_required: payload.attendance_required,
      display_type: payload.display_type,
      updated_at: payload.updated_at,
    })
    .eq("id", eventId)
    .eq("group_id", admin.group_id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/calendar");
  revalidatePath("/user/calendar");
}

export async function createAdminCalendarEventsForDates(input: EventInput) {
  const admin = await requireAdmin();

  const dateKeys = getDateKeys(input);

  if (dateKeys.length === 0) {
    throw new Error("日付を1日以上選択してください");
  }

  const rows = dateKeys.map((dateKey) => {
    const payload = buildEventPayload(
      input instanceof FormData
        ? (() => {
            const formData = new FormData();

            for (const [key, value] of input.entries()) {
              formData.append(key, value);
            }

            formData.set("date_key", dateKey);
            return formData;
          })()
        : {
            ...input,
            dateKey,
            date_key: dateKey,
          },
      admin.id
    );

    return {
      ...payload,
      group_id: admin.group_id,
    };
  });

  const { error } = await supabase.from("calendar_events").insert(rows);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/calendar");
  revalidatePath("/user/calendar");
}
