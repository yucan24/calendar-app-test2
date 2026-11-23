import type { ReactNode } from "react";
import BackLink from "./BackLink";

type Props = { title: ReactNode; backHref?: string; backLabel?: string; actions?: ReactNode; children?: ReactNode };

export default function PageHeader({ title, backHref, backLabel = "一覧に戻る", actions, children }: Props) {
  return <header className="ui-page-header">
    {(backHref || actions) && <div className="ui-page-toolbar">
      {backHref && <BackLink href={backHref}>{backLabel}</BackLink>}
      {actions && <div className="ui-page-actions">{actions}</div>}
    </div>}
    <h1 className="ui-page-title">{title}</h1>
    {children && <div className="ui-page-meta">{children}</div>}
  </header>;
}
