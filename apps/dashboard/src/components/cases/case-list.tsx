'use client';

import { CASE_LIMITS, type CaseSlaState, type CaseStatusCategory } from '@openverify/core';
import { Button } from '@openverify/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import { fieldErrorOf, type ActionResult, type ActionState } from '../../lib/action-state';
import { ConfirmDialog } from '../confirm-dialog';
import { DataTable, type Column } from '../data-table';
import { withoutFieldErrors } from '../field-errors';
import { FormField, controlClassName } from '../form-field';
import { LINK_CLASS } from '../link-styles';
import { ProblemDisplay } from '../problem-display';
import { Timestamp, formatUtc } from '../timestamp';
import { useFormAction } from '../use-form-action';
import {
  BULK_ACTION_WORDS,
  SLA_STATE_WORDS,
  STATUS_CATEGORY_WORDS,
  casesCount,
} from './case-words';

/** One case as the list shows it: never its fields or its attachments (C142.1, P38). */
export interface CaseRow {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly category: CaseStatusCategory;
  readonly resolution: string | null;
  readonly template: string;
  readonly queue: string | null;
  /** "You", an operator's id, or `null` when unassigned. */
  readonly assignee: string | null;
  readonly slaState: CaseSlaState;
  readonly slaExpiresAt: string | null;
  readonly createdAt: string;
  readonly tags: readonly string[];
  readonly redacted: boolean;
}

type BulkAction = (
  state: ActionState<{ id: string }>,
  formData: FormData,
) => Promise<ActionResult<{ id: string }>>;

export interface CaseListProps {
  readonly rows: readonly CaseRow[];
  readonly emptyMessage: string;
  /** The bulk actions the role allows; `null` without `cases:write`. */
  readonly bulk: {
    readonly canAssign: boolean;
    readonly userId: string;
    readonly queues: readonly { readonly id: string; readonly name: string }[];
    readonly action: BulkAction;
  } | null;
}

// ---------------------------------------------------------------------------------------------
// The column choice: a local preference of this browser (C142.1), never sent anywhere.

const COLUMNS_KEY = 'openverify:case-list-columns';

const OPTIONAL_COLUMNS = [
  { id: 'status', header: 'Status' },
  { id: 'category', header: 'Category' },
  { id: 'template', header: 'Template' },
  { id: 'queue', header: 'Queue' },
  { id: 'assignee', header: 'Assignee' },
  { id: 'sla', header: 'SLA' },
  { id: 'created', header: 'Created (UTC)' },
  { id: 'tags', header: 'Tags' },
] as const;
type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number]['id'];
const ALL = OPTIONAL_COLUMNS.map((column) => column.id);

const listeners = new Set<() => void>();

