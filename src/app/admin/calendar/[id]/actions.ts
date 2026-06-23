"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";

export async function updateAdminAttendance(
  eventId: string,
  userId: string,
  status: string,
  note = ""
) {
  if (!eventId || !userId) {
    throw new Error("必須項目が不足しています");
  }

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