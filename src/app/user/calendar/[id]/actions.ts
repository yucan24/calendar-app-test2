"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";

export async function submitResponse(formData: FormData) {
  "use server";

  const user = await requireUser();

  const eventId = String(formData.get("event_id"));
  const userId = user.id;
  const status = String(formData.get("status") ?? "");
  const note = String(formData.get("note") ?? "");

  if (!eventId || !userId) {
    throw new Error("必須項目が不足しています");
  }

  if (!["", "attend", "absent", "pending"].includes(status)) throw new Error("出欠の値が不正です");
  const { data: event, error: eventError } = await supabase.from("calendar_events")
    .select("id, attendance_required, display_type").eq("id", eventId).eq("group_id", user.group_id).maybeSingle();
  if (eventError || !event) throw new Error("この予定を操作する権限がありません");
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

    revalidatePath(`/user/calendar/${eventId}`);
    revalidatePath("/user/calendar");
    redirect(`/user/calendar/${eventId}`);
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

  revalidatePath(`/user/calendar/${eventId}`);
  revalidatePath("/user/calendar");
  redirect(`/user/calendar/${eventId}`);
}

