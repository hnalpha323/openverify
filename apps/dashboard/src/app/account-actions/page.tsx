import type { Metadata } from 'next';
import { BindingListPage, runningWorkflows } from '../../components/workflows/binding-pages';
import { renderPage } from '../../lib/api/page';
import { createAccountAction } from '../workflows/binding-actions';

export const metadata: Metadata = { title: 'Account actions' };

/** C118.7, C141.7: the account actions, and binding a running workflow as one. */
export default async function AccountActionsPage() {
  return renderPage({ permissions: ['workflows:write'] }, async ({ api }) => {
    const [actions, workflows, types] = await Promise.all([
      api.accountActions.list({ page: { size: 100 } }),
      runningWorkflows(api),
      api.accountTypes.list({ page: { size: 100 } }),
    ]);
    return (
      <BindingListPage
        kind="account"
        rows={actions.data.map((action) => ({
          id: action.id,
          label: action.attributes.label,
          status: action.attributes.status,
          workflowId: action.relationships.workflow.data.id,
          targets: [action.relationships['account-type'].data.id],
        }))}
        workflows={workflows}
        targets={types.data.map((type) => ({ id: type.id, label: type.attributes.name }))}
        action={createAccountAction}
      />
    );
  });
}
