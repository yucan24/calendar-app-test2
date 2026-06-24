import { requireAdmin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import {
  getCurrentTargetMonth,
  getNextTargetMonth,
  getPrevTargetMonth,
  isValidTargetMonth,
} from "@/lib/month";
import CoachWorkCalendarClient from "./CoachWorkCalendarClient";

type PageProps = {
  searchParams?: Promise<{
    month?: string;
  }>;
};

function getMonthStartDate(targetMonth: string) {
  return `${targetMonth}-01`;
}

function toUtcIsoFromDateKey(dateKey: string) {
  return new Date(`${dateKey}T00:00:00+09:00`).toISOString();
}

function getTodayDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

export default async function AdminCoachWorkPage({ searchParams }: PageProps) {
  const admin = await requireAdmin();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;

  const currentMonth = getCurrentTargetMonth();

  const targetMonth =
    resolvedSearchParams?.month && isValidTargetMonth(resolvedSearchParams.month)
      ? resolvedSearchParams.month
      : currentMonth;

  const prevMonth = getPrevTargetMonth(targetMonth);
  const nextMonth = getNextTargetMonth(targetMonth);

  const monthStart = getMonthStartDate(targetMonth);
  const monthEnd = getMonthStartDate(nextMonth);

  const { data: coaches, error: coachesError } = await supabase
    .from("profiles")
    .select("id, name, email")
    .eq("group_id", admin.group_id)
    .eq("role", "admin")
    .eq("login_enabled", true)
    .order("name", { ascending: true });

  if (coachesError) {
    throw new Error(coachesError.message);
  }

  const { data: logs, error: logsError } = await supabase
    .from("coach_work_logs")
    .select(
      "id, batch_id, coach_id, entered_by, work_date, coaching_minutes, admin_minutes, travel_expense, other_expense, note, created_at, updated_at"
    )
    .eq("group_id", admin.group_id)
    .gte("work_date", monthStart)
    .lt("work_date", monthEnd)
    .order("work_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (logsError) {
    throw new Error(logsError.message);
  }

  const { data: events, error: eventsError } = await supabase
    .from("calendar_events")
    .select(
      "id, title, description, location, time_text, start_at, is_holiday, title_color, location_color, time_color, attendance_required, display_type"
    )
    .eq("group_id", admin.group_id)
    .gte("start_at", toUtcIsoFromDateKey(monthStart))
    .lt("start_at", toUtcIsoFromDateKey(monthEnd))
    .order("start_at", { ascending: true });

  if (eventsError) {
    throw new Error(eventsError.message);
  }

  return (
    <CoachWorkCalendarClient
      currentAdmin={{
        id: admin.id,
        name: admin.name,
      }}
      targetMonth={targetMonth}
      currentMonth={currentMonth}
      prevMonth={prevMonth}
      nextMonth={nextMonth}
      todayKey={getTodayDateKey()}
      coaches={coaches ?? []}
      logs={logs ?? []}
      events={events ?? []}
    />
  );
}