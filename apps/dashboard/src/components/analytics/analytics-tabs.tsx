import Link from 'next/link';
import { ANALYTICS_COPY } from '../../lib/copy/analytics';
import { listHref } from '../../lib/list-query';
import { ANALYTICS_VIEWS, analyticsViewPath, type AnalyticsView } from './analytics-query';

export interface AnalyticsTabsProps {
  readonly current: AnalyticsView;
  /** The window the links keep, so a reader moving between views keeps their range. */
  readonly window: { readonly from: string; readonly to: string; readonly bucket: string };
}

/** The six views of the section as plain links (no client code); the current one is marked. */
export function AnalyticsTabs({ current, window }: AnalyticsTabsProps) {
  return (
    <nav aria-label={ANALYTICS_COPY.section.tabsLabel}>
      <ul className="flex flex-wrap gap-2 border-b border-line">
        {ANALYTICS_VIEWS.map((view) => (
          <li key={view}>
            <Link
              href={listHref(analyticsViewPath(view), window)}
              aria-current={view === current ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                view === current
                  ? 'border-primary text-ink'
                  : 'border-transparent text-ink-muted hover:text-ink'
              }`}
            >
              {ANALYTICS_COPY.views[view].label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
