import { idSchema } from '@openverify/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BindingPage, liveInputsOf } from '../../../components/workflows/binding-pages';
import { renderPage } from '../../../lib/api/page';
import { updateAccountAction } from '../../workflows/binding-actions';

export const metadata: Metadata = { title: 'Account action' };

/** C118.7, C141.7: one account action: its label, status and parameter form prefill. */
export default async function AccountActionPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!idSchema('accac').safeParse(id).success) {
    notFound();
  }
  return renderPage({ permissions: ['workflows:write'] }, async ({ api }) => {
    const { data: action } = await api.accountActions.retrieve(id);
    const workflowId = action.relationships.workflow.data.id;
    const inputs = await liveInputsOf(api, workflowId);
    return (
      <BindingPage
        kind="account"
        row={{
          id: action.id,
          label: action.attributes.label,
          status: action.attributes.status,
          workflowId,
          targets: [action.relationships['account-type'].data.id],
        }}
        prefill={action.attributes.prefill}
        inputs={inputs}
        action={updateAccountAction}
      />
    );
  });
}
