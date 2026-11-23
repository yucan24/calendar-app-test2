"use client";

import { Children, type ReactNode, useMemo, useState } from "react";

type TabMeta = {
  id: string;
  label: string;
  meta: string;
};

type Props = {
  tabs: TabMeta[];
  initialTabId?: string;
  children: ReactNode;
};

export default function AccountingSectionTabs({
  tabs,
  initialTabId,
  children,
}: Props) {
  const initialIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === initialTabId)
  );
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const panels = useMemo(() => Children.toArray(children), [children]);
  const activeTab = tabs[activeIndex] ?? tabs[0];

  return (
    <div>
      <div className="border-b border-gray-300 bg-gray-50 px-3 py-3">
        <div
          role="tablist"
          aria-label="設定・記録"
          className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
        >
          {tabs.map((tab, index) => {
            const selected = activeIndex === index;

            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`${tab.id}-panel`}
                id={`${tab.id}-tab`}
                onClick={() => setActiveIndex(index)}
                className="ui-tab flex-col items-start whitespace-normal text-left"
              >
                <span className="block text-sm font-bold">{tab.label}</span>
                <span
                  className={`mt-1 block text-xs font-bold ${
                    selected ? "text-gray-200" : "text-gray-600"
                  }`}
                >
                  {tab.meta}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        role="tabpanel"
        id={`${activeTab?.id ?? "accounting"}-panel`}
        aria-labelledby={`${activeTab?.id ?? "accounting"}-tab`}
        className="px-5 py-5"
      >
        {panels[activeIndex] ?? panels[0]}
      </div>
    </div>
  );
}
