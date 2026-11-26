'use client';

import type { GraphQueryResource } from '@openverify/contracts';
import { Button } from '@openverify/ui';
import Link from 'next/link';
import { useState } from 'react';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { DataTable } from '../data-table';
import { FormField, controlClassName } from '../form-field';
import { LINK_CLASS } from '../link-styles';
import { ProblemDisplay } from '../problem-display';
import { useFormAction } from '../use-form-action';
import { directConnections, graphOfResult } from './explorer-model';
import {
  GRAPH_STATUS_WORDS,
  describeGraphProblem,
  graphKindLabel,
  truncationSentences,
} from './graph-words';

export interface AccountGraphPanelProps {
  readonly accountId: string;
  /** The active, published templates that bind `account_id`. */
  readonly templates: readonly { readonly id: string; readonly name: string }[];
  /** Whether the role may run a query (`graph:write`). */
  readonly canRun: boolean;
  readonly action: (
    state: ActionState<GraphQueryResource>,
    formData: FormData,
  ) => Promise<ActionResult<GraphQueryResource>>;
}

/**
 * The account page's graph panel (C108): direct connections from a chosen template with
 * `account_id` bound to this account, run only when the operator presses the button (never on
 * render: the `graph-queries` policy allows 30 runs a minute per environment, two synchronous at
 * once), and the result opened in the explorer.
 */
export function AccountGraphPanel({
  accountId,
  templates,
  canRun,
  action,
}: AccountGraphPanelProps) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [result, setResult] = useState<GraphQueryResource | null>(null);
  const form = useFormAction(action, { onSuccess: setResult });

  if (templates.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No published template takes an account_id parameter, so no direct connections can be shown.
        Create one under{' '}
        <Link href="/graph/templates" className={LINK_CLASS}>
          Query templates
        </Link>
        .
      </p>
    );
  }

  const connections = result === null ? [] : directConnections(graphOfResult(result), accountId);
  const sentences =
    result === null ? [] : truncationSentences({ ...result.attributes, nodeLimit: null });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <FormField label="Template" className="min-w-64">
          {(control) => (
            <select
              {...control}
              className={controlClassName(control)}
              value={templateId}
              onChange={(event) => {
                setTemplateId(event.currentTarget.value);
              }}
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          )}
        </FormField>
        {canRun && (
          <Button
            disabled={form.pending}
            onClick={() => {
              const data = new FormData();
              data.set('graph-query-template-id', templateId);
              data.set('account-id', accountId);
              form.submit(data);
            }}
          >
            {form.pending ? 'Running…' : 'Show direct connections'}
          </Button>
        )}
      </div>
      {!canRun && (
        <p className="text-sm text-ink-muted">
          Running a query needs graph:write, which your role does not hold.
        </p>
      )}
      <ProblemDisplay
        problem={form.problem === undefined ? undefined : describeGraphProblem(form.problem)}
      />
      {result !== null && (
        <div className="flex flex-col gap-3">
          {result.attributes.status !== 'completed' && (
            <p className="text-sm">{GRAPH_STATUS_WORDS[result.attributes.status].description}</p>
          )}
          {sentences.length > 0 && (
            <ul className="list-disc ps-5 text-sm">
              {sentences.map((sentence) => (
                <li key={sentence}>{sentence}</li>
              ))}
            </ul>
          )}
          {connections.length === 0 ? (
            <p className="text-sm">
              This account shares no value with another account in this result.
            </p>
          ) : (
            <DataTable
              caption="Direct connections"
              columns={[
                {
                  id: 'account',
                  header: 'Account',
                  rowHeader: true,
                  cell: (row) => (
                    <Link
                      href={`/accounts/${row.id}`}
                      className={`${LINK_CLASS} font-mono text-xs`}
                    >
                      {row.id}
                    </Link>
                  ),
                },
                {
                  id: 'kinds',
                  header: 'Shares',
                  cell: (row) => row.kinds.map(graphKindLabel).join(', '),
                },
              ]}
              rows={connections}
              getRowKey={(row) => row.id}
              emptyMessage="No direct connection."
            />
          )}
          <p className="text-sm">
            <Link href={`/graph/${result.id}`} className={LINK_CLASS}>
              Open in the explorer
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
