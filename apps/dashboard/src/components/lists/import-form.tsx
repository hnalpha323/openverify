'use client';

import { IMPORTER_MODES, type ListKind } from '@openverify/core';
import { useRouter } from 'next/navigation';
import { fieldErrorOf, type ActionResult, type ActionState } from '../../lib/action-state';
import { withoutFieldErrors } from '../field-errors';
import { FormField, controlClassName } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useFormAction } from '../use-form-action';
import { IMPORT_COLUMNS } from './importer-progress';
import { IMPORTER_MODE_LABELS } from './list-words';

type Action = (
  state: ActionState<{ id: string }>,
  formData: FormData,
) => Promise<ActionResult<{ id: string }>>;

const POINTERS = ['/file', '/data/attributes/mode', '/data/attributes/encoding'];

/**
 * Imports a CSV file into a list (C100.1, C108); the import's page opens, where its progress and
 * errors show. Needs `importers:write` and `lists:write`.
 */
export function ImportForm({
  listId,
  kind,
  action,
}: {
  readonly listId: string;
  readonly kind: ListKind;
  readonly action: Action;
}) {
  const router = useRouter();
  const form = useFormAction(action, {
    onSuccess: ({ id }) => {
      router.push(`/lists/importers/${id}`);
    },
  });
  const { problem } = form;

  return (
    <form
      {...form.formProps}
      aria-label="Import a CSV file"
      className="flex max-w-xl flex-col gap-4"
    >
      <input type="hidden" name="list-id" value={listId} />
      <input type="hidden" name="kind" value={kind} />
      <FormField
        label="CSV file"
        required
        description={`The header row names the columns: ${IMPORT_COLUMNS[kind] ?? ''}. The console sends files of at most 1,000,000 bytes; larger ones, up to 20 MB, go through the API.`}
        error={fieldErrorOf(problem, '/file')}
      >
        {(control) => (
          <input
            {...control}
            type="file"
            name="file"
            accept=".csv,text/csv"
            className={controlClassName(control)}
          />
        )}
      </FormField>
      <FormField
        label="Mode"
        description="All or nothing refuses the whole file when one row is refused; Skip invalid rows imports the valid ones."
        error={fieldErrorOf(problem, '/data/attributes/mode')}
      >
        {(control) => (
          <select
            {...control}
            name="mode"
            defaultValue="all-or-nothing"
            className={controlClassName(control)}
          >
            {IMPORTER_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {IMPORTER_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <FormField
        label="Encoding"
        description="Leave empty for UTF-8, or name a single-byte encoding such as windows-1252. UTF-16 is refused."
        error={fieldErrorOf(problem, '/data/attributes/encoding')}
      >
        {(control) => (
          <input
            {...control}
            name="encoding"
            maxLength={32}
            className={controlClassName(control)}
          />
        )}
      </FormField>
      <ProblemDisplay problem={withoutFieldErrors(problem, POINTERS)} />
      <div>
        <SubmitButton pendingLabel="Uploading…" pending={form.pending}>
          Import file
        </SubmitButton>
      </div>
    </form>
  );
}
