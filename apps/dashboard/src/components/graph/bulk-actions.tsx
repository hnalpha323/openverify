'use client';

import { GRAPH_LIMITS, type GraphKind } from '@openverify/contracts';
import type { GraphBulkAction } from '@openverify/core';
import { Button } from '@openverify/ui';
import Link from 'next/link';
import { useId, useRef, useState } from 'react';
import type { BulkActionAnswer } from '../../app/graph/actions';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ConfirmDialog } from '../confirm-dialog';
import { DataTable } from '../data-table';
import { FormField, controlClassName } from '../form-field';
import { LINK_CLASS } from '../link-styles';
import { ProblemDisplay } from '../problem-display';
import { useFormAction } from '../use-form-action';
import {
  GRAPH_ACTION_WORDS,
  GRAPH_OUTCOME_WORDS,
  describeGraphProblem,
  graphKindLabel,
} from './graph-words';

export interface BulkActionsProps {
  readonly queryId: string;
  /** The accounts of the stored result. */
  readonly accountCount: number;
  readonly selected: ReadonlySet<string>;
  /** Which actions the role's scopes allow (C103.2). */
  readonly abilities: {
    readonly tags: boolean;
    readonly lists: boolean;
    readonly export: boolean;
    /** C140.6: `create-case`, with `cases:write`. */
    readonly cases?: boolean;
  };
  /** The kinds of the result's shared values, for `add-to-list`. */
  readonly kinds: readonly GraphKind[];
  /** The lists `add-to-list` may fill, when the role reads them. */
  readonly lists?: readonly { readonly id: string; readonly name: string; readonly kind: string }[];
  /** C140.6: the published, active case templates `create-case` may use. */
  readonly caseTemplates?: readonly { readonly id: string; readonly name: string }[];
  /** C140.6: the queues the new case may enter, when the role reads them. */
  readonly caseQueues?: readonly { readonly id: string; readonly name: string }[];
  readonly action: (
    state: ActionState<BulkActionAnswer>,
    formData: FormData,
  ) => Promise<ActionResult<BulkActionAnswer>>;
}

type Scope = 'selected' | 'all';

const accounts = (count: number) => `${String(count)} ${count === 1 ? 'account' : 'accounts'}`;

/** The confirmation's question for `count` accounts. */
function questionOf(action: GraphBulkAction, count: number): string {
  switch (action) {
    case 'add-tag':
      return `Add a tag to ${accounts(count)}?`;
    case 'remove-tag':
      return `Remove a tag from ${accounts(count)}?`;
    case 'set-account-status':
      return `Set the status of ${accounts(count)}?`;
    case 'add-to-list':
      return `Add values of ${accounts(count)} to a list?`;
    case 'export':
      return `Export ${accounts(count)} as CSV?`;
    case 'create-case':
      return `Create one case holding ${accounts(count)}?`;
  }
}

/** "2 done, 1 skipped." */
function summaryOf(answer: BulkActionAnswer): string {
  const done = answer.outcomes.filter((each) => each.outcome === 'done').length;
  const skipped = answer.outcomes.filter((each) => each.outcome.startsWith('skipped_')).length;
  const refused = answer.outcomes.filter((each) => each.outcome === 'refused_scope').length;
  const parts = [
    `${String(done)} done`,
    ...(skipped > 0 ? [`${String(skipped)} skipped`] : []),
    ...(refused > 0 ? [`${String(refused)} refused`] : []),
  ];
  return `${parts.join(', ')}.`;
}

/**
 * Bulk actions on a graph result's accounts (C103, C108), from the table or the canvas selection,
 * or on every account of the result (at most 500, decision 37). Only the actions the role's scopes
 * allow are offered; the API checks them again and refuses the whole call with 403 otherwise. A
 * preview comes first and answers how many of the selection are in the stored result; a
 * confirmation applies it, and each account's outcome is said in words. The export downloads
 * through `app/graph/[id]/export`, which streams the CSV as the API answers it.
 */
