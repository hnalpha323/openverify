import { idSchema } from '@openverify/contracts';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { BulkReportForm } from '../../../components/analytics/bulk-report-form';
import { BulkReportJob } from '../../../components/analytics/bulk-report-job';
import { PageSection } from '../../../components/lifecycle/page-section';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { hasPermission } from '../../../lib/api/me';
import { renderPage } from '../../../lib/api/page';
import { listTemplateChoices } from '../../../lib/api/report-templates';
import { getReportBulkJob } from '../../../lib/api/reports-bulk';
import { ANALYTICS_COPY } from '../../../lib/copy/analytics';

export const metadata: Metadata = { title: 'Bulk reports' };

export interface BulkReportsPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const COPY = ANALYTICS_COPY.bulk;

/**
 * Bulk report creation (C166.5, C166.6), under `reports:write`: a report template and a CSV of at
 * most 1,000 rows and 2 MiB, uploaded through the console's streaming route, and, with
 * `?job=rbulk_…`, that job with every row's outcome. The active templates are offered to a reader of
 * report templates; anyone else enters a template ID (K9-20).
 */
export default async function BulkReportsPage({
  searchParams,
}: BulkReportsPageProps): Promise<ReactNode> {
  const { job } = await searchParams;
  const jobId = typeof job === 'string' && idSchema('rbulk').safeParse(job).success ? job : null;
  return renderPage({ permissions: ['reports:write'] }, async ({ session, api }) => {
    const [choices, shown] = await Promise.all([
      // K9-20: without report-templates:read the list is not read, and the form takes an ID.
      hasPermission(session, 'report-templates:read')
        ? listTemplateChoices(api, 'active')
        : Promise.resolve(null),
      jobId === null ? Promise.resolve(null) : getReportBulkJob(jobId),
    ]);
    return (
      <PageMain className="gap-8">
        <PageHeader
          breadcrumbs={[{ label: 'Exports', href: '/exports' }, { label: COPY.title }]}
          title={COPY.title}
          description={COPY.description}
        />
        {shown !== null && <BulkReportJob job={shown.data} />}
        <PageSection id="bulk-report-upload" title={COPY.formLabel}>
          <BulkReportForm
            templates={
              choices === null
                ? null
                : choices.templates.map((template) => ({
                    id: template.id,
                    name: template.attributes.name,
                  }))
            }
          />
        </PageSection>
      </PageMain>
    );
  });
}