function readStored(): string | null {
  try {
    return window.localStorage.getItem(COLUMNS_KEY);
  } catch {
    return null;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

/** The kept choice, or every column when nothing usable is kept. */
function columnsOf(stored: string | null): ReadonlySet<OptionalColumn> {
  if (stored === null) {
    return new Set(ALL);
  }
  try {
    const parsed: unknown = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      return new Set(ALL.filter((id) => parsed.includes(id)));
    }
  } catch {
    // A value this console did not write: every column.
  }
  return new Set(ALL);
}

function keep(columns: ReadonlySet<OptionalColumn>): void {
  try {
    window.localStorage.setItem(COLUMNS_KEY, JSON.stringify(ALL.filter((id) => columns.has(id))));
  } catch {
    // Storage refused (a private window): the choice holds for this page only.
  }
  for (const listener of listeners) {
    listener();
  }
}

// ---------------------------------------------------------------------------------------------

/** A case's SLA in words: its state, and its deadline when it has one. */
export function slaWords(state: CaseSlaState, expiresAt: string | null): string {
  if (expiresAt === null) {
    return SLA_STATE_WORDS[state];
  }
  const at = `${formatUtc(expiresAt)} UTC`;
  switch (state) {
    case 'running':
      return `Running, due ${at}`;
    case 'met':
      return `Met, was due ${at}`;
    case 'expired':
      return `Expired, was due ${at}`;
    default:
      return SLA_STATE_WORDS[state];
  }
}

const CELLS: Readonly<Record<OptionalColumn, (row: CaseRow) => ReactNode>> = {
  status: (row) => row.status,
  category: (row) =>
    row.category === 'end' && row.resolution !== null
      ? `${STATUS_CATEGORY_WORDS.end}: ${row.resolution}`
      : STATUS_CATEGORY_WORDS[row.category],
  template: (row) => row.template,
  queue: (row) => row.queue ?? 'No queue',
  assignee: (row) => row.assignee ?? 'Unassigned',
  sla: (row) => slaWords(row.slaState, row.slaExpiresAt),
  created: (row) => <Timestamp value={row.createdAt} />,
  tags: (row) => (row.tags.length === 0 ? 'None' : row.tags.join(', ')),
};

/** The column choice, a disclosure of checkboxes; the name column always shows. */
function ColumnChoice({
  shown,
  onChange,
}: {
  readonly shown: ReadonlySet<OptionalColumn>;
  readonly onChange: (next: ReadonlySet<OptionalColumn>) => void;
}) {
  const id = useId();
  return (
    <details className="text-sm">
      <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium">
        Columns
      </summary>
      <fieldset aria-labelledby={id} className="mt-2 flex flex-wrap gap-4">
        <legend id={id} className="sr-only">
          Columns of the case list, kept in this browser
        </legend>
        <label className="flex min-h-6 items-center gap-2">
          <input type="checkbox" className="size-6" checked disabled />
          Name
        </label>
        {OPTIONAL_COLUMNS.map((column) => (
          <label key={column.id} className="flex min-h-6 items-center gap-2">
            <input
              type="checkbox"
              className="size-6 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              checked={shown.has(column.id)}
              onChange={(event) => {
                const next = new Set(shown);
                if (event.currentTarget.checked) {
                  next.add(column.id);
                } else {
                  next.delete(column.id);
                }
                onChange(next);
              }}
            />
            {column.header}
          </label>
        ))}
      </fieldset>
    </details>
  );
}

const BULK_LIMIT = CASE_LIMITS['bulk-cases'].value;

/** The confirmation's question for `count` cases. */
function questionOf(action: string, count: number): string {
  const cases = casesCount(count);
  switch (action) {
    case 'assign':
      return `Assign ${cases}?`;
    case 'set-status':
      return `Set the status of ${cases}?`;
    case 'set-queue':
      return `Move ${cases} to a queue?`;
    case 'add-tags':
      return `Add tags to ${cases}?`;
    default:
      return `Remove tags from ${cases}?`;
  }
}

/** The bulk action form (C137.4): one action on the selected cases, confirmed first. */
function BulkActions({
  selected,
  bulk,
}: {
  readonly selected: readonly string[];
  readonly bulk: NonNullable<CaseListProps['bulk']>;
}) {
  const router = useRouter();
  const actions = [
    ...(bulk.canAssign ? (['assign'] as const) : []),
    'set-status',
    'set-queue',
    'add-tags',
    'remove-tags',
  ] as const;
  const [chosen, setChosen] = useState<string>(actions[0]);
  const [confirming, setConfirming] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({ 'user-id': bulk.userId });
  const form = useFormAction(bulk.action, {
    onSuccess: ({ id }) => {
      router.push(`/cases/bulk/${id}`);
    },
  });
  const set = (name: string) => (event: { currentTarget: { value: string } }) => {
    const value = event.currentTarget.value;
    setValues((current) => ({ ...current, [name]: value }));
  };
  const text = (name: string, label: string, description?: string) => (
    <FormField
      label={label}
      {...(description === undefined ? {} : { description })}
      error={fieldErrorOf(form.problem, `/meta/${name}`)}
    >
      {(control) => (
        <input
          {...control}
          value={values[name] ?? ''}
          onChange={set(name)}
          className={controlClassName(control)}
        />
      )}
    </FormField>
  );
  const dataOf = () => {
    const data = new FormData();
    data.set('action', chosen);
    for (const id of selected) {
      data.append('case-id', id);
    }
    for (const [name, value] of Object.entries(values)) {
      data.set(name, value);
    }
    return data;
  };
  const tooMany = selected.length > BULK_LIMIT;
  return (
    <>
      <form
        aria-label="Act on the selected cases"
        className="flex flex-col gap-3 rounded-xl border border-line p-4"
        onSubmit={(event) => {
          event.preventDefault();
          form.clearProblem();
          setConfirming(true);
        }}
      >
        <p role="status" className="text-sm font-medium">
          {selected.length === 0
            ? 'Select cases in the list to act on them.'
            : `${casesCount(selected.length)} selected`}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Action">
            {(control) => (
              <select
                {...control}
                value={chosen}
                onChange={(event) => {
                  setChosen(event.currentTarget.value);
                  form.clearProblem();
                }}
                className={controlClassName(control)}
              >
                {actions.map((action) => (
                  <option key={action} value={action}>
                    {BULK_ACTION_WORDS[action]}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          {chosen === 'assign' &&
            text(
              'user-id',
              'Assign to',
              'An operator’s user ID (yours is filled in); leave it empty to unassign. Assigning replaces the current assignee.',
            )}
          {chosen === 'set-status' && (
            <>
              {text(
                'status',
                'Status key',
                'Such as approved. Each case’s template must allow the move; a case it does not is refused and said so.',
              )}
              {text('resolution', 'Resolution', 'Optional; one of the template’s resolutions.')}
              {text(
                'comment',
                'Comment',
                'Needed by a status that requires one; added to each case.',
              )}
              {text('status-tag', 'Status tag', 'Needed by a status that requires one.')}
            </>
          )}
          {chosen === 'set-queue' && (
            <FormField label="Queue" error={fieldErrorOf(form.problem, '/meta/case-queue-id')}>
              {(control) => (
                <select
                  {...control}
                  value={values['case-queue-id'] ?? ''}
                  onChange={set('case-queue-id')}
                  className={controlClassName(control)}
                >
                  <option value="">No queue</option>
                  {bulk.queues.map((queue) => (
                    <option key={queue.id} value={queue.id}>
                      {queue.name}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          )}
          {(chosen === 'add-tags' || chosen === 'remove-tags') &&
            text('tags', 'Tags', 'Separated by commas or lines.')}
        </div>
        {tooMany && (
          <p className="text-sm text-danger">
            A bulk action takes at most {String(BULK_LIMIT)} cases: select fewer.
          </p>
        )}
        <div>
          <Button type="submit" disabled={selected.length === 0 || tooMany || form.pending}>
            Apply…
          </Button>
        </div>
      </form>
      <ConfirmDialog
        open={confirming}
        title={questionOf(chosen, selected.length)}
        description="Each case is changed as its own record through the single-case rules, with its own history and events. A case a rule refuses is left as it is, and the outcome of each case is shown once the action has run."
        confirmLabel="Apply"
        pendingLabel="Applying…"
        tone="primary"
        pending={form.pending}
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          form.submit(dataOf());
        }}
      >
        <ProblemDisplay
          problem={withoutFieldErrors(
            form.problem,
            (form.problem?.errors ?? [])
              .map((error) => error.pointer)
              .filter((pointer) => pointer.startsWith('/meta/')),
          )}
        />
      </ConfirmDialog>
    </>
  );
}

/**
 * The case list (C142.1): a table of cases as the API listed them, with the columns this browser
 * keeps (the name always shows), and, with `cases:write`, a checkbox per case and the bulk action
 * form. No field value or filename is in a row.
 */
export function CaseList({ rows, emptyMessage, bulk }: CaseListProps) {
  const stored = useSyncExternalStore(subscribe, readStored, () => null);
  const shown = columnsOf(stored);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const toggle = (id: string, on: boolean) => {
    setSelected((current) =>
      on ? [...current.filter((each) => each !== id), id] : current.filter((each) => each !== id),
    );
  };
  const columns: Column<CaseRow>[] = [
    ...(bulk === null
      ? []
      : [
          {
            id: 'select',
            header: <span className="sr-only">Select</span>,
            cell: (row: CaseRow) => (
              <input
                type="checkbox"
                aria-label={`Select ${row.name}`}
                className="size-6 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                checked={selected.includes(row.id)}
                onChange={(event) => {
                  toggle(row.id, event.currentTarget.checked);
                }}
              />
            ),
          },
        ]),
    {
      id: 'name',
      header: 'Name',
      rowHeader: true,
      cell: (row) => (
        <span className="flex flex-wrap items-center gap-2">
          <Link href={`/cases/${row.id}`} className={LINK_CLASS}>
            {row.name}
          </Link>
          {row.redacted && <span className="text-xs text-ink-muted">(redacted)</span>}
        </span>
      ),
    },
    ...OPTIONAL_COLUMNS.filter((column) => shown.has(column.id)).map((column) => ({
      id: column.id,
      header: column.header,
      cell: CELLS[column.id],
    })),
  ];
  // The rows' order keeps the selection's order as listed, whatever order it was ticked in.
  const selection = rows.map((row) => row.id).filter((id) => selected.includes(id));
  return (
    <div className="flex flex-col gap-4">
      <ColumnChoice shown={shown} onChange={keep} />
      <DataTable
        caption="Cases"
        captionHidden
        rows={rows}
        getRowKey={(row) => row.id}
        emptyMessage={emptyMessage}
        columns={columns}
      />
      {bulk !== null && <BulkActions selected={selection} bulk={bulk} />}
    </div>
  );
}

/** "Next case" (C132.3): pulls the most urgent unassigned case of the caller's queues, and opens it. */
export function NextCaseButton({
  action,
  queueId,
}: {
  /** The queue the list is filtered by: the pull then takes from it alone. */
  readonly queueId?: string | undefined;
  readonly action: (
    state: ActionState<{ caseId: string | null }>,
    formData: FormData,
  ) => Promise<ActionResult<{ caseId: string | null }>>;
}) {
  const router = useRouter();
  const [said, setSaid] = useState('');
  const form = useFormAction(action, {
    onSuccess: ({ caseId }) => {
      if (caseId === null) {
        setSaid(
          queueId === undefined
            ? 'No case is waiting in your queues.'
            : 'No case is waiting in this queue.',
        );
      } else {
        setSaid('');
        router.push(`/cases/${caseId}`);
      }
    },
  });
  return (
    <form {...form.formProps} className="flex flex-col items-end gap-1">
      {queueId !== undefined && <input type="hidden" name="case-queue-id" value={queueId} />}
      <Button type="submit" disabled={form.pending}>
        {queueId === undefined ? 'Next case' : 'Next case from this queue'}
      </Button>
      <p role="status" className="text-sm text-ink-muted">
        {said}
      </p>
      <ProblemDisplay problem={form.problem} />
    </form>
  );
}
