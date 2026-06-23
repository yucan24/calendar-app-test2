export default function UserHistoryPage() {
  const histories = [
    { date: "2026-06-18", action: "消費", amount: "-1", note: "来店利用" },
    { date: "2026-06-10", action: "付与", amount: "+10", note: "現金購入" },
  ];

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-md">
        <h1 className="text-2xl font-bold">利用履歴</h1>

        <div className="mt-6 space-y-3">
          {histories.map((history) => (
            <div key={`${history.date}-${history.action}`} className="rounded-lg bg-white p-4 shadow">
              <div className="flex items-center justify-between">
                <p className="font-medium">{history.date}</p>
                <p className="font-bold">{history.amount}回</p>
              </div>
              <p className="mt-1 text-sm text-gray-600">
                {history.action}：{history.note}
              </p>
            </div>
          ))}
        </div>

        <a
          href="/user"
          className="mt-6 inline-block rounded border bg-white px-4 py-2"
        >
          戻る
        </a>
      </div>
    </main>
  );
}