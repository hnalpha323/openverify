'use client';

import { useId } from 'react';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ConfirmActionButton } from '../confirm-action-button';
import { controlClassName } from '../form-field';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

/**
 * Consolidates duplicate accounts into this one (C13): the operator lists the source accounts,
 * reads what moves, and confirms. The API does it in one transaction.
 */
export function ConsolidateButton({
  accountId,
  action,
}: {
  readonly accountId: string;
  readonly action: Action;
}) {
  const id = useId();
  return (
    <ConfirmActionButton
      label="Consolidate"
      variant="secondary"
      title="Consolidate accounts into this one?"
      description="The source accounts' inquiries, tags, fields (this account's values win) and relations move here, and each source is archived. This cannot be undone."
      confirmLabel="Consolidate accounts"
      pendingLabel="Consolidating…"
      action={action}
      fields={{ 'account-id': accountId }}
      successMessage="The accounts were consolidated."
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-sources`} className="text-sm font-medium text-ink">
          Source account IDs
        </label>
        <p id={`${id}-help`} className="text-sm text-ink-muted">
          One to ten accounts, separated by commas, spaces or new lines.
        </p>
        <textarea
          id={`${id}-sources`}
          name="source-account-ids"
          rows={3}
          required
          spellCheck={false}
          aria-describedby={`${id}-help`}
          className={`${controlClassName({})} font-mono text-sm`}
        />
      </div>
    </ConfirmActionButton>
  );
}
