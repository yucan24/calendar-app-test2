"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { bindPullToRefresh } from "@/lib/pull-to-refresh";

export default function PullToRefresh({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pull, setPull] = useState({ distance: 0, threshold: 56 });
  const [isPending, startTransition] = useTransition();
  const refreshing = useRef(false);

  useEffect(() => { if (!isPending) refreshing.current = false; }, [isPending]);
  useEffect(() => {
    return bindPullToRefresh({
      onPull: (distance, threshold) => setPull({ distance, threshold }),
      isRefreshing: () => refreshing.current,
      onRefresh: () => {
        refreshing.current = true;
        startTransition(() => router.refresh());
      },
    });
  }, [pathname, router, startTransition]);

  const visible = pull.distance > 0 || isPending;
  const ready = pull.distance >= pull.threshold;
  return <div className="ui-pull-refresh">
    {visible && <div className="ui-pull-refresh-indicator" role="status" aria-live="polite">
      <svg className={isPending ? "ui-pull-refresh-spinner" : ""} style={isPending ? undefined : { transform: `rotate(${Math.min(pull.distance / pull.threshold, 1) * 180}deg)` }} viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {isPending ? <path d="M20 12a8 8 0 1 1-8-8" /> : <path d="M12 4v16m-6-6 6 6 6-6" />}
      </svg>
      <span>{isPending ? "更新中…" : ready ? "離すと更新" : "下に引いて更新"}</span>
    </div>}
    <div className="ui-pull-refresh-content" style={pull.distance > 0 ? { transform: `translateY(${pull.distance}px)` } : undefined}>{children}</div>
  </div>;
}
