"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type PendingNavigationButtonProps = {
  href: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  replace?: boolean;
  scroll?: boolean;
};

export default function PendingNavigationButton({
  href,
  children,
  className = "ui-button ui-button-secondary",
  disabled = false,
  replace = false,
  scroll,
}: PendingNavigationButtonProps) {
  const router = useRouter();
  const clickedRef = useRef(false);
  const [clicked, setClicked] = useState(false);
  const [isPending, startTransition] = useTransition();
  const isBusy = disabled || clicked || isPending;

  useEffect(() => {
    if (isPending || !clicked) return;

    const timer = window.setTimeout(() => {
      clickedRef.current = false;
      setClicked(false);
    }, 1000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isPending, clicked]);

  return (
    <button
      type="button"
      disabled={isBusy}
      aria-disabled={isBusy}
      data-busy={isBusy ? "true" : "false"}
      onClick={() => {
        if (clickedRef.current || disabled) return;

        clickedRef.current = true;
        setClicked(true);

        startTransition(() => {
          if (replace) {
            router.replace(href, { scroll });
            return;
          }

          router.push(href, { scroll });
        });
      }}
      className={`${className} disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {children}
    </button>
  );
}
