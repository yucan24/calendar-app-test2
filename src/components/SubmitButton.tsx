"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

type SubmitButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  pendingText?: string;
};

export default function SubmitButton({
  children,
  pendingText = "処理中...",
  className = "",
  disabled,
  type,
  onClick,
  ...props
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  const [clicked, setClicked] = useState(false);

  const isBusy = pending || clicked || disabled;

  useEffect(() => {
    if (!clicked) return;

    if (pending) return;

    const timer = window.setTimeout(() => {
      setClicked(false);
    }, 500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [clicked, pending]);

  return (
    <button
      {...props}
      type={type ?? "submit"}
      disabled={isBusy}
      aria-disabled={isBusy}
      onClick={(event) => {
        if (isBusy) {
          event.preventDefault();
          return;
        }

        setClicked(true);
        onClick?.(event);
      }}
      className={`${className} disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {isBusy ? pendingText : children}
    </button>
  );
}
