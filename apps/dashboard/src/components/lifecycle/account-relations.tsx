'use client';

import type { AccountRelation } from '@openverify/contracts';
import Link from 'next/link';
import { fieldErrorOf, type ActionResult, type ActionState } from '../../lib/action-state';
import { ConfirmActionButton } from '../confirm-action-button';
import { DataTable, type Column } from '../data-table';
import { FormField, controlClassName } from '../form-field';
import { LINK_CLASS } from '../link-styles';
import { withoutFieldErrors } from '../field-errors';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { Timestamp } from '../timestamp';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

export interface AccountRelationsProps {
  readonly accountId: string;
  /** Both directions, as `GET /accounts/:id/relations` lists them. */
  readonly relations: readonly AccountRelation[];
  /** `accounts:write`. */
  readonly canEdit: boolean;
  readonly add: Action;
  readonly remove: Action;
}

function AddRelationForm({ accountId, action }: { accountId: string; action: Action }) {
  const { show } = useToast();
  // A refusal keeps what was typed; a success empties the form for the next (Workflow 2D K003).
  const { pending, problem, formProps } = useFormAction(action, {
    resetOnSuccess: true,
    onSuccess: () => {
      show({ tone: 'success', message: 'Added the relation.' });
    },
  });
  const accountError = fieldErrorOf(problem, '/meta/related-account-id');
  const typeError = fieldErrorOf(problem, '/meta/relation-type');
  return (
    <form {...formProps} className="flex flex-col gap-3">
      <input type="hidden" name="account-id" value={accountId} />
      <div className="flex flex-wrap items-end gap-3">
        <FormField label="Related account ID" error={accountError} className="min-w-64 flex-1">
          {(control) => (
            <input
              {...control}
              name="related-account-id"
              autoComplete="off"
              spellCheck={false}
              className={controlClassName(control)}
            />
          )}
        </FormField>
        <FormField
          label="Relation type"
          description="Lowercase letters, digits and underscores, such as spouse or business_owner."
          error={typeError}
          className="min-w-48 flex-1"
        >
          {(control) => (
            <input
              {...control}
              name="relation-type"
              autoComplete="off"
              spellCheck={false}
              className={controlClassName(control)}
            />
          )}
        </FormField>
        <SubmitButton variant="secondary" pendingLabel="Adding…" pending={pending}>
          Add relation
        </SubmitButton>
      </div>
      <ProblemDisplay
        problem={withoutFieldErrors(problem, ['/meta/related-account-id', '/meta/relation-type'])}
      />
    </form>
  );
}

/**
 * An account's relations (C13): directed and typed, listed in both directions. A relation is
 * removed on the account it starts from.
 */
export function AccountRelations({
  accountId,
  relations,
  canEdit,
  add,
  remove,
}: AccountRelationsProps) {
  const columns: Column<AccountRelation>[] = [
    {
      id: 'account',
      header: 'Related account',
      rowHeader: true,
      cell: (relation) => (
        <Link href={`/accounts/${relation['related-account'].id}`} className={LINK_CLASS}>
          <code className="font-mono text-xs">{relation['related-account'].id}</code>
        </Link>
      ),
    },
    {
      id: 'type',
      header: 'Relation',
      cell: (relation) => <code className="font-mono text-xs">{relation['relation-type']}</code>,
    },
    {
      id: 'direction',
      header: 'Direction',
      cell: (relation) =>
        relation.direction === 'outgoing' ? 'From this account' : 'To this account',
    },
    {
      id: 'created',
      header: 'Created (UTC)',
      cell: (relation) => <Timestamp value={relation['created-at']} />,
    },
  ];
  if (canEdit) {
    columns.push({
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      cell: (relation) => {
        const other = relation['related-account'].id;
        const outgoing = relation.direction === 'outgoing';
        // The row action and its dialog name the relation (WCAG 2.4.6, Workflow 2E F014).
        const name = `Remove the ${relation['relation-type']} relation ${outgoing ? 'to' : 'from'} ${other}`;
        return (
          <ConfirmActionButton
            label="Remove"
            accessibleLabel={name}
            variant="secondary"
            title={`${name}?`}
            description="The accounts stay; only the relation between them is removed."
            confirmLabel="Remove relation"
            pendingLabel="Removing…"
            action={remove}
            fields={{
              'account-id': accountId,
              'from-account-id': outgoing ? accountId : other,
              'related-account-id': outgoing ? other : accountId,
              'relation-type': relation['relation-type'],
            }}
            successMessage="Removed the relation."
          />
        );
      },
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {relations.length === 0 ? (
        <p className="text-sm text-ink-muted">No relations.</p>
      ) : (
        <DataTable
          caption="Account relations"
          captionHidden
          columns={columns}
          rows={relations}
          getRowKey={(relation) =>
            `${relation.direction}:${relation['relation-type']}:${relation['related-account'].id}`
          }
          emptyMessage="No relations."
        />
      )}
      {canEdit && <AddRelationForm accountId={accountId} action={add} />}
    </div>
  );
}
