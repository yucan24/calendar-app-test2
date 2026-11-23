"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isValidDate, getJstDateKey } from "@/lib/month";
import { supabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/auth";

export async function updateAdminAttendance(
  eventId: string,
  userId: string,
  status: string,
  note = ""
) {
  const admin = await requireAdmin();
  if (!eventId || !userId) {
    throw new Error("必須項目が不足しています");
  }

  if (!["", "attend", "absent", "pending"].includes(status)) throw new Error("出欠の値が不正です");
  const [{ data: event, error: eventError }, { data: member, error: memberError }] = await Promise.all([
    supabase.from("calendar_events").select("id, attendance_required, display_type")
      .eq("id", eventId).eq("group_id", admin.group_id).maybeSingle(),
    supabase.from("profiles").select("id").eq("id", userId).eq("group_id", admin.group_id).maybeSingle(),
  ]);
  if (eventError || memberError || !event || !member) throw new Error("この出欠を操作する権限がありません");
  if (!event.attendance_required || event.display_type === "period") throw new Error("この予定は出欠回答不要です");

  // 未回答に戻す場合は、回答レコードを削除する
  if (!status) {
    const { error } = await supabase
      .from("event_responses")
      .delete()
      .eq("event_id", eventId)
      .eq("user_id", userId);

    if (error) {
      throw new Error(error.message);
    }

    revalidatePath(`/admin/calendar/${eventId}`);
    revalidatePath("/admin/calendar");
    return;
  }

  const { error } = await supabase.from("event_responses").upsert(
    {
      event_id: eventId,
      user_id: userId,
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

  revalidatePath(`/admin/calendar/${eventId}`);
  revalidatePath("/admin/calendar");
}


function safeColor(value: FormDataEntryValue | null, fallback = "#000000") {
  const text = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text : fallback;
}

export async function updateEvent(formData: FormData) {
  "use server";

  const admin = await requireAdmin();

  const id = String(formData.get("id"));
  const date = String(formData.get("date"));
  const title = String(formData.get("title"));
  const description = String(formData.get("description") ?? "");
  const location = String(formData.get("location") ?? "");
  const timeText = String(formData.get("time_text") ?? "");
  const isHoliday = formData.get("is_holiday") === "on";
  const isPeriod = formData.get("display_type_period") === "on";

  const attendanceRequired = isPeriod
    ? false
    : formData.get("attendance_required") === "on";

  const displayType = isPeriod ? "period" : "normal";

  const titleColor = safeColor(formData.get("title_color"));
  const locationColor = safeColor(formData.get("location_color"));
  const timeColor = safeColor(formData.get("time_color"));

  if (!id || !isValidDate(date) || !title) {
    throw new Error("必須項目が不足しています");
  }

  const startAt = new Date(`${date}T00:00:00+09:00`).toISOString();

  const { data: updated, error } = await supabase
    .from("calendar_events")
    .update({
      title,
      description,
      location,
      time_text: timeText,
      start_at: startAt,
      end_at: null,
      is_holiday: isHoliday,
      title_color: titleColor,
      location_color: locationColor,
      time_color: timeColor,
      attendance_required: attendanceRequired,
      display_type: displayType,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("group_id", admin.group_id)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!updated) throw new Error("この予定を操作する権限がありません");

  revalidatePath(`/admin/calendar/${id}`);
  revalidatePath("/admin/calendar");
  redirect(`/admin/calendar/${id}`);
}

export async function deleteEvent(formData: FormData) {
  "use server";

  const admin = await requireAdmin();

  const id = String(formData.get("id"));

  if (!id) {
    throw new Error("削除対象が不明です");
  }

  const { data: event, error: eventError } = await supabase
    .from("calendar_events").select("id,start_at")
    .eq("id", id).eq("group_id", admin.group_id).maybeSingle();
  if (eventError) throw new Error(eventError.message);
  if (!event) redirect("/admin/calendar");
  const targetMonth = getJstDateKey(event.start_at).slice(0, 7);

  const { error } = await supabase
    .from("calendar_events")
    .delete()
    .eq("id", id)
    .eq("group_id", admin.group_id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/calendar");
  redirect(`/admin/calendar?month=${targetMonth}`);
}
