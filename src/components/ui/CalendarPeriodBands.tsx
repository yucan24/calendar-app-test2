import { getJstDateKey } from "@/lib/month";
import { layoutCalendarPeriods, type CalendarPeriodGroup } from "@/lib/calendar";

type Props = {
  groups: CalendarPeriodGroup[];
  dateKeys: string[];
  disabled: boolean;
  onSelect: (dateKey: string, eventId: string) => void;
};

export default function CalendarPeriodBands({ groups, dateKeys, disabled, onSelect }: Props) {
  const bands = layoutCalendarPeriods(groups, dateKeys);
  if (!bands.length) return null;
  const shortDate = (value: string) => `${Number(value.slice(5, 7))}/${Number(value.slice(8))}`;
  return <div className="ui-calendar-period-lanes" aria-label="期間予定">
    {bands.map(band => {
      const event = band.group.events.find(item => getJstDateKey(item.start_at) === band.startDate) ?? band.group.events[0];
      const range = `${shortDate(band.startDate)}${band.endDate !== band.startDate ? `〜${shortDate(band.endDate)}` : ""}`;
      return <button
        key={band.group.id}
        type="button"
        className={`ui-calendar-period-band ${band.continuesBefore ? "continues-before" : ""} ${band.continuesAfter ? "continues-after" : ""}`}
        style={{ gridColumn: `${band.column} / span ${band.span}`, gridRow: band.lane }}
        data-period-start={band.group.startDate}
        data-period-end={band.group.endDate}
        aria-label={`${band.group.title} ${band.startDate}から${band.endDate}までの期間予定${band.continuesBefore ? "、前の週から継続" : ""}${band.continuesAfter ? "、次の週へ継続" : ""}`}
        disabled={disabled}
        onClick={() => onSelect(band.startDate, event.id)}
      >
        {band.continuesBefore && <span aria-hidden="true" className="ui-calendar-period-arrow">‹</span>}
        <span className="ui-calendar-period-content">
          <span className="ui-calendar-period-title">{band.group.title}</span>
          <span className="ui-calendar-period-range">{range}</span>
        </span>
        {band.continuesAfter && <span aria-hidden="true" className="ui-calendar-period-arrow">›</span>}
      </button>;
    })}
  </div>;
}
