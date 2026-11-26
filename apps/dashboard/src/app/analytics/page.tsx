import type { Metadata } from 'next';
import { renderAnalyticsView } from '../../components/analytics/analytics-view-page';

export const metadata: Metadata = { title: 'Analytics' };

export interface AnalyticsPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** The Analytics section's overview: inquiries by outcome (C164.1, C164.9). */
export default async function AnalyticsPage({ searchParams }: AnalyticsPageProps) {
  return renderAnalyticsView({ view: 'overview', params: await searchParams, now: new Date() });
}