export function BulkActions({
  queryId,
  accountCount,
  selected,
  abilities,
  kinds,
  lists = [],
  caseTemplates = [],
  caseQueues = [],
  action,
}: BulkActionsProps) {
  const available: GraphBulkAction[] = [
    ...(abilities.tags ? (['add-tag', 'remove-tag', 'set-account-status'] as const) : []),
    ...(abilities.lists ? (['add-to-list'] as const) : []),
    ...(abilities.export ? (['export'] as const) : []),
    ...(abilities.cases === true ? (['create-case'] as const) : []),
  ];
  const groupId = useId();
  const [chosen, setChosen] = useState<GraphBulkAction | undefined>(available[0]);
  const [scope, setScope] = useState<Scope>('selected');
  const [tag, setTag] = useState('');
  const [status, setStatus] = useState<'active' | 'archived'>('archived');
  const [listId, setListId] = useState(lists[0]?.id ?? '');
  const [kind, setKind] = useState<GraphKind | ''>(kinds[0] ?? '');
  const [caseTemplateId, setCaseTemplateId] = useState(caseTemplates[0]?.id ?? '');
  const [caseQueueId, setCaseQueueId] = useState('');
  // A preview holds for the selection it was asked for; another selection needs a new one.
  const [previewed, setPreviewed] = useState<{
    readonly answer: BulkActionAnswer;
    readonly key: string;
  } | null>(null);
  const [applied, setApplied] = useState<BulkActionAnswer | null>(null);
  const [confirming, setConfirming] = useState(false);
  const exportForm = useRef<HTMLFormElement>(null);
  const asked = useRef('');
  const form = useFormAction(action, {
    onSuccess: (answer) => {
      if (answer.preview) {
        setPreviewed({ answer, key: asked.current });
      } else {
        setApplied(answer);
        setPreviewed(null);
        setConfirming(false);
      }
    },
  });

  if (chosen === undefined) {
    return (
      <p className="text-sm text-ink-muted">
        Your role holds none of the scopes a bulk action needs (accounts:write for tags and
        statuses, lists:write with pii:view to add values to a list, accounts:read with pii:view to
        export, cases:write with case-templates:read to create a case).
      </p>
    );
  }

  const selection = [...selected];
  const selectionKey = `${scope}:${selection.join(',')}`;
  const preview = previewed?.key === selectionKey ? previewed.answer : null;
  const allTooLarge = accountCount > GRAPH_LIMITS.bulkAccounts;
  const selectionTooLarge = selection.length > GRAPH_LIMITS.bulkAccounts;
  const noTemplate = chosen === 'create-case' && caseTemplateId === '';
  const ready =
    !noTemplate && (scope === 'all' ? !allTooLarge : selection.length > 0 && !selectionTooLarge);
  const reset = () => {
    setPreviewed(null);
    setApplied(null);
    form.clearProblem();
  };

  const selectionFields = (data: FormData) => {
    if (scope === 'all') {
      data.set('all', 'true');
    } else {
      for (const id of selection) {
        data.append('account-id', id);
      }
    }
  };

  const formDataOf = (asPreview: boolean) => {
    const data = new FormData();
    data.set('graph-query-id', queryId);
    data.set('action', chosen);
    if (chosen === 'add-tag' || chosen === 'remove-tag') {
      data.set('tag', tag);
    } else if (chosen === 'set-account-status') {
      data.set('status', status);
    } else if (chosen === 'add-to-list') {
      data.set('list-id', listId);
      data.set('kind', kind);
    } else if (chosen === 'create-case') {
      data.set('case-template-id', caseTemplateId);
      data.set('case-queue-id', caseQueueId);
    }
    selectionFields(data);
    if (asPreview) {
      data.set('preview', 'true');
    }
    return data;
  };

  const previewSentence =
    preview === null
      ? null
      : scope === 'all'
        ? `${String(preview.selectedCount)} of the ${accounts(accountCount)} in the result would be acted on.`
        : `${String(preview.selectedCount)} of the ${String(selection.length)} selected accounts are in the stored result and would be acted on.`;

  return (
    <div className="flex flex-col gap-4">
      <FormField label="Action">
        {(control) => (
          <select
            {...control}
            className={controlClassName(control)}
            value={chosen}
            onChange={(event) => {
              setChosen(event.currentTarget.value as GraphBulkAction);
              reset();
            }}
          >
            {available.map((each) => (
              <option key={each} value={each}>
                {GRAPH_ACTION_WORDS[each]}
              </option>
            ))}
          </select>
        )}
      </FormField>

      <fieldset aria-labelledby={groupId} className="flex flex-col gap-2">
        <legend id={groupId} className="text-sm font-medium text-ink">
          Applies to
        </legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={`${groupId}-scope`}
            checked={scope === 'selected'}
            onChange={() => {
              setScope('selected');
              reset();
            }}
          />
          The selected accounts ({selection.length})
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={`${groupId}-scope`}
            checked={scope === 'all'}
            disabled={allTooLarge}
            onChange={() => {
              setScope('all');
              reset();
            }}
          />
          Every account in the result ({accountCount})
        </label>
        {allTooLarge && (
          <p className="text-sm text-ink-muted">
            A bulk action takes at most 500 accounts, and this result holds more: select at most 500
            of them.
          </p>
        )}
        {scope === 'selected' && selection.length === 0 && (
          <p className="text-sm text-ink-muted">
            Select accounts in the table or on the canvas, or choose every account in the result.
          </p>
        )}
        {scope === 'selected' && selectionTooLarge && (
          <p className="text-sm text-ink-muted">Select at most 500 accounts for one action.</p>
        )}
      </fieldset>

      {(chosen === 'add-tag' || chosen === 'remove-tag') && (
        <FormField label="Tag">
          {(control) => (
            <input
              {...control}
              className={controlClassName(control)}
              value={tag}
              onChange={(event) => {
                setTag(event.currentTarget.value);
                reset();
              }}
            />
          )}
        </FormField>
      )}
      {chosen === 'set-account-status' && (
        <FormField label="Status">
          {(control) => (
            <select
              {...control}
              className={controlClassName(control)}
              value={status}
              onChange={(event) => {
                setStatus(event.currentTarget.value as 'active' | 'archived');
                reset();
              }}
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          )}
        </FormField>
      )}
      {chosen === 'add-to-list' && (
        <>
          <FormField
            label="List"
            description="The values of the kind you choose are added as items, with you as their creator. Face and background lists are never filled in bulk."
          >
            {(control) => (
              <select
                {...control}
                className={controlClassName(control)}
                value={listId}
                onChange={(event) => {
                  setListId(event.currentTarget.value);
                  reset();
                }}
              >
                {lists.length === 0 && <option value="">No list to choose</option>}
                {lists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name} ({list.kind}, {list.id})
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label="Values of kind">
            {(control) => (
              <select
                {...control}
                className={controlClassName(control)}
                value={kind}
                onChange={(event) => {
                  setKind(event.currentTarget.value as GraphKind);
                  reset();
                }}
              >
                {kinds.map((each) => (
                  <option key={each} value={each}>
                    {graphKindLabel(each)}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        </>
      )}

      {chosen === 'create-case' &&
        (caseTemplates.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No published case template to create a case with: publish one first.
          </p>
        ) : (
          <>
            <FormField
              label="Case template"
              description="One case is created on it, holding the accounts of the selection."
            >
              {(control) => (
                <select
                  {...control}
                  className={controlClassName(control)}
                  value={caseTemplateId}
                  onChange={(event) => {
                    setCaseTemplateId(event.currentTarget.value);
                    reset();
                  }}
                >
                  {caseTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField label="Queue">
              {(control) => (
                <select
                  {...control}
                  className={controlClassName(control)}
                  value={caseQueueId}
                  onChange={(event) => {
                    setCaseQueueId(event.currentTarget.value);
                    reset();
                  }}
                >
                  <option value="">No queue: the template’s default</option>
                  {caseQueues.map((queue) => (
                    <option key={queue.id} value={queue.id}>
                      {queue.name}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          </>
        ))}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          disabled={!ready || form.pending}
          onClick={() => {
            reset();
            asked.current = selectionKey;
            form.submit(formDataOf(true));
          }}
        >
          Preview
        </Button>
        {preview !== null && (
          <Button
            onClick={() => {
              setConfirming(true);
            }}
            disabled={preview.selectedCount === 0}
          >
            {chosen === 'export' ? 'Download…' : 'Apply…'}
          </Button>
        )}
      </div>
      <p role="status" className="text-sm">
        {previewSentence ?? ''}
      </p>
      <ProblemDisplay
        problem={form.problem === undefined ? undefined : describeGraphProblem(form.problem)}
      />

      {preview !== null && (
        <ConfirmDialog
          open={confirming}
          title={questionOf(chosen, preview.selectedCount)}
          description={
            chosen === 'export'
              ? 'The file holds personal data of these accounts (their reference IDs and tags), and the export is recorded in the audit log. Its cells are already neutralised against spreadsheet formulas. Keep and delete it as your policy requires.'
              : chosen === 'create-case'
                ? 'One case is created on the chosen template, holding the accounts of the selection that are in the stored result; redacted and merged accounts are skipped. The case’s history names this query, and the action is recorded in the audit log.'
                : 'Each account is acted on as its own record, and the action is recorded in the audit log. Accounts that were redacted or merged are skipped.'
          }
          confirmLabel={chosen === 'export' ? 'Download CSV' : 'Apply'}
          pendingLabel="Applying…"
          tone="primary"
          pending={form.pending}
          onCancel={() => {
            setConfirming(false);
          }}
          onConfirm={() => {
            if (chosen === 'export') {
              exportForm.current?.requestSubmit();
              setConfirming(false);
            } else {
              form.submit(formDataOf(false));
            }
          }}
        >
          {chosen === 'export' && (
            <form
              ref={exportForm}
              data-export=""
              method="post"
              action={`/graph/${queryId}/export`}
              hidden
            >
              {scope === 'all' ? (
                <input type="hidden" name="all" value="true" />
              ) : (
                selection.map((id) => <input key={id} type="hidden" name="account-id" value={id} />)
              )}
            </form>
          )}
          <ProblemDisplay
            problem={form.problem === undefined ? undefined : describeGraphProblem(form.problem)}
          />
        </ConfirmDialog>
      )}

      {applied !== null && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{summaryOf(applied)}</p>
          {applied.action === 'create-case' &&
            (applied.caseId == null ? (
              <p className="text-sm">
                No case was made: none of the accounts could be held (redacted and merged accounts
                are skipped).
              </p>
            ) : (
              <p className="text-sm">
                <Link href={`/cases/${applied.caseId}`} className={LINK_CLASS}>
                  Open case {applied.caseId}
                </Link>
              </p>
            ))}
          <DataTable
            caption="Outcome of each account"
            columns={[
              {
                id: 'account',
                header: 'Account',
                rowHeader: true,
                cell: (row) => <code className="font-mono text-xs">{row.accountId}</code>,
              },
              { id: 'outcome', header: 'Outcome', cell: (row) => GRAPH_OUTCOME_WORDS[row.outcome] },
            ]}
            rows={applied.outcomes}
            getRowKey={(row) => row.accountId}
            emptyMessage="No account was acted on."
          />
        </div>
      )}
    </div>
  );
}
