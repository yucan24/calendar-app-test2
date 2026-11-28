import { requireAdmin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/pagination";
import { getJstDateKey } from "@/lib/month";
import { addCalendarDays, getCalendarDays, getCalendarPeriodUtcRange, getCalendarUtcRange, resolveCalendarSelection, type CalendarSearchParams } from "@/lib/calendar";
import CoachWorkCalendarClient, { type Coach, type CoachWorkLog, type CalendarEvent } from "./CoachWorkCalendarClient";

type PageProps = { searchParams?: Promise<CalendarSearchParams> };
type StoredCoach = Coach & { role: string; login_enabled: boolean; account_status: string };

export default async function AdminCoachWorkPage({ searchParams }: PageProps) {
  const admin = await requireAdmin();
  const todayKey = getJstDateKey(new Date().toISOString());
  const { targetMonth, view, anchorDate } = resolveCalendarSelection(searchParams ? await searchParams : undefined, todayKey);
  // 月間集計と登録詳細は、日・週表示でも対象月全体を使う。
  // 月の格子に見える前後の日付も取得するが、月間集計には混ぜない。
  const monthDays = getCalendarDays(targetMonth, "month", anchorDate).filter(day => day.valid);
  const logStart = monthDays[0].dateKey;
  const logEnd = addCalendarDays(monthDays[monthDays.length - 1].dateKey, 1);
  const range = getCalendarUtcRange(targetMonth, "month", anchorDate);
  const periodRange = getCalendarPeriodUtcRange(targetMonth, "month", anchorDate);
  const eventColumns = "id, title, description, location, start_at, end_at, time_text, is_holiday, title_color, location_color, time_color, attendance_required, display_type";

  const [coachesResult, logsResult, eventsResult, periodsResult] = await Promise.all([
    fetchAllRows<StoredCoach>((from, to) => supabase.from("profiles")
      .select("id, name, email, role, login_enabled, account_status")
      .eq("group_id", admin.group_id).eq("accounting_coach", true)
      .order("name", { ascending: true }).order("id", { ascending: true }).range(from, to)),
    fetchAllRows<CoachWorkLog>((from, to) => supabase.from("coach_work_logs")
      .select("id, batch_id, coach_id, entered_by, work_date, coaching_minutes, admin_minutes, travel_expense, other_expense, note, created_at, updated_at")
      .eq("group_id", admin.group_id).gte("work_date", logStart).lt("work_date", logEnd)
      .order("work_date", { ascending: false }).order("created_at", { ascending: false }).order("id", { ascending: true }).range(from, to)),
    fetchAllRows<CalendarEvent>((from, to) => supabase.from("calendar_events").select(eventColumns)
      .eq("group_id", admin.group_id).gte("start_at", range.startIso).lt("start_at", range.endIso)
      .order("start_at", { ascending: true }).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to)),
    fetchAllRows<CalendarEvent>((from, to) => supabase.from("calendar_events").select(eventColumns)
      .eq("group_id", admin.group_id).eq("attendance_required", false)
      .gte("start_at", periodRange.startIso).lt("start_at", periodRange.endIso)
      .order("start_at", { ascending: true }).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to)),
  ]);
  for (const result of [coachesResult, logsResult, eventsResult, periodsResult]) if (result.error) throw new Error(result.error.message);
  const events = Array.from(new Map([...(eventsResult.data ?? []), ...(periodsResult.data ?? [])].map(event => [event.id, event])).values());

  return <CoachWorkCalendarClient key={`${view}:${anchorDate}`}
    currentAdmin={{ id: admin.id, name: admin.name }} targetMonth={targetMonth} view={view} anchorDate={anchorDate} todayKey={todayKey}
    coaches={(coachesResult.data ?? []).map(coach => ({ ...coach, can_record: coach.role === "admin" && coach.login_enabled && coach.account_status === "active" }))}
    logs={logsResult.data ?? []} events={events}
  />;
}
