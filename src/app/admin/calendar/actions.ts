"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/auth";

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
