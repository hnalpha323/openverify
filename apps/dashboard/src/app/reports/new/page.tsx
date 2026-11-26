import { REPORT_REGISTRY } from '@openverify/core';
import { Alert, Button } from '@openverify/ui';
import type { Metadata } from 'next';
import { EmptyState } from '../../../components/empty-state';
import { FormField, controlClassName } from '../../../components/form-field';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { Detail } from '../../../components/detail';
import { StageBadge } from '../../../components/reports/report-badges';
import { CreateReportForm } from '../../../components/reports/create-report-form';
import { hasPermission } from '../../../lib/api/me';
import { renderPage } from '../../../lib/api/page';
import { MAX_TEMPLATE_CHOICES, listTemplateChoices } from '../../../lib/api/report-templates';
import { REPORT_TYPE_LABELS } from '../../../lib/labels';
import { REPORT_TIER_WORDS } from '../../../lib/report-type-words';
import { createReport } from '../actions';

export const metadata: Metadata = { title: 'Create report' };

const LISTED = MAX_TEMPLATE_CHOICES.toLocaleString('en-US');
const TRUNCATED = `Only the first ${LISTED} active templates are listed.`;

export interface NewReportPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Create a report (C72.1, C86): choose one of the environment's active report templates (a plain
 * GET form, `?template=`), then enter the query of its type. Needs `reports:write`, and
 * `report-templates:read` to list the templates. The report is created in the session's
 * environment with `origin: dashboard`.
 */
export default async function NewReportPage({ searchParams }: NewReportPageProps) {
  const params = await searchParams;
  const chosen = typeof params.template === 'string' ? params.template : undefined;
  return renderPage(
    { permissions: ['reports:write', 'report-templates:read'] },
    async ({ session, api }) => {
      // Workflow 6B R013: every page of the active templates, up to the picker's cap.
      const { templates, truncated } = await listTemplateChoices(api, 'active');
      const template = templates.find((each) => each.id === chosen);
      const header = (
        <PageHeader
          breadcrumbs={[{ label: 'Reports', href: '/reports' }, { label: 'Create report' }]}
          title="Create report"
          description="Screen one subject with a report template of this environment."
        />
      );
      if (templates.length === 0) {
        return (
          <PageMain width="narrow">
            {header}
            <EmptyState title="No active report template">
              A report runs from a published template. Create one under Report templates first.
            </EmptyState>
          </PageMain>
        );
      }
      const type = template?.attributes['report-type'];
      const definition = type === undefined ? undefined : REPORT_REGISTRY[type];
      return (
        <PageMain width="narrow">
          {header}
          <form
            aria-label="Choose a report template"
            method="get"
            action="/reports/new"
            className="flex flex-wrap items-end gap-4 rounded-xl border border-line bg-surface p-4"
          >
            <FormField
              label="Report template"
              className="min-w-64 flex-1"
              {...(truncated ? { description: TRUNCATED } : {})}
            >
              {(control) => (
                <select
                  {...control}
                  name="template"
                  defaultValue={template?.id ?? ''}
                  className={controlClassName(control)}
                >
                  {templates.map((each) => (
                    <option key={each.id} value={each.id}>
                      {each.attributes.name} (
                      {REPORT_TYPE_LABELS[`report/${each.attributes['report-type']}`]})
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <Button type="submit" variant="secondary">
              Continue
            </Button>
          </form>
          {chosen !== undefined &&
            template === undefined &&
            (truncated ? (
              // A template past the cap may be active: it is not listed, not unavailable.
              <Alert tone="warning" title="Template not listed">
                This template is not among the first {LISTED} active templates listed. Choose one
                from the list.
              </Alert>
            ) : (
              <Alert tone="warning" title="Template not available">
                Choose an active report template from the list.
              </Alert>
            ))}
          {template !== undefined && type !== undefined && definition !== undefined && (
            <>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Detail term="Template">{template.attributes.name}</Detail>
                <Detail term="Type">{REPORT_TYPE_LABELS[`report/${type}`]}</Detail>
                <Detail term="Stage">
                  <StageBadge stage={definition.stage} />
                </Detail>
                <Detail term="Tiers">
                  {definition.tiers.map((tier) => REPORT_TIER_WORDS[tier]).join('; ')}
                </Detail>
              </dl>
              <CreateReportForm
                type={type}
                templateId={template.id}
                environmentId={session.environment.id}
                canLinkAccounts={hasPermission(session, 'accounts:read')}
                action={createReport}
              />
            </>
          )}
        </PageMain>
      );
    },
  );
}
