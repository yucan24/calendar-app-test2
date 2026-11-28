import CalendarEventPreview from "@/components/ui/CalendarEventPreview";
import { layoutCalendarDay, type AttendanceStatus, type CalendarPeriodSource } from "@/lib/calendar";

type DayEvent = CalendarPeriodSource & { attendance_required: boolean; end_at?: string | null };
type Props = {
  events: DayEvent[];
  getSummary?: (eventId: string) => { coachCount: number; playerCount: number };
  getOwnStatus?: (eventId: string) => AttendanceStatus | undefined;
  showAttendance?: boolean;
  onSelect: (eventId: string) => void;
};

export default function CalendarDayTimeline({ events, getSummary, getOwnStatus, onSelect, showAttendance = true }: Props) {
  const { timed, untimed, startHour, endHour } = layoutCalendarDay(events);
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index);
  const eventLabel = (event: DayEvent, time: string) => {
    const summary = getSummary?.(event.id);
    const status = getOwnStatus?.(event.id);
    const ownLabel = status === "attend" ? "出席" : status === "absent" ? "欠席" : status === "pending" ? "未定" : "未回答";
    return `${event.title}、${time}${event.location ? `、${event.location}` : ""}${showAttendance && event.attendance_required && summary ? `、指導者${summary.coachCount}人、選手${summary.playerCount}人、自分の出欠：${ownLabel}` : ""}`;
  };
  return <div className="ui-calendar-day-timeline">
    {untimed.length > 0 && <section className="ui-calendar-timeline-untimed" aria-label="終日・時間未定の予定">
      <h3>終日・時間未定</h3>
      {untimed.map(event => <button key={event.id} type="button" className="ui-calendar-timeline-event" data-event-id={event.id} aria-label={eventLabel(event, event.time_text || "時間未定")} onClick={() => onSelect(event.id)}>
        <CalendarEventPreview event={event} summary={getSummary?.(event.id)} ownStatus={getOwnStatus?.(event.id)} showOwnStatus showAttendance={showAttendance} />
      </button>)}
    </section>}
    {!timed.length && <p className="ui-calendar-timeline-empty">{events.length ? "時間指定の予定はありません" : "予定なし"}</p>}
    <div className="ui-calendar-timeline-grid" aria-label="時間ごとの予定" style={{ height: `calc(var(--calendar-hour-height) * ${endHour - startHour})` }}>
      <div aria-hidden="true">
        {hours.map(hour => <div className="ui-calendar-timeline-hour" key={hour} style={{ top: `calc(var(--calendar-hour-height) * ${hour - startHour})` }}><span>{hour}:00</span></div>)}
      </div>
      <div className="ui-calendar-timeline-events">
        {timed.map((slot, index) => <button
          key={slot.event.id} type="button" data-event-id={slot.event.id}
          className={`ui-calendar-timeline-event ui-calendar-timeline-timed ui-calendar-timeline-tone-${index % 2} ${slot.end - slot.start < 90 ? "is-short" : ""} ${slot.end - slot.start < 45 ? "is-brief" : ""}`}
          style={{ top: `calc(var(--calendar-hour-height) * ${(slot.start - startHour * 60) / 60})`, height: `calc(var(--calendar-hour-height) * ${(slot.end - slot.start) / 60})`, left: `${slot.column / slot.columns * 100}%`, width: `calc(${100 / slot.columns}% - 3px)` }}
          aria-label={eventLabel(slot.event, slot.label)} onClick={() => onSelect(slot.event.id)}
        >
          <CalendarEventPreview event={{ ...slot.event, time_text: slot.label }} summary={getSummary?.(slot.event.id)} ownStatus={getOwnStatus?.(slot.event.id)} showOwnStatus showAttendance={showAttendance} />
        </button>)}
      </div>
    </div>
  </div>;
}
