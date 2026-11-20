import PendingNavigationButton from "@/components/PendingNavigationButton";
import { formatTargetMonth, isValidTargetMonth } from "@/lib/month";

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
    <section className="rounded-lg bg-white p-4 shadow">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-bold text-gray-900">給与・税の対象月</h2>
          <p className="text-sm font-medium text-gray-700">
            原則翌月振込として、前月分を初期表示：
            {formatTargetMonth(targetMonth)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PendingNavigationButton
            href={`/admin/accounting?tab=reconciliation&month=${previousMonth}`}
            disabled={!isValidTargetMonth(previousMonth)}
            className="rounded border border-gray-400 bg-white px-3 py-2 font-bold"
          >
            前月
          </PendingNavigationButton>
          <PendingNavigationButton
            href={`/admin/accounting?tab=reconciliation&month=${currentMonth}`}
            className="rounded border border-gray-400 bg-white px-3 py-2 font-bold"
          >
            今月
          </PendingNavigationButton>
          <PendingNavigationButton
            href={`/admin/accounting?tab=reconciliation&month=${nextMonth}`}
            disabled={!isValidTargetMonth(nextMonth)}
            className="rounded border border-gray-400 bg-white px-3 py-2 font-bold"
          >
            翌月
          </PendingNavigationButton>
        </div>
      </div>
    </section>
  );
}
