import type { ReactNode } from "react";

interface PageHeaderProps {
  actions?: ReactNode;
  eyebrow?: string;
  subtitle: string;
  title: string;
}
export function PageHeader({ actions, eyebrow, subtitle, title }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}
