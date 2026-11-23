import Link from "next/link";

export default function MenuCard({ href, children }: { href: string; children: string }) {
  return <Link href={href} className="ui-menu-card"><h2>{children}</h2><span aria-hidden="true">→</span></Link>;
}
