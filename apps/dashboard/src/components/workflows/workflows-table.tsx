import type { WorkflowResource } from '@openverify/contracts';
import Link from 'next/link';
import { DataTable } from '../data-table';
import { LINK_CLASS } from '../link-styles';
import { Timestamp } from '../timestamp';
import { WORKFLOW_PAUSED_REASON_WORDS, WORKFLOW_STATUS_WORDS, wordOf } from './workflow-words';

/** The environment's workflows (C141): name, kind, status with its paused reason, updated. */
export function WorkflowsTable({ workflows }: { readonly workflows: readonly WorkflowResource[] }) {
  return (
    <DataTable
      caption="Workflows"
      captionHidden
      rows={workflows}
      getRowKey={(workflow) => workflow.id}
      emptyMessage="No workflow yet. Install a recipe below, or create one with the API."
      columns={[
        {
          id: 'name',
          header: 'Name',
          rowHeader: true,
          cell: (workflow) => (
            <Link href={`/workflows/${workflow.id}`} className={LINK_CLASS}>
              {workflow.attributes.name}
            </Link>
          ),
        },
        {
          id: 'kind',
          header: 'Kind',
          cell: (workflow) => (workflow.attributes.kind === 'module' ? 'Module' : 'Workflow'),
        },
        {
          id: 'status',
          header: 'Status',
          cell: (workflow) => {
            const reason = workflow.attributes['paused-reason'];
            return (
              <>
                {wordOf(WORKFLOW_STATUS_WORDS, workflow.attributes.status)}
                {reason !== null && (
                  <span className="block text-xs text-ink-muted">
                    {wordOf(WORKFLOW_PAUSED_REASON_WORDS, reason)}
                  </span>
                )}
              </>
            );
          },
        },
        {
          id: 'updated',
          header: 'Updated (UTC)',
          cell: (workflow) => <Timestamp value={workflow.attributes['updated-at']} />,
        },
      ]}
    />
  );
}
