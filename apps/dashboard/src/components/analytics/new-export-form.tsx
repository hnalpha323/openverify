'use client';

/**
 * The new-export form (C166.1, C166.2, C166.6): one CSV of one type's rows, chosen by the filters
 * offered or by a saved view, kept 24 hours. Only the types the operator holds `:export` for are
 * offered. With `pii:view`, personal columns may be included, after a confirmation that says what
 * the file then holds; without it they are masked, and the form says why. An export of more than
 * 50,000 rows is refused, never cut short.
 */
import { EXPORT_LIMITS, INQUIRY_STATUSES, type ExportObjectType } from '@openverify/core';
import { Button, Checkbox } from '@openverify/ui';
import { useRef, useState } from 'react';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ConfirmDialog } from '../confirm-dialog';
import { EnvironmentField } from '../environment-field';
import { FormField, controlClassName } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import { useFormAction } from '../use-form-action';
import { EXPORT_VERIFICATION_TYPES, takesCreatedRange } from './export-filter';
import { EXPORT_TYPE_WORDS } from './export-words';

export interface NewExportFormProps {
  readonly environmentId: string;
  /** The types the operator holds `:export` for, in `EXPORT_OBJECT_TYPES` order. */
  readonly types: readonly ExportObjectType[];
  readonly canIncludePersonalData: boolean;
  /** A saved view chosen on its list page: its rows are exported instead of the filters. */
  readonly savedView?: {
    readonly id: string;
    readonly name: string;
    readonly type: ExportObjectType;
  };
  readonly action: (
    state: ActionState<{ id: string }>,
    formData: FormData,
  ) => Promise<ActionResult<{ id: string }>>;
}

function DateField({ name, label }: { readonly name: string; readonly label: string }) {
  return (
    <FormField label={label}>
      {(control) => (
        <input {...control} type="date" name={name} className={controlClassName(control)} />
      )}
    </FormField>
  );
}

export function NewExportForm({
  environmentId,
  types,
  canIncludePersonalData,
  savedView,
  action,
}: NewExportFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [type, setType] = useState<ExportObjectType>(savedView?.type ?? types[0] ?? 'inquiries');
  const [personal, setPersonal] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [said, setSaid] = useState('');
  const form = useFormAction(action, {
    onSuccess: ({ id }) => {
      setConfirming(false);
      setSaid(`Asked for export ${id}. It appears in your exports once written.`);
    },
  });
  const send = (confirmed: boolean) => {
    if (formRef.current === null) {
      return;
    }
    const data = new FormData(formRef.current);
    if (confirmed) {
      data.set('personal-data-confirmed', 'true');
    }
    form.submit(data);
  };
  return (
    <>
      <form
        ref={formRef}
        aria-label="New export"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setSaid('');
          if (personal) {
            form.clearProblem();
            setConfirming(true);
          } else {
            send(false);
          }
        }}
      >
        <EnvironmentField environmentId={environmentId} />
        <p className="text-sm text-ink-muted">
          One CSV file of the rows chosen, at most {EXPORT_LIMITS.rows.toLocaleString('en-US')}: a
          larger export is refused, never cut short. It is kept 24 hours after it is written, and
          only you can download it.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FormField label="Export">
            {(control) => (
              <select
                {...control}
                name="object-type"
                value={type}
                onChange={(event) => {
                  setType(event.currentTarget.value as ExportObjectType);
                }}
                className={controlClassName(control)}
              >
                {types.map((each) => (
                  <option key={each} value={each}>
                    {EXPORT_TYPE_WORDS[each]}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          {savedView?.type === type ? (
            <>
              <input type="hidden" name="saved-view-id" value={savedView.id} />
              <p className="text-sm text-ink sm:col-span-2">
                Rows: the filters of your saved view “{savedView.name}”, as its list reads them now.
              </p>
            </>
          ) : (
            <>
              {type === 'verifications' && (
                <FormField label="Verification type">
                  {(control) => (
                    <select
                      {...control}
                      name="verification-type"
                      required
                      className={controlClassName(control)}
                    >
                      {EXPORT_VERIFICATION_TYPES.map((each) => (
                        <option key={each} value={each}>
                          {each}
                        </option>
                      ))}
                    </select>
                  )}
                </FormField>
              )}
              {type === 'lists' && (
                <FormField label="List ID" description="The list whose items are exported.">
                  {(control) => (
                    <input
                      {...control}
                      name="list-id"
                      required
                      spellCheck={false}
                      autoComplete="off"
                      className={controlClassName(control)}
                    />
                  )}
                </FormField>
              )}
              {type === 'inquiries' && (
                <FormField label="Status">
                  {(control) => (
                    <select
                      {...control}
                      name="status"
                      defaultValue=""
                      className={controlClassName(control)}
                    >
                      <option value="">Any status</option>
                      {INQUIRY_STATUSES.map((each) => (
                        <option key={each} value={each}>
                          {each}
                        </option>
                      ))}
                    </select>
                  )}
                </FormField>
              )}
              {takesCreatedRange(type) && (
                <>
                  <DateField name="created-from" label="Created from (UTC)" />
                  <DateField name="created-to" label="Created to (UTC)" />
                </>
              )}
            </>
          )}
        </div>
        {canIncludePersonalData ? (
          <Checkbox
            name="include-personal-data"
            checked={personal}
            onChange={(event) => {
              setPersonal(event.currentTarget.checked);
            }}
            label="Include personal data"
            description="Adds the personal columns (reference IDs, field values, extracted fields, query values, list item values). You confirm it before the export is asked."
          />
        ) : (
          <p className="text-sm text-ink-muted">
            Personal columns are masked: including them needs pii:view, which your role does not
            hold.
          </p>
        )}
        <div>
          <Button type="submit" disabled={form.pending}>
            Export
          </Button>
        </div>
        <p role="status" className="text-sm">
          {said}
        </p>
        {!confirming && <ProblemDisplay problem={form.problem} />}
      </form>
      <ConfirmDialog
        open={confirming}
        title="Include personal data in the export?"
        description="The file will hold the personal data of the people the rows are about. The export and each download are recorded in the audit log, and a person redacted after the export was cut stays in the file until it is deleted, at most 24 hours later. Keep the file only as long as your policy allows."
        confirmLabel="Export with personal data"
        pendingLabel="Exporting…"
        tone="primary"
        pending={form.pending}
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          send(true);
        }}
      >
        <ProblemDisplay problem={form.problem} />
      </ConfirmDialog>
    </>
  );
}
