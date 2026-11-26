import type { Metadata } from 'next';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { CreateReportTemplateForm } from '../../../components/report-config/report-config-forms';
import { readListChoices } from '../../../components/schema-form/list-choices';
import { hasPermission } from '../../../lib/api/me';
import { renderPage } from '../../../lib/api/page';
import { TEMPLATE_FORMS_COPY } from '../../../lib/copy/template-forms';
import { createReportTemplate } from '../actions';

const COPY = TEMPLATE_FORMS_COPY.reportForms;

export const metadata: Metadata = { title: COPY.newTitle };

/**
 * A new report template (C153.4, K14): its name, its type and its configuration as a form generated
 * from the type's contract; the environment's lists for a custom-list template, with `lists:read`.
 */
export default async function NewReportTemplatePage() {
  return renderPage({ permissions: ['report-templates:write'] }, async ({ session, api }) => {
    const lists = hasPermission(session, 'lists:read') ? await readListChoices(api) : [];
    return (
      <PageMain width="narrow" className="gap-6">
        <PageHeader
          breadcrumbs={[
            { label: COPY.breadcrumb, href: '/report-templates' },
            { label: COPY.newTitle },
          ]}
          title={COPY.newTitle}
          description={COPY.newDescription}
        />
        <CreateReportTemplateForm action={createReportTemplate} lists={lists} />
      </PageMain>
    );
  });
}
