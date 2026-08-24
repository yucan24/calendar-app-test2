"use client";

import type { ReactNode } from "react";
import { useState } from "react";

type WorkspaceTab = "review" | "history" | "import" | "aliases";

type Props = {
  unmatchedCount: number;
  matchedCount: number;
  ignoredCount: number;
  reviewPanel: ReactNode;
  historyPanel: ReactNode;
  importPanel: ReactNode;
  aliasesPanel: ReactNode;
};

export default function BankReconciliationTabs({
  unmatchedCount,
  matchedCount,
  ignoredCount,
  reviewPanel,
  historyPanel,
  importPanel,
  aliasesPanel,
}: Props) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("review");
  const tabs: Array<{
    id: WorkspaceTab;
    label: string;
    count?: number;
  }> = [
    { id: "review", label: "未処理照合", count: unmatchedCount },
    {
      id: "history",
      label: "処理履歴",
      count: matchedCount + ignoredCount,
    },
    { id: "import", label: "CSV取込" },
    { id: "aliases", label: "口座名義" },
  ];
  const activePanel =
    activeTab === "review"
      ? reviewPanel
      : activeTab === "history"
        ? historyPanel
        : activeTab === "import"
          ? importPanel
          : aliasesPanel;

  return (
    <div className="mt-6">
      <div
        role="tablist"
        aria-label="銀行明細照合メニュー"
        className="flex gap-2 overflow-x-auto rounded-lg border border-gray-300 bg-white p-2 shadow-sm"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`whitespace-nowrap rounded px-4 py-3 font-bold ${
              activeTab === tab.id
                ? "bg-gray-900 text-white"
                : "bg-white text-gray-800 hover:bg-gray-100"
            }`}
          >
            {tab.label}
            {typeof tab.count === "number" && ` ${tab.count}件`}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="mt-5">
        {activePanel}
      </div>
    </div>
  );
}
