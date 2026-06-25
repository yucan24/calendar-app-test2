import { requireUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import {
  getCurrentTargetMonth,
  getNextTargetMonth,
  getPrevTargetMonth,
  isValidTargetMonth,
} from "@/lib/month";
import UserCalendarClient from "./UserCalendarClient";

type PageProps = {
  searchParams?: Promise<{
    month?: string;
  }>;
};

type Profile = {
  id: string;
  name: string;
  email: string | null;
  role: "admin" | "user";
};

type CalendarEvent = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string | null;
  time_text: string | null;
  is_holiday: boolean;
  title_color: string | null;
  location_color: string | null;
  time_color: string | null;
  attendance_required: boolean;
  display_type: string | null;
};

type EventResponse = {
  id: string;
  event_id: string;
  user_id: string;
  status: "attend" | "absent" | "pending";
  note: string | null;
};

function getMonthStartDate(targetMonth: string) {
  return `${targetMonth}-01`;
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

export default async function UserCalendarPage({ searchParams }: PageProps) {
  const currentUser = await requireUser();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;

  const currentTargetMonth = getCurrentTargetMonth();

  const targetMonth =
    resolvedSearchParams?.month && isValidTargetMonth(resolvedSearchParams.month)
      ? resolvedSearchParams.month
      : currentTargetMonth;

  const prevMonth = getPrevTargetMonth(targetMonth);
  const nextMonth = getNextTargetMonth(targetMonth);

  const monthStart = getMonthStartDate(targetMonth);
  const monthEnd = getMonthStartDate(nextMonth);

  const monthStartIso = new Date(`${monthStart}T00:00:00+09:00`).toISOString();
  const monthEndIso = new Date(`${monthEnd}T00:00:00+09:00`).toISOString();

  const { data: events, error: eventsError } = await supabase
    .from("calendar_events")
    .select(
      "id, title, description, location, start_at, end_at, time_text, is_holiday, title_color, location_color, time_color, attendance_required, display_type"
    )
    .eq("group_id", currentUser.group_id)
    .gte("start_at", monthStartIso)
    .lt("start_at", monthEndIso)
    .order("start_at", { ascending: true })
    .order("created_at", { ascending: true });

  if (eventsError) {
    throw new Error(eventsError.message);
  }

  const eventIds = (events ?? []).map((event) => event.id);

  let responses: EventResponse[] = [];

  if (eventIds.length > 0) {
    const { data: responseData, error: responsesError } = await supabase
      .from("event_responses")
      .select("id, event_id, user_id, status, note")
      .in("event_id", eventIds);

    if (responsesError) {
      throw new Error(responsesError.message);
    }

    responses = (responseData ?? []) as EventResponse[];
  }

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, name, email, role")
    .eq("group_id", currentUser.group_id)
    .order("role", { ascending: true })
    .order("name", { ascending: true });

  if (profilesError) {
    throw new Error(profilesError.message);
  }

  return (
    <UserCalendarClient
      currentUser={{
        id: currentUser.id,
        name: currentUser.name,
      }}
      targetMonth={targetMonth}
      currentMonth={currentTargetMonth}
      prevMonth={prevMonth}
      nextMonth={nextMonth}
      todayKey={getTodayDateKey()}
      events={(events ?? []) as CalendarEvent[]}
      responses={responses}
      profiles={(profiles ?? []) as Profile[]}
    />
  );
}
