import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ANALYTICS_VIEWS, type AnalyticsView } from '../../../components/analytics/analytics-query';
import { renderAnalyticsView } from '../../../components/analytics/analytics-view-page';

export const metadata: Metadata = { title: 'Analytics' };

export interface AnalyticsViewRouteProps {
  readonly params: Promise<{ view: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const isView = (value: string): value is AnalyticsView =>
  value !== 'overview' && (ANALYTICS_VIEWS as readonly string[]).includes(value);

/** The funnel, verifications, checks, cases and signals views (C164.2-C164.6, C164.9). */
export default async function AnalyticsViewRoute({
  params,
  searchParams,
}: AnalyticsViewRouteProps) {
  const { view } = await params;
  if (!isView(view)) {
    notFound();
  }
  return renderAnalyticsView({ view, params: await searchParams, now: new Date() });
}
