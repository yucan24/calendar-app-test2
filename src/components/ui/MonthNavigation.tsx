import PendingNavigationButton from "@/components/PendingNavigationButton";
import { isValidTargetMonth } from "@/lib/month";

type Props = { baseHref: string; previousMonth: string; currentMonth: string; nextMonth: string };

export default function MonthNavigation({ baseHref, previousMonth, currentMonth, nextMonth }: Props) {
  const href = (month: string) => `${baseHref}${baseHref.includes("?") ? "&" : "?"}month=${month}`;
  return <nav aria-label="表示月の切替" className="ui-month-navigation">
    <PendingNavigationButton href={href(previousMonth)} disabled={!isValidTargetMonth(previousMonth)} className="ui-button ui-button-secondary">前月</PendingNavigationButton>
    <PendingNavigationButton href={href(currentMonth)} className="ui-button ui-button-secondary">今月</PendingNavigationButton>
    <PendingNavigationButton href={href(nextMonth)} disabled={!isValidTargetMonth(nextMonth)} className="ui-button ui-button-secondary">翌月</PendingNavigationButton>
  </nav>;
}
