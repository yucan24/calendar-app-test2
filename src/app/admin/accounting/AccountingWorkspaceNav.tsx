import Link from "next/link";

export type AccountingWorkspaceTab =
  | "summary"
  | "reconciliation"
  | "history"
  | "import"
  | "settings";

type Props = {
  activeTab: AccountingWorkspaceTab;
  targetMonth: string;
};

const tabs: Array<{
  id: AccountingWorkspaceTab;
  label: string;
  href: string;
}> = [
  { id: "summary", label: "集計", href: "/admin/accounting" },
  {
    id: "reconciliation",
    label: "未処理照合",
    href: "/admin/accounting?tab=reconciliation",
  },
  {
    id: "history",
    label: "処理履歴",
    href: "/admin/accounting?tab=history",
  },
  {
    id: "import",
    label: "CSV取込",
    href: "/admin/accounting?tab=import",
  },
  {
    id: "settings",
    label: "設定・記録",
    href: "/admin/accounting?tab=settings",
  },
];

export default function AccountingWorkspaceNav({ activeTab, targetMonth }: Props) {
  return (
    <nav
      aria-label="会計管理メニュー"
      className="mt-6 flex gap-2 overflow-x-auto rounded-lg border border-gray-300 bg-white p-2 shadow-sm"
    >
      {tabs.map((tab) => {
        const selected = tab.id === activeTab;

        return (
          <Link
            key={tab.id}
            href={`${tab.href}${tab.href.includes("?") ? "&" : "?"}month=${targetMonth}`}
            aria-current={selected ? "page" : undefined}
            className={`whitespace-nowrap rounded px-4 py-3 font-bold ${
              selected
                ? "bg-gray-900 text-white"
                : "bg-white text-gray-800 hover:bg-gray-100"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
