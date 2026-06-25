import { supabase } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import UserCalendarClient from "./UserCalendarClient";

type CalendarEvent = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  time_text: string | null;
  start_at: string;
  is_holiday: boolean;
  title_color: string | null;
  location_color: string | null;
  time_color: string | null;
  attendance_required: boolean;
  display_type: string;
};

type EventResponse = {
  id: string;
  event_id: string;
  user_id: string;
  status: string;
  note: string | null;
};

type ProfileRole = {
  id: string;
  role: "admin" | "user";
};

type AllResponse = {
  event_id: string;
  user_id: string;
  status: string;
};

type EventSummary = {
  attend: number;
  pending: number;
  absent: number;
  coachAttend: number;
  playerAttend: number;
};

type PageProps = {
  searchParams?: Promise<{
    year?: string;
    month?: string;
  }>;
};

function toTokyoDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

function toDateKeyFromParts(year: number, month: number, date = 1) {
  return `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(
    2,
    "0"
  )}`;
}

function toUtcISOStringFromDateKey(dateKey: string) {
  return new Date(`${dateKey}T00:00:00+09:00`).toISOString();
}

function getMonthRangeTokyo(year: number, month: number) {
  const startKey = toDateKeyFromParts(year, month, 1);

  const next =
    month === 12
      ? { year: year + 1, month: 1 }
      : { year, month: month + 1 };

  const endKey = toDateKeyFromParts(next.year, next.month, 1);

  return {
    start: toUtcISOStringFromDateKey(startKey),
    end: toUtcISOStringFromDateKey(endKey),
  };
}

export default async function UserCalendarPage({ searchParams }: PageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;

  const currentUser = await requireUser();

  const todayKey = toTokyoDateKey(new Date());
  const [todayYear, todayMonth] = todayKey.split("-").map(Number);

  const yearParam = Number(resolvedSearchParams?.year);
  const monthParam = Number(resolvedSearchParams?.month);

  const currentYear = Number.isFinite(yearParam) ? yearParam : todayYear;

  const currentMonth =
    Number.isFinite(monthParam) && monthParam >= 1 && monthParam <= 12
      ? monthParam
      : todayMonth;

  const monthRange = getMonthRangeTokyo(currentYear, currentMonth);

  const { data: events, error: eventsError } = await supabase
    .from("calendar_events")
    .select(
      "id, title, description, location, time_text, start_at, is_holiday, title_color, location_color, time_color, attendance_required, display_type"
    )
    .eq("group_id", currentUser.group_id)
    .gte("start_at", monthRange.start)
    .lt("start_at", monthRange.end)
    .order("start_at", { ascending: true });

  if (eventsError) {
    return (
      <main className="min-h-screen bg-gray-50 p-3 text-gray-900 sm:p-8">
        <div className="mx-auto max-w-6xl">
          <h1 className="text-2xl font-bold">予定</h1>
          <p className="mt-6 rounded bg-red-100 p-4 text-red-700">
            予定取得エラー：{eventsError.message}
          </p>
        </div>
      </main>
    );
  }

  const eventList = (events ?? []) as CalendarEvent[];
  const eventIds = eventList.map((event) => event.id);

  const { data: myResponses } =
    eventIds.length > 0
      ? await supabase
          .from("event_responses")
          .select("id, event_id, user_id, status, note")
          .eq("user_id", currentUser.id)
          .in("event_id", eventIds)
      : { data: [] };

  const { data: allResponses } =
    eventIds.length > 0
      ? await supabase
          .from("event_responses")
          .select("event_id, user_id, status")
          .in("event_id", eventIds)
      : { data: [] };

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("group_id", currentUser.group_id);

  const profileRoles = (profiles ?? []) as ProfileRole[];
  const roleByUser = new Map<string, "admin" | "user">();

  for (const profile of profileRoles) {
    roleByUser.set(profile.id, profile.role);
  }

  const summariesByEvent: Record<string, EventSummary> = {};

  for (const event of eventList) {
    summariesByEvent[event.id] = {
      attend: 0,
      pending: 0,
      absent: 0,
      coachAttend: 0,
      playerAttend: 0,
    };
  }

  for (const response of (allResponses ?? []) as AllResponse[]) {
    const summary = summariesByEvent[response.event_id];

    if (!summary) continue;

    if (response.status === "attend") {
      summary.attend += 1;

      const role = roleByUser.get(response.user_id);

      if (role === "admin") {
        summary.coachAttend += 1;
      }

      if (role === "user") {
        summary.playerAttend += 1;
      }
    }

    if (response.status === "pending") {
      summary.pending += 1;
    }

    if (response.status === "absent") {
      summary.absent += 1;
    }
  }

  return (
    <UserCalendarClient
      currentUser={{
        id: currentUser.id,
        name: currentUser.name,
      }}
      currentYear={currentYear}
      currentMonth={currentMonth}
      todayKey={todayKey}
      events={eventList}
      myResponses={(myResponses ?? []) as EventResponse[]}
      summariesByEvent={summariesByEvent}
    />
  );
}
