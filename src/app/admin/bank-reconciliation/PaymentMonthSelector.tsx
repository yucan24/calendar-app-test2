import MonthNavigation from "@/components/ui/MonthNavigation";
import { formatTargetMonth } from "@/lib/month";

type Props = {
  targetMonth: string;
  previousMonth: string;
  currentMonth: string;
  nextMonth: string;
};

export default function PaymentMonthSelector({
  targetMonth,
  previousMonth,
  currentMonth,
  nextMonth,
}: Props) {
  return (
    <section className="ui-card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="ui-section-title text-gray-900">給与・税の対象月</h2>
          <p className="text-sm font-medium text-gray-700">
            {formatTargetMonth(targetMonth)}
          </p>
        </div>
        <MonthNavigation baseHref="/admin/accounting?tab=reconciliation" previousMonth={previousMonth} currentMonth={currentMonth} nextMonth={nextMonth} />
      </div>
    </section>
  );
}
