import Link from 'next/link';
import type { ReactNode } from 'react';
import { LINK_CLASS } from './link-styles';

export interface Breadcrumb {
  readonly label: ReactNode;
  /**
   * Leave out for the current page (the last breadcrumb), or for a parent the operator cannot
   * open, which then shows as plain text.
   */
  readonly href?: string;
}

export interface PageHeaderProps {
  /** The page's `<h1>`. */
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** Buttons or links for the page, such as "New webhook". */
  readonly actions?: ReactNode;
  readonly breadcrumbs?: readonly Breadcrumb[];
}

/** The top of a console page: breadcrumbs, the heading, a description and the page's actions. */
export function PageHeader({ title, description, actions, breadcrumbs }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3">
      {breadcrumbs !== undefined && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap gap-2 text-sm text-ink-muted">
            {breadcrumbs.map((crumb, index) => (
              <li key={index} className="flex gap-2">
                {index > 0 && <span aria-hidden="true">/</span>}
                {crumb.href === undefined ? (
                  <span aria-current={index === breadcrumbs.length - 1 ? 'page' : undefined}>
                    {crumb.label}
                  </span>
                ) : (
                  <Link href={crumb.href} className={LINK_CLASS}>
                    {crumb.label}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold break-words">{title}</h1>
          {description !== undefined && <p className="text-sm text-ink-muted">{description}</p>}
        </div>
        {actions !== undefined && <div className="flex flex-wrap gap-3">{actions}</div>}
      </div>
    </div>
  );
}
