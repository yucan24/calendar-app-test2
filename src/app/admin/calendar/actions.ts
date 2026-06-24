"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/auth";

function safeColor(value: string, fallback = "#111827") {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function toUtcISOStringFromDateKey(dateKey: string) {
  return new Date(`${dateKey}T00:00:00+09:00`).toISOString();
}

function validateDateKey(dateKey: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey);
}

export async function updateAdminCalendarAttendance(
  eventId: string,
  userId: string,
  status: string
) {
  const currentAdmin = await requireAdmin();

  if (!eventId || !userId) {
    throw new Error("必須項目が不足しています");
  }

  if (userId !== currentAdmin.id) {
    throw new Error("自分以外の出欠はこの画面から変更できません");
  }

  const { data: event, error: eventError } = await supabase
    .from("calendar_events")
    .select("id, group_id, attendance_required")
    .eq("id", eventId)
    .single();

  if (eventError || !event) {
    throw new Error("予定が見つかりません");
  }

  if (event.group_id !== currentAdmin.group_id) {
    throw new Error("この予定を変更する権限がありません");
  }

  if (!event.attendance_required) {
    throw new Error("この予定は出欠回答不要です");
  }

  if (!status) {
    const { error } = await supabase
      .from("event_responses")
      .delete()
      .eq("event_id", eventId)
      .eq("user_id", userId);

    if (error) {
      throw new Error(error.message);
    }

    revalidatePath("/admin/calendar");
    revalidatePath(`/admin/calendar/${eventId}`);
    return;
  }

  const { error } = await supabase.from("event_responses").upsert(
    {
      event_id: eventId,
      user_id: userId,
      status,
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
  revalidatePath(`/admin/calendar/${eventId}`);
}

export async function createAdminCalendarEventFromModal(input: {
  dateKey: string;
  title: string;
  description: string;
  location: string;
  timeText: string;
  isHoliday: boolean;
  attendanceRequired: boolean;
  isPeriod: boolean;
  titleColor: string;
  locationColor: string;
  timeColor: string;
}) {
  const currentAdmin = await requireAdmin();

  const dateKey = input.dateKey.trim();
  const title = input.title.trim();
  const description = input.description.trim();
  const location = input.location.trim();
  const timeText = input.timeText.trim();

  if (!validateDateKey(dateKey)) {
    throw new Error("日付が不正です");
  }

  if (!title) {
    throw new Error("予定名を入力してください");
  }

  const displayType = input.isPeriod ? "period" : "normal";
  const attendanceRequired = input.isPeriod ? false : input.attendanceRequired;

  const { error } = await supabase.from("calendar_events").insert({
    group_id: currentAdmin.group_id,
    created_by: currentAdmin.id,
    title,
    description,
    location,
    time_text: timeText,
    start_at: toUtcISOStringFromDateKey(dateKey),
    end_at: null,
    is_holiday: input.isHoliday,
    title_color: safeColor(input.titleColor),
    location_color: safeColor(input.locationColor),
    time_color: safeColor(input.timeColor),
    attendance_required: attendanceRequired,
    display_type: displayType,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/calendar");
}

export async function updateAdminCalendarEventFromModal(input: {
  eventId: string;
  dateKey: string;
  title: string;
  description: string;
  location: string;
  timeText: string;
  isHoliday: boolean;
  attendanceRequired: boolean;
  isPeriod: boolean;
  titleColor: string;
  locationColor: string;
  timeColor: string;
}) {
  const currentAdmin = await requireAdmin();

  const eventId = input.eventId.trim();
  const dateKey = input.dateKey.trim();
  const title = input.title.trim();
  const description = input.description.trim();
  const location = input.location.trim();
  const timeText = input.timeText.trim();

  if (!eventId) {
    throw new Error("予定IDが不明です");
  }

  if (!validateDateKey(dateKey)) {
    throw new Error("日付が不正です");
  }

  if (!title) {
    throw new Error("予定名を入力してください");
  }

  const { data: existingEvent, error: existingError } = await supabase
    .from("calendar_events")
    .select("id, group_id")
    .eq("id", eventId)
    .single();

  if (existingError || !existingEvent) {
    throw new Error("予定が見つかりません");
  }

  if (existingEvent.group_id !== currentAdmin.group_id) {
    throw new Error("この予定を編集する権限がありません");
  }

  const displayType = input.isPeriod ? "period" : "normal";
  const attendanceRequired = input.isPeriod ? false : input.attendanceRequired;

  const { error } = await supabase
    .from("calendar_events")
    .update({
      title,
      description,
      location,
      time_text: timeText,
      start_at: toUtcISOStringFromDateKey(dateKey),
      end_at: null,
      is_holiday: input.isHoliday,
      title_color: safeColor(input.titleColor),
      location_color: safeColor(input.locationColor),
      time_color: safeColor(input.timeColor),
      attendance_required: attendanceRequired,
      display_type: displayType,
      updated_at: new Date().toISOString(),
    })
    .eq("id", eventId)
    .eq("group_id", currentAdmin.group_id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/calendar");
  revalidatePath(`/admin/calendar/${eventId}`);
}

export async function createAdminCalendarEventsForDates(input: {
  dateKeys: string[];
  title: string;
  description: string;
  location: string;
  timeText: string;
  isHoliday: boolean;
  attendanceRequired: boolean;
  isPeriod: boolean;
  titleColor: string;
  locationColor: string;
  timeColor: string;
}) {
  const currentAdmin = await requireAdmin();

  const dateKeys = Array.from(new Set(input.dateKeys))
    .filter((dateKey) => validateDateKey(dateKey))
    .sort();

  const title = input.title.trim();
  const description = input.description.trim();
  const location = input.location.trim();
  const timeText = input.timeText.trim();

  if (dateKeys.length === 0) {
    throw new Error("日付が選択されていません");
  }

  if (!title) {
    throw new Error("予定名を入力してください");
  }

  const displayType = input.isPeriod ? "period" : "normal";
  const attendanceRequired = input.isPeriod ? false : input.attendanceRequired;

  const rows = dateKeys.map((dateKey) => ({
    group_id: currentAdmin.group_id,
    created_by: currentAdmin.id,
    title,
    description,
    location,
    time_text: timeText,
    start_at: toUtcISOStringFromDateKey(dateKey),
    end_at: null,
    is_holiday: input.isHoliday,
    title_color: safeColor(input.titleColor),
    location_color: safeColor(input.locationColor),
    time_color: safeColor(input.timeColor),
    attendance_required: attendanceRequired,
    display_type: displayType,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from("calendar_events").insert(rows);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/calendar");
}
