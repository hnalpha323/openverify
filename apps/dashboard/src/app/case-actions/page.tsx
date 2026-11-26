import type { Metadata } from 'next';
import { BindingListPage, runningWorkflows } from '../../components/workflows/binding-pages';
import { renderPage } from '../../lib/api/page';
import { createCaseAction } from '../workflows/binding-actions';

export const metadata: Metadata = { title: 'Case actions' };

/** C140.1, C141.7: the case actions, and binding a running workflow as one. */
export default async function CaseActionsPage() {
  return renderPage({ permissions: ['workflows:write'] }, async ({ api }) => {
    const [actions, workflows] = await Promise.all([
      api.caseActions.list({ page: { size: 100 } }),
      runningWorkflows(api),
    ]);
    return (
      <BindingListPage
        kind="case"
        rows={actions.data.map((action) => ({
          id: action.id,
          label: action.attributes.label,
          status: action.attributes.status,
          workflowId: action.relationships.workflow.data.id,
          targets: action.relationships['case-templates'].data.map((template) => template.id),
        }))}
        workflows={workflows}
        targets={[]}
        action={createCaseAction}
      />
    );
  });
}
