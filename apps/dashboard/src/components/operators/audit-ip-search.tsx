'use client';

import type { UserAuditLogResource } from '@openverify/contracts';
import { Field, Input } from '@openverify/ui';
import { useState } from 'react';
import { fieldErrorOf, type ActionResult, type ActionState } from '../../lib/action-state';
import { SETTINGS_COPY } from '../../lib/copy/settings';
import { withoutFieldErrors } from '../field-errors';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useFormAction } from '../use-form-action';
import { AuditLogTable } from './audit-log-table';

export interface AuditIpSearchResult {
  readonly entries: readonly UserAuditLogResource[];
  readonly more: boolean;
}

export interface AuditIpSearchProps {
  readonly action: (
    previous: ActionState<AuditIpSearchResult>,
    formData: FormData,
  ) => Promise<ActionResult<AuditIpSearchResult>>;
}

const COPY = SETTINGS_COPY.audit;

/**
 * C168.6: the audit explorer's address search, shown only with `pii:view`. The address is posted to
 * a server action, so it never reaches the page's URL, its history, a link or a saved view; the
 * entries found are listed below with their count in a polite status.
 */
export function AuditIpSearch({ action }: AuditIpSearchProps) {
  const [result, setResult] = useState<AuditIpSearchResult | null>(null);
  const form = useFormAction(action, {
    onSuccess: setResult,
    onProblem: () => {
      setResult(null);
    },
  });
  const summary =
    result === null
      ? ''
      : result.entries.length === 0
        ? COPY.ipNone
        : result.more
          ? COPY.ipMore
          : COPY.ipSome(result.entries.length);
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4">
      <form
        role="search"
        aria-label={COPY.ipSearchLabel}
        {...form.formProps}
        className="flex flex-wrap items-end gap-4"
      >
        <Field
          label={COPY.ipLabel}
          description={COPY.ipDescription}
          error={fieldErrorOf(form.problem, '/ip')}
          className="min-w-64 flex-1"
        >
          <Input name="ip" autoComplete="off" spellCheck={false} inputMode="text" />
        </Field>
        <SubmitButton pending={form.pending} pendingLabel={COPY.ipSearching} variant="secondary">
          {COPY.ipSubmit}
        </SubmitButton>
      </form>
      <ProblemDisplay problem={withoutFieldErrors(form.problem, ['/ip'])} />
      <p role="status" className="text-sm text-ink-muted">
        {summary}
      </p>
      {result !== null && result.entries.length > 0 && (
        <AuditLogTable
          caption={COPY.ipResultsCaption}
          entries={result.entries}
          directory={null}
          masked={false}
          emptyMessage={COPY.ipNone}
        />
      )}
    </section>
  );
}
