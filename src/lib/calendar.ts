import { getJstDateKey, isValidDate, isValidTargetMonth } from "./month";

export type CalendarView = "day" | "week" | "month";
export type CalendarSearchParams = { month?: string; date?: string; view?: string };
export type AttendanceStatus = "attend" | "absent" | "pending";

function utcDate(dateKey: string) {
  return new Date(`${dateKey}T00:00:00Z`);
}

function dateKey(date: Date) {
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function addCalendarDays(value: string, amount: number) {
  const date = utcDate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateKey(date);
}

export function resolveCalendarSelection(params: CalendarSearchParams = {}, todayKey = getJstDateKey(new Date().toISOString())) {
  const view: CalendarView = params.view === "day" || params.view === "week" ? params.view : "month";
  const month = typeof params.month === "string" && isValidTargetMonth(params.month) ? params.month : null;
  const requestedDate = typeof params.date === "string" && isValidDate(params.date) ? params.date : null;
  const targetMonth = month ?? requestedDate?.slice(0, 7) ?? todayKey.slice(0, 7);
  const anchorDate = requestedDate?.startsWith(`${targetMonth}-`) ? requestedDate
    : targetMonth === todayKey.slice(0, 7) ? todayKey : `${targetMonth}-01`;
  return { view, anchorDate, targetMonth };
}

export function getCalendarDays(targetMonth: string, view: CalendarView, anchorDate: string) {
  const anchor = utcDate(view === "month" ? `${targetMonth}-01` : anchorDate);
  const mondayIndex = (anchor.getUTCDay() + 6) % 7;
  let first = anchorDate;
  let count = 1;
  if (view === "week") {
    first = addCalendarDays(anchorDate, -mondayIndex);
    count = 7;
  } else if (view === "month") {
    first = addCalendarDays(`${targetMonth}-01`, -mondayIndex);
    const last = new Date(anchor);
    last.setUTCMonth(last.getUTCMonth() + 1, 0);
    count = Math.ceil((mondayIndex + last.getUTCDate()) / 7) * 7;
  }
  return Array.from({ length: count }, (_, index) => {
    const key = addCalendarDays(first, index);
    return { dateKey: key, day: Number(key.split("-")[2]), weekday: utcDate(key).getUTCDay(), isCurrentMonth: key.startsWith(`${targetMonth}-`), valid: isValidDate(key) };
  });
}

export function getCalendarUtcRange(targetMonth: string, view: CalendarView, anchorDate: string) {
  const days = getCalendarDays(targetMonth, view, anchorDate).filter(day => day.valid);
  const start = new Date(`${days[0].dateKey}T00:00:00+09:00`);
  const end = new Date(`${days[days.length - 1].dateKey}T00:00:00+09:00`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

// 表示範囲の前後も読み、帯が別の週・月へ続くかを判定する。
export function getCalendarPeriodUtcRange(targetMonth: string, view: CalendarView, anchorDate: string) {
  const range = getCalendarUtcRange(targetMonth, view, anchorDate);
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const minimum = new Date("0001-01-01T00:00:00+09:00").getTime();
  const maximum = new Date("9999-12-31T00:00:00+09:00").getTime() + 24 * 60 * 60 * 1000;
  return {
    startIso: new Date(Math.max(minimum, new Date(range.startIso).getTime() - weekMs)).toISOString(),
    endIso: new Date(Math.min(maximum, new Date(range.endIso).getTime() + weekMs)).toISOString(),
  };
}

export function moveCalendarDate(anchorDate: string, view: CalendarView, direction: -1 | 1) {
  if (view !== "month") return addCalendarDays(anchorDate, direction * (view === "week" ? 7 : 1));
  const date = utcDate(anchorDate);
  const originalDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + direction);
  const last = new Date(date);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(originalDay, last.getUTCDate()));
  return dateKey(date);
}

export function calendarHref(baseHref: string, view: CalendarView, date: string) {
  return `${baseHref}?month=${date.slice(0, 7)}&view=${view}&date=${date}`;
}

export function compareCalendarEvents(left: { time_text?: string | null; start_at: string }, right: { time_text?: string | null; start_at: string }) {
  const minutes = (event: typeof left) => {
    const match = event.time_text?.match(/^\s*(\d{1,2})[:：](\d{2})/);
    if (match && Number(match[1]) < 24 && Number(match[2]) < 60) return Number(match[1]) * 60 + Number(match[2]);
    const date = new Date(event.start_at);
    return ((date.getUTCHours() + 9) % 24) * 60 + date.getUTCMinutes();
  };
  return minutes(left) - minutes(right);
}

type CalendarTimeSource = { id: string; start_at: string; end_at?: string | null; time_text?: string | null };

function jstMinutes(date: Date) {
  return ((date.getUTCHours() + 9) % 24) * 60 + date.getUTCMinutes();
}

function clockLabel(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

// このアプリは予定日をstart_at、実際の時間をtime_textに保存するため、文字列を優先する。
export function getCalendarEventTime(event: CalendarTimeSource) {
  const text = event.time_text?.normalize("NFKC").trim();
  if (text) {
    const match = text.match(/^(\d{1,2})[:：](\d{2})(?:\s*[-ー−－〜～~–—]\s*(\d{1,2})[:：](\d{2}))?$/);
    if (!match) return null;
    const hour = Number(match[1]), minute = Number(match[2]);
    if (hour > 23 || minute > 59) return null;
    const start = hour * 60 + minute;
    if (!match[3]) return { start, end: Math.min(start + 60, 1440), label: clockLabel(start) };
    const endHour = Number(match[3]), endMinute = Number(match[4]);
    if (endHour > 24 || endMinute > 59 || (endHour === 24 && endMinute !== 0)) return null;
    const end = endHour * 60 + endMinute;
    return { start, end: end <= start ? 1440 : end, label: `${clockLabel(start)}〜${end <= start ? "翌" : ""}${clockLabel(end)}` };
  }
  const startDate = new Date(event.start_at);
  if (!Number.isFinite(startDate.getTime())) return null;
  const start = jstMinutes(startDate);
  const endDate = event.end_at ? new Date(event.end_at) : null;
  const hasEnd = endDate && Number.isFinite(endDate.getTime()) && endDate > startDate;
  // 時間のない日付だけの予定を、0時の予定として扱わない。
  if (start === 0 && !hasEnd) return null;
  const end = hasEnd ? Math.min(start + Math.round((endDate.getTime() - startDate.getTime()) / 60000), 1440) : Math.min(start + 60, 1440);
  const startDateKey = getJstDateKey(startDate.toISOString());
  const endDateKey = hasEnd ? getJstDateKey(endDate.toISOString()) : startDateKey;
  const endPrefix = endDateKey === startDateKey ? "" : endDateKey === addCalendarDays(startDateKey, 1) ? "翌" : `${endDateKey} `;
  const endLabel = hasEnd ? `${endPrefix}${clockLabel(jstMinutes(endDate))}` : "";
  return { start, end, label: hasEnd ? `${clockLabel(start)}〜${endLabel}` : clockLabel(start) };
}

export function layoutCalendarDay<T extends CalendarTimeSource>(events: T[]) {
  const untimed: T[] = [];
  const timed = events.flatMap(event => {
    const time = getCalendarEventTime(event);
    if (!time) { untimed.push(event); return []; }
    return [{ event, ...time, column: 0, columns: 1 }];
  }).sort((left, right) => left.start - right.start || right.end - left.end || left.event.id.localeCompare(right.event.id));
  type Slot = typeof timed[number];
  let cluster: Slot[] = [], occupiedUntil: number[] = [], clusterEnd = 0;
  const finishCluster = () => { for (const slot of cluster) slot.columns = occupiedUntil.length; };
  for (const slot of timed) {
    if (slot.start >= clusterEnd) { finishCluster(); cluster = []; occupiedUntil = []; }
    let column = occupiedUntil.findIndex(end => end <= slot.start);
    if (column < 0) column = occupiedUntil.length;
    // 短い予定もタップできる高さを確保する。同じ場所に次の予定を重ねない。
    const displayEnd = Math.min(Math.max(slot.end, slot.start + 30), 1440);
    occupiedUntil[column] = displayEnd;
    clusterEnd = Math.max(...occupiedUntil);
    slot.column = column;
    cluster.push(slot);
  }
  finishCluster();
  return {
    timed, untimed,
    startHour: Math.min(8, ...timed.map(slot => Math.floor(slot.start / 60))),
    endHour: Math.max(22, ...timed.map(slot => Math.ceil(slot.end / 60))),
  };
}

export type CalendarPeriodSource = {
  id: string;
  title: string;
  start_at: string;
  display_type: string | null;
  attendance_required?: boolean;
  description?: string | null;
  location?: string | null;
  time_text?: string | null;
  title_color?: string | null;
  location_color?: string | null;
  time_color?: string | null;
  is_holiday?: boolean;
};

export type CalendarPeriodGroup<T extends CalendarPeriodSource = CalendarPeriodSource> = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  events: T[];
};

// 表示だけをまとめる。元の予定IDと日ごとの編集・削除は保持する。
export function groupCalendarPeriods<T extends CalendarPeriodSource>(events: T[]): CalendarPeriodGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const event of events) {
    if (event.display_type !== "period" && event.attendance_required !== false) continue;
    const signature = JSON.stringify([event.title, event.description || "", event.location || "", event.time_text || "", event.title_color || "#000000", event.location_color || "#000000", event.time_color || "#000000", Boolean(event.is_holiday)]);
    const bucket = buckets.get(signature) ?? [];
    bucket.push(event);
    buckets.set(signature, bucket);
  }
  const groups: CalendarPeriodGroup<T>[] = [];
  for (const bucket of buckets.values()) {
    bucket.sort((left, right) => new Date(left.start_at).getTime() - new Date(right.start_at).getTime() || left.id.localeCompare(right.id));
    let group: CalendarPeriodGroup<T> | undefined;
    for (const event of bucket) {
      const key = getJstDateKey(event.start_at);
      if (group && (key === group.endDate || key === addCalendarDays(group.endDate, 1))) {
        group.events.push(event);
        group.endDate = key > group.endDate ? key : group.endDate;
      } else {
        group = { id: event.id, title: event.title, startDate: key, endDate: key, events: [event] };
        groups.push(group);
      }
    }
  }
  return groups.filter(group => group.startDate !== group.endDate || group.events.some(event => event.display_type === "period"))
    .sort((left, right) => left.startDate.localeCompare(right.startDate) || right.endDate.localeCompare(left.endDate) || left.id.localeCompare(right.id));
}

