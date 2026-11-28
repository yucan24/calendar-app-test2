import type { AttendanceStatus } from "@/lib/calendar";

export function AttendanceRoleIcon({ role }: { role: "coach" | "player" }) {
  return <svg className={`ui-calendar-role-icon ui-calendar-role-icon-${role}`} viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {role === "coach" ? <>
      <path d="M9 7h12v6h-6a6 6 0 1 1-6-6Z" fill="#dbeafe" />
      <circle cx="9" cy="13" r="2" />
      <path d="M17 7v6M4 18l-2 3" />
    </> : <>
      <circle cx="12" cy="12" r="9" fill="#ffedd5" />
      <path d="M3 12h18M12 3v18M5.6 5.6c4 2.5 4 10.3 0 12.8M18.4 5.6c-4 2.5-4 10.3 0 12.8" />
    </>}
  </svg>;
}

export function CalendarAttendanceLegend() {
  return <div className="ui-calendar-legend">
    <span><AttendanceRoleIcon role="coach" />指導者</span>
    <span><AttendanceRoleIcon role="player" />選手</span>
    <span>○ 出席</span><span>× 欠席</span><span>△ 未定</span><span>未 未回答</span>
  </div>;
}

export function OwnAttendance({ status, eventTitle }: { status?: AttendanceStatus; eventTitle?: string }) {
  const label = status === "attend" ? "出席" : status === "absent" ? "欠席" : status === "pending" ? "未定" : "未回答";
  const symbol = status === "attend" ? "○" : status === "absent" ? "×" : status === "pending" ? "△" : "未";
  const description = `${eventTitle ? `${eventTitle}：` : ""}自分の出欠：${label}`;
  return <span className={`ui-calendar-own-status ui-calendar-own-status-${status ?? "unanswered"}`} aria-label={description} title={description}>{symbol}</span>;
}

type Props = {
  event: { id: string; title: string; location?: string | null; time_text?: string | null; title_color?: string | null; location_color?: string | null; time_color?: string | null; attendance_required: boolean };
  summary?: { coachCount: number; playerCount: number };
  ownStatus?: AttendanceStatus;
  showOwnStatus: boolean;
  showAttendance?: boolean;
};

export default function CalendarEventPreview({ event, summary, ownStatus, showOwnStatus, showAttendance = true }: Props) {
  return <div className="ui-calendar-event" data-event-id={event.id}>
    <div className="ui-calendar-event-heading">
      {event.time_text && <span className="ui-calendar-event-time" style={{ color: event.time_color || undefined }}>
        <span className="ui-calendar-time-full">{event.time_text}</span>
        <span className="ui-calendar-time-compact">{event.time_text.replace(/^(\d{1,2}[:：]\d{2})\s*[-ー－〜~]\s*(\d{1,2}[:：]\d{2})$/, "$1\n$2")}</span>
      </span>}
      {showAttendance && showOwnStatus && event.attendance_required && <OwnAttendance status={ownStatus} />}
    </div>
    <div className="ui-calendar-event-title" style={{ color: event.title_color || undefined }}>{event.title}</div>
    {event.location && <div className="ui-calendar-event-location" style={{ color: event.location_color || undefined }}>{event.location}</div>}
    {showAttendance && event.attendance_required && summary && <div className="ui-calendar-event-counts" aria-label={`出席予定 指導者${summary.coachCount}人、選手${summary.playerCount}人`}>
      <span title="指導者" aria-hidden="true"><AttendanceRoleIcon role="coach" /><span>{summary.coachCount}<span className="ui-calendar-count-unit">人</span></span></span>
      <span title="選手" aria-hidden="true"><AttendanceRoleIcon role="player" /><span>{summary.playerCount}<span className="ui-calendar-count-unit">人</span></span></span>
    </div>}
  </div>;
}
