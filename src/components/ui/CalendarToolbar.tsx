"use client";

import Link from "next/link";
import PendingNavigationButton from "@/components/PendingNavigationButton";
import { calendarHref, getCalendarDays, moveCalendarDate, type CalendarView } from "@/lib/calendar";
import type { ReactNode } from "react";
import { formatTargetMonth, isValidDate } from "@/lib/month";

type Props = { baseHref: string; view: CalendarView; anchorDate: string; targetMonth: string; todayKey: string; children?: ReactNode; selectionActions?: ReactNode };

function shortDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

export default function CalendarToolbar({ baseHref, view, anchorDate, targetMonth, todayKey, children, selectionActions }: Props) {
  const days = getCalendarDays(targetMonth, view, anchorDate).filter(day => day.valid);
  const lastDate = days[days.length - 1].dateKey;
  const rangeEnd = lastDate.slice(0, 7) === days[0].dateKey.slice(0, 7) ? `${Number(lastDate.slice(8))}日`
    : lastDate.slice(0, 4) === days[0].dateKey.slice(0, 4) ? `${Number(lastDate.slice(5, 7))}月${Number(lastDate.slice(8))}日` : shortDate(lastDate);
  const title = view === "month" ? formatTargetMonth(targetMonth)
    : view === "day" ? `${shortDate(anchorDate)}（${"日月火水木金土"[days[0].weekday]}）`
    : `${shortDate(days[0].dateKey)} 〜 ${rangeEnd}`;
  const unit = view === "month" ? "月" : view === "week" ? "週" : "日";
  const previous = moveCalendarDate(anchorDate, view, -1);
  const next = moveCalendarDate(anchorDate, view, 1);
  return <div className="ui-calendar-toolbar">
    <h2 className="ui-section-title">{title}</h2>
    <div className="ui-calendar-control-row">
      <nav aria-label="カレンダーの表示形式" className="ui-calendar-view-tabs">
        {(["month", "week", "day"] as const).map((mode, index) => <Link key={mode} href={calendarHref(baseHref, mode, anchorDate)} scroll={false} className="ui-tab" aria-current={view === mode ? "page" : undefined}>{["月", "週", "日"][index]}</Link>)}
      </nav>
      <nav aria-label="表示期間の切替" className="ui-month-navigation">
        <PendingNavigationButton href={calendarHref(baseHref, view, previous)} disabled={!isValidDate(previous)} scroll={false} className="ui-button ui-button-secondary">前{unit}</PendingNavigationButton>
        <PendingNavigationButton href={calendarHref(baseHref, view, todayKey)} scroll={false} className="ui-button ui-button-secondary">{view === "day" ? "今日" : `今${unit}`}</PendingNavigationButton>
        <PendingNavigationButton href={calendarHref(baseHref, view, next)} disabled={!isValidDate(next)} scroll={false} className="ui-button ui-button-secondary">翌{unit}</PendingNavigationButton>
      </nav>
      <div className="ui-calendar-bulk-action">{children}</div>
    </div>
    {selectionActions && <div className="ui-calendar-selection-actions">{selectionActions}</div>}
  </div>;
}
