/**
 * One view of the Analytics section (C164.9), rendered per request under `analytics:read`: the
 * view links, the filters, the answer of `GET /analytics/<report>` and what its figures mean. With
 * no window in the URL, it asks for the 30 local days ending today in the reporting time zone,
 * which only the answer names: when today there is another day than in UTC, it asks once more.
 */
import { Alert } from '@openverify/ui';
import type { ReactNode } from 'react';
import { readAnalytics, type AnalyticsDocuments } from '../../lib/api/analytics';
import type { DashboardSession } from '../../lib/api/me';
import { renderPage } from '../../lib/api/page';
import { ANALYTICS_COPY, fillCopy } from '../../lib/copy/analytics';
import { PageHeader } from '../page-header';
import { PageMain } from '../page-main';
import {
  ANALYTICS_VIEW_REPORTS,
  localDayIn,
  parseAnalyticsQuery,
  type AnalyticsQuery,
  type AnalyticsView,
} from './analytics-query';
import { analyticsMetricsOf } from '@openverify/core';
import { hasPermission } from '../../lib/api/me';
import { AnalyticsAbout, aboutLines, definitionsOf } from './analytics-about';
import { AnalyticsDownload } from './analytics-download';
import { AnalyticsFilters } from './analytics-filters';
import { AnalyticsTabs } from './analytics-tabs';
import { CasesView } from './cases-view';
import { ChecksView } from './checks-view';
import { FunnelView } from './funnel-view';
import { OverviewView } from './overview-view';
import { SignalsView } from './signals-view';
import { VerificationsView } from './verifications-view';

export interface AnalyticsViewPageProps {
  readonly view: AnalyticsView;
  readonly params: Readonly<Record<string, string | string[] | undefined>>;
  /** The instant "today" is read from (the page passes the request's time). */
  readonly now: Date;
}

type AnyAnswer = AnalyticsDocuments[keyof AnalyticsDocuments];

/** Reads the view's answer; a defaulted window is moved to the reporting zone's today. */
async function answerOf(
  props: AnalyticsViewPageProps,
  query: AnalyticsQuery & { api: Readonly<Record<string, string>> },
): Promise<{ query: AnalyticsQuery; answer: AnyAnswer }> {
  const report = ANALYTICS_VIEW_REPORTS[props.view];
  const answer = await readAnalytics(report, query.api);
  const windowNamed = props.params.from !== undefined || props.params.to !== undefined;
  const today = localDayIn(props.now, answer.data.attributes['time-zone']);
  if (windowNamed || today === query.values.to) {
    return { query, answer };
  }
  const moved = parseAnalyticsQuery(props.view, props.params, today);
  return moved.api === null
    ? { query, answer }
    : { query: moved, answer: await readAnalytics(report, moved.api) };
}

export async function renderAnalyticsView(props: AnalyticsViewPageProps): Promise<ReactNode> {
  const first = parseAnalyticsQuery(props.view, props.params, localDayIn(props.now, 'UTC'));
  return renderPage({ permissions: ['analytics:read'] }, async ({ session }) => {
    const header = (
      <PageHeader
        title={ANALYTICS_COPY.section.title}
        description={ANALYTICS_COPY.section.description}
      />
    );
    if (first.api === null) {
      return (
        <PageMain>
          {header}
          <AnalyticsTabs current={props.view} window={windowOf(first)} />
          <AnalyticsFilters query={first} />
          <Alert tone="warning" title={ANALYTICS_COPY.filters.checkFilters}>
            {ANALYTICS_COPY.filters.checkFiltersBody}
          </Alert>
        </PageMain>
      );
    }
    const { query, answer } = await answerOf(props, { ...first, api: first.api });
    const report = ANALYTICS_VIEW_REPORTS[props.view];
    const metrics = analyticsMetricsOf(report).map((metric) => metric.key);
    const attributes = answer.data.attributes;
    const title = ANALYTICS_COPY.views[props.view].title;
    return (
      <PageMain className="gap-6">
        {header}
        <AnalyticsTabs current={props.view} window={windowOf(query)} />
        <h2 className="text-xl font-semibold">{title}</h2>
        <AnalyticsFilters query={query} />
        <div id={FIGURES_ID} className="flex flex-col gap-6">
          {viewOf(answer, query, session)}
        </div>
        <AnalyticsDownload
          fileName={`analytics-${props.view}-${attributes.from}-to-${attributes.to}.csv`}
          tablesId={FIGURES_ID}
          preamble={[
            [fillCopy(ANALYTICS_COPY.download.title, { view: title })],
            ...aboutLines(report, attributes).map((line) => [line]),
            ...definitionsOf(report, metrics).map(([label, definition]) => [
              ANALYTICS_COPY.download.definition,
              label,
              definition,
            ]),
          ]}
        />
        <AnalyticsAbout report={report} attributes={attributes} metrics={metrics} />
      </PageMain>
    );
  });
}

/** The view's figures, from its answer. */
function viewOf(answer: AnyAnswer, query: AnalyticsQuery, session: DashboardSession): ReactNode {
  switch (answer.data.type) {
    case 'analytics-inquiries':
      return (
        <OverviewView
          answer={answer as AnalyticsDocuments['inquiries']}
          tagged={query.values.tag !== ''}
        />
      );
    case 'analytics-funnel':
      return <FunnelView answer={answer as AnalyticsDocuments['funnel']} />;
    case 'analytics-verifications':
      return <VerificationsView answer={answer as AnalyticsDocuments['verifications']} />;
    case 'analytics-checks':
      return <ChecksView answer={answer as AnalyticsDocuments['checks']} />;
    case 'analytics-cases':
      return (
        <CasesView
          answer={answer as AnalyticsDocuments['cases']}
          mayReadAssignees={hasPermission(session, 'users:write')}
        />
      );
    default:
      return <SignalsView answer={answer as AnalyticsDocuments['signals']} />;
  }
}

/** The element holding the view's tables, which the download reads (K9-18). */
const FIGURES_ID = 'analytics-figures';

const windowOf = (query: AnalyticsQuery) => ({
  from: query.values.from,
  to: query.values.to,
  bucket: query.values.bucket,
});
