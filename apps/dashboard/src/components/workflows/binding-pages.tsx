/**
 * The pages of account actions (C118.7) and case actions (C140.1), C141.7, under
 * `workflows:write`: the bindings with their workflow and target, a form to bind a running
 * workflow, and one action's page with its label, status and parameter form prefill.
 */
import type { OpenVerifyClient } from '@openverify/node';
import Link from 'next/link';
import { DataTable } from '../data-table';
import { PageSection } from '../lifecycle/page-section';
import { LINK_CLASS } from '../link-styles';
import { PageHeader } from '../page-header';
import { PageMain } from '../page-main';
import {
  CreateBindingForm,
  EditBindingForm,
  type BindingKind,
  type Choice,
} from './action-bindings';

const code = (value: string) => <code className="font-mono text-xs break-all">{value}</code>;

const TITLES = {
  account: { list: 'Account actions', one: 'Account action', path: '/account-actions' },
  case: { list: 'Case actions', one: 'Case action', path: '/case-actions' },
} as const;

/** A binding as both pages list it. */
export interface BindingRow {
  readonly id: string;
  readonly label: string;
  readonly status: 'active' | 'archived';
  readonly workflowId: string;
  readonly targets: readonly string[];
}

/** Running workflows, newest first, as choices. */
export async function runningWorkflows(api: OpenVerifyClient): Promise<Choice[]> {
  const { data } = await api.workflows.list({
    filter: { status: ['running'] },
    page: { size: 100 },
  });
  return data.map((workflow) => ({ id: workflow.id, label: workflow.attributes.name }));
}

/** The bound workflow's live trigger inputs, or none when it has no live version. */
export async function liveInputsOf(
  api: OpenVerifyClient,
  workflowId: string,
): Promise<{ readonly name: string; readonly type: string }[]> {
  const { data: workflow } = await api.workflows.retrieve(workflowId);
  const live = workflow.relationships['latest-published-version'].data;
  if (live === null) {
    return [];
  }
  const { data: version } = await api.workflowVersions.retrieve(live.id);
  return version.attributes.inputs.map((input) => ({ name: input.name, type: input.type }));
}

export function BindingListPage({
  kind,
  rows,
  workflows,
  targets,
  action,
}: {
  readonly kind: BindingKind;
  readonly rows: readonly BindingRow[];
  readonly workflows: readonly Choice[];
  readonly targets: readonly Choice[];
  readonly action: Parameters<typeof CreateBindingForm>[0]['action'];
}) {
  const titles = TITLES[kind];
  return (
    <PageMain className="gap-8">
      <PageHeader
        breadcrumbs={[{ label: 'Workflows', href: '/workflows' }, { label: titles.list }]}
        title={titles.list}
        description="Running workflows offered as one-click actions, with a parameter form from the trigger's inputs."
      />
      <DataTable
        caption={titles.list}
        captionHidden
        rows={rows}
        getRowKey={(row) => row.id}
        emptyMessage="No action is bound yet."
        columns={[
          {
            id: 'label',
            header: 'Label',
            rowHeader: true,
            cell: (row) => (
              <Link href={`${titles.path}/${row.id}`} className={LINK_CLASS}>
                {row.label}
              </Link>
            ),
          },
          {
            id: 'status',
            header: 'Status',
            cell: (row) => (row.status === 'active' ? 'Active' : 'Archived'),
          },
          {
            id: 'workflow',
            header: 'Workflow',
            cell: (row) => (
              <Link href={`/workflows/${row.workflowId}`} className={LINK_CLASS}>
                {code(row.workflowId)}
              </Link>
            ),
          },
          {
            id: 'targets',
            header: kind === 'account' ? 'Account type' : 'Case templates',
            cell: (row) => row.targets.join(', '),
          },
        ]}
      />
      <PageSection id="new-binding" title="Bind a workflow">
        {workflows.length === 0 ? (
          <p className="text-sm">No workflow is running, so none can be bound yet.</p>
        ) : (
          <CreateBindingForm kind={kind} workflows={workflows} targets={targets} action={action} />
        )}
      </PageSection>
    </PageMain>
  );
}

export function BindingPage({
  kind,
  row,
  prefill,
  inputs,
  action,
}: {
  readonly kind: BindingKind;
  readonly row: BindingRow;
  readonly prefill: Readonly<Record<string, string>>;
  readonly inputs: readonly { readonly name: string; readonly type: string }[];
  readonly action: Parameters<typeof EditBindingForm>[0]['action'];
}) {
  const titles = TITLES[kind];
  return (
    <PageMain className="gap-8">
      <PageHeader
        breadcrumbs={[
          { label: 'Workflows', href: '/workflows' },
          { label: titles.list, href: titles.path },
          { label: code(row.id) },
        ]}
        title={row.label}
        description={`${titles.one} of workflow ${row.workflowId}`}
      />
      <EditBindingForm
        kind={kind}
        id={row.id}
        label={row.label}
        status={row.status}
        {...(kind === 'case' ? { caseTemplateIds: row.targets } : {})}
        inputs={inputs}
        prefill={prefill}
        action={action}
      />
    </PageMain>
  );
}
