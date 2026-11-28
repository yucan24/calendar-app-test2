import { requireAdmin } from "@/lib/auth";
import { fetchAllRows } from "@/lib/pagination";
import { supabase } from "@/lib/supabase";
import { getJstDateKey } from "@/lib/month";
import { getCalendarPeriodUtcRange, getCalendarUtcRange, resolveCalendarSelection, type CalendarSearchParams } from "@/lib/calendar";
import AdminCalendarClient from "./AdminCalendarClient";

type PageProps = {
  searchParams?: Promise<CalendarSearchParams>;
};

type Profile = {
  id: string;
  name: string;
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

export default async function AdminCalendarPage({ searchParams }: PageProps) {
  const admin = await requireAdmin();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;

  const todayKey = getJstDateKey(new Date().toISOString());
  const { targetMonth, view, anchorDate } = resolveCalendarSelection(resolvedSearchParams, todayKey);
  const { startIso: monthStartIso, endIso: monthEndIso } = getCalendarUtcRange(targetMonth, view, anchorDate);

  const periodRange = getCalendarPeriodUtcRange(targetMonth, view, anchorDate);
  const eventResults = await Promise.all([fetchAllRows<CalendarEvent>((from, to) => supabase
    .from("calendar_events")
    .select(
      "id, title, description, location, start_at, end_at, time_text, is_holiday, title_color, location_color, time_color, attendance_required, display_type"
    )
    .eq("group_id", admin.group_id)
    .gte("start_at", monthStartIso)
    .lt("start_at", monthEndIso)
    .order("start_at", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true }).range(from, to)),
    fetchAllRows<CalendarEvent>((from, to) => supabase.from("calendar_events")
      .select("id, title, description, location, start_at, end_at, time_text, is_holiday, title_color, location_color, time_color, attendance_required, display_type")
      .eq("group_id", admin.group_id).eq("attendance_required", false)
      .gte("start_at", periodRange.startIso).lt("start_at", periodRange.endIso)
      .order("start_at", { ascending: true }).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to)),
  ]);

  for (const result of eventResults) if (result.error) throw new Error(result.error.message);
  const events = Array.from(new Map(eventResults.flatMap(result => result.data ?? []).map(event => [event.id, event])).values());

  const eventIds = (events ?? []).map((event) => event.id);

  let responses: EventResponse[] = [];

  if (eventIds.length > 0) {
    const { data: responseData, error: responsesError } = await fetchAllRows<EventResponse>((from, to) => supabase
      .from("event_responses")
      .select("id, event_id, user_id, status, note")
      .in("event_id", eventIds).order("id", { ascending: true }).range(from, to));

    if (responsesError) {
      throw new Error(responsesError.message);
    }

    responses = (responseData ?? []) as EventResponse[];
  }

  const { data: profiles, error: profilesError } = await fetchAllRows<Profile>((from, to) => supabase
    .from("profiles")
    .select("id, name, role")
    .eq("group_id", admin.group_id)
    .order("role", { ascending: true })
    .order("name", { ascending: true })
    .order("id", { ascending: true }).range(from, to));

  if (profilesError) {
    throw new Error(profilesError.message);
  }

  return (
    <AdminCalendarClient
      currentAdmin={{
        id: admin.id,
        name: admin.name,
      }}
      key={`${view}:${anchorDate}`}
      targetMonth={targetMonth}
      view={view}
      anchorDate={anchorDate}
      todayKey={todayKey}
      events={(events ?? []) as CalendarEvent[]}
      responses={responses}
      profiles={(profiles ?? []) as Profile[]}
    />
  );
}
