"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

type SubmitButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  pendingText?: ReactNode;
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

  const buttonType = type ?? "submit";
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
    }, 800);

    return () => {
      window.clearTimeout(timer);
    };
  }, [pending, busy, clicked]);

  return (
    <button
      {...props}
      type={buttonType}
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

        /*
          submitボタンの場合、クリック直後にdisabledへ切り替えると
          ブラウザのform submit自体が止まることがある。
          そのため、disabled化は次のtickへ遅らせる。
        */
        window.setTimeout(() => {
          setClicked(true);
        }, 0);
      }}
      className={`${className} disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {isBusy ? pendingText : children}
    </button>
  );
}
