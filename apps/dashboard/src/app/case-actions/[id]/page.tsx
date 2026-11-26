import { idSchema } from '@openverify/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BindingPage, liveInputsOf } from '../../../components/workflows/binding-pages';
import { renderPage } from '../../../lib/api/page';
import { updateCaseAction } from '../../workflows/binding-actions';

export const metadata: Metadata = { title: 'Case action' };

/** C140.1, C141.7: one case action: its label, templates, status and parameter form prefill. */
export default async function CaseActionPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!idSchema('cact').safeParse(id).success) {
    notFound();
  }
  return renderPage({ permissions: ['workflows:write'] }, async ({ api }) => {
    const { data: action } = await api.caseActions.retrieve(id);
    const workflowId = action.relationships.workflow.data.id;
    const inputs = await liveInputsOf(api, workflowId);
    return (
      <BindingPage
        kind="case"
        row={{
          id: action.id,
          label: action.attributes.label,
          status: action.attributes.status,
          workflowId,
          targets: action.relationships['case-templates'].data.map((template) => template.id),
        }}
        prefill={action.attributes.prefill}
        inputs={inputs}
        action={updateCaseAction}
      />
    );
  });
}
