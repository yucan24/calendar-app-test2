"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";

type AttendanceInput =
  | FormData
  | {
      eventId?: string;
      event_id?: string;
      status?: string;
      note?: string;
    };

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function getInputValue(input: AttendanceInput, key: string) {
  if (input instanceof FormData) {
    return cleanText(input.get(key));
  }

  return cleanText(input[key as keyof AttendanceInput]);
}

function getEventId(input: AttendanceInput) {
  const eventId = getInputValue(input, "eventId");
  const eventIdSnake = getInputValue(input, "event_id");

  return eventId || eventIdSnake;
}

function validateStatus(value: string) {
  if (value === "attend" || value === "absent" || value === "pending") {
    return value;
  }

  throw new Error("出欠の値が不正です");
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

  if (event.display_type === "period") {
    throw new Error("期間予定には出欠回答できません");
  }

  if (!event.attendance_required) {
    throw new Error("この予定は出欠回答不要です");
  }

  return event;
}

export async function updateUserCalendarAttendance(input: AttendanceInput) {
  const user = await requireUser();

  const eventId = getEventId(input);
  const status = validateStatus(getInputValue(input, "status"));
  const note = getInputValue(input, "note");

  await getEventOrThrow(eventId, user.group_id);

  const { error } = await supabase.from("event_responses").upsert(
    {
      event_id: eventId,
      user_id: user.id,
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

  revalidatePath("/user/calendar");
  revalidatePath("/admin/calendar");
}
