import BankCsvImportForm from "./BankCsvImportForm";
import type { BankCsvImport } from "./types";

type Props = {
  importHistory: BankCsvImport[];
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${value}T00:00:00+09:00`));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));
}

export default function BankImportPanel({ importHistory }: Props) {
  return (
    <section className="rounded-lg bg-white p-5 shadow">
      <h2 className="text-xl font-bold text-gray-900">CSV取込</h2>
      <BankCsvImportForm />

      {importHistory.length > 0 && (
        <details className="mt-5 border-t border-gray-200 pt-4">
          <summary className="cursor-pointer font-bold text-gray-900">
            最近の取込履歴
          </summary>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-100 text-gray-700">
                <tr>
                  <th className="whitespace-nowrap px-3 py-2">取込日時</th>
                  <th className="whitespace-nowrap px-3 py-2">対象期間</th>
                  <th className="whitespace-nowrap px-3 py-2">銀行・支店</th>
                  <th className="whitespace-nowrap px-3 py-2">結果</th>
                </tr>
              </thead>
              <tbody>
                {importHistory.map((item) => (
                  <tr key={item.id} className="border-t border-gray-200">
                    <td className="whitespace-nowrap px-3 py-2">
                      {formatDateTime(item.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {item.periodStart && item.periodEnd
                        ? `${formatDate(item.periodStart)}〜${formatDate(item.periodEnd)}`
                        : "不明"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {item.bankName} {item.branchName}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-bold">
                      新規{item.importedCount}件・重複{item.skippedCount}件
                      {item.conflictCount > 0 && <span className="ml-2 text-amber-800">内容相違{item.conflictCount}件（要確認）</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
