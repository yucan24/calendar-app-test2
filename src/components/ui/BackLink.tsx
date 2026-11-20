import Link from "next/link";
import type { ReactNode } from "react";

export default function BackLink({ href, children = "一覧に戻る", className = "" }: { href: string; children?: ReactNode; className?: string }) {
  return <Link href={href} className={`ui-button ui-button-secondary ui-back-link ${className}`}>
    <span aria-hidden="true">←</span><span>{children}</span>
  </Link>;
}
