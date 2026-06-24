"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

type SubmitButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  pendingText?: ReactNode;

  /**
   * Client Component側で useTransition の isPending を使っている場合に渡す
   * 例：<SubmitButton busy={isPending}>保存</SubmitButton>
   */
  busy?: boolean;
};

export default function SubmitButton({
  children,
  pendingText = "処理中...",
  className = "",
  disabled,
  busy = false,
  type,
  onClick,
  ...props
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  const clickedRef = useRef(false);
  const [clicked, setClicked] = useState(false);

  const isBusy = Boolean(disabled || pending || busy || clicked);

  useEffect(() => {
    if (pending || busy) return;

    if (!clicked) {
      clickedRef.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      clickedRef.current = false;
      setClicked(false);
    }, 500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [pending, busy, clicked]);

  return (
    <button
      {...props}
      type={type ?? "submit"}
      disabled={isBusy}
      aria-disabled={isBusy}
      data-busy={isBusy ? "true" : "false"}
      onClick={(event) => {
        if (clickedRef.current || pending || busy || disabled) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        onClick?.(event);

        if (event.defaultPrevented) {
          return;
        }

        clickedRef.current = true;
        setClicked(true);
      }}
      className={`${className} disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-50`}
    >
      {isBusy ? pendingText : children}
    </button>
  );
}