export function layoutCalendarPeriods<T extends CalendarPeriodSource>(groups: CalendarPeriodGroup<T>[], dateKeys: string[]) {
  const visibleDates = dateKeys.filter(isValidDate);
  if (!visibleDates.length) return [];
  const first = visibleDates[0], last = visibleDates[visibleDates.length - 1];
  const occupiedUntil: number[] = [];
  return groups.filter(group => group.startDate <= last && group.endDate >= first).map(group => {
    const startDate = group.startDate < first ? first : group.startDate;
    const endDate = group.endDate > last ? last : group.endDate;
    const startIndex = dateKeys.indexOf(startDate), endIndex = dateKeys.indexOf(endDate);
    let lane = occupiedUntil.findIndex(end => end < startIndex);
    if (lane < 0) lane = occupiedUntil.length;
    occupiedUntil[lane] = endIndex;
    return { group, startDate, endDate, column: startIndex + 1, span: endIndex - startIndex + 1, lane: lane + 1, continuesBefore: group.startDate < first, continuesAfter: group.endDate > last };
  });
}

export function summarizeAttendance(
  responses: { user_id: string; status: AttendanceStatus }[],
  profiles: Map<string, { role: "admin" | "user" }>,
) {
  const summary = { coachCount: 0, playerCount: 0, attend: 0, pending: 0, absent: 0 };
  const byUser = new Map(responses.map(response => [response.user_id, response]));
  for (const response of byUser.values()) {
    const profile = profiles.get(response.user_id);
    if (!profile) continue;
    if (response.status === "attend") {
      summary.attend++;
      if (profile.role === "admin") summary.coachCount++;
      else summary.playerCount++;
    } else if (response.status === "pending") summary.pending++;
    else if (response.status === "absent") summary.absent++;
  }
  return summary;
}
