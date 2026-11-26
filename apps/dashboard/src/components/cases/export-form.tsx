'use client';

import { CASE_SLA_STATES, CASE_STATUS_CATEGORIES } from '@openverify/core';
import { Button, Checkbox } from '@openverify/ui';
import { useRef, useState } from 'react';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ConfirmDialog } from '../confirm-dialog';
import { EnvironmentField } from '../environment-field';
import { FormField, controlClassName } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import { useFormAction } from '../use-form-action';
import { SLA_STATE_WORDS, STATUS_CATEGORY_WORDS } from './case-words';

interface Choice {
  readonly id: string;
  readonly name: string;
}

/** A select with "every" as its empty choice. */
function Choose({
  label,
  name,
  every,
  choices,
}: {
  readonly label: string;
  readonly name: string;
  readonly every: string;
  readonly choices: readonly Choice[];
}) {
  return (
    <FormField label={label}>
      {(control) => (
        <select {...control} name={name} defaultValue="" className={controlClassName(control)}>
          <option value="">{every}</option>
          {choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.name}
            </option>
          ))}
        </select>
      )}
    </FormField>
  );
}

/**
 * The case export form (C138.1, C142.1): CSV or JSON of the cases the filters select (none: every
 * case the operator sees, at most 10,000), kept 24 hours. With `pii:view`, the cases' fields may be
 * included, after a confirmation that says what the file then holds; without it the choice is not
 * offered, and says why.
 */
export function ExportForm({
  environmentId,
  canIncludePersonalData,
  templates,
  queues,
  action,
}: {
  readonly environmentId: string;
  /** Whether the operator may include personal data (`pii:view`). */
  readonly canIncludePersonalData: boolean;
  readonly templates: readonly Choice[];
  readonly queues: readonly Choice[];
  readonly action: (
    state: ActionState<{ id: string }>,
    formData: FormData,
  ) => Promise<ActionResult<{ id: string }>>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [personal, setPersonal] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [said, setSaid] = useState('');
  const form = useFormAction(action, {
    onSuccess: () => {
      setConfirming(false);
      // The action revalidates the exports page, so the new export is listed on its answer.
      setSaid('Asked for the export. It appears below once written.');
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
        aria-label="Export cases"
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
          The file holds the cases the filters select, or every case you can see, at most 10,000. It
          is kept 24 hours after it is written, then deleted, and only you can download it.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FormField label="Format">
            {(control) => (
              <select
                {...control}
                name="format"
                defaultValue="csv"
                className={controlClassName(control)}
              >
                <option value="csv">CSV: one row per case</option>
                <option value="json">JSON: each case with its history and comments</option>
              </select>
            )}
          </FormField>
          <Choose label="Template" name="template" every="Every template" choices={templates} />
          <Choose label="Queue" name="queue" every="Every queue" choices={queues} />
          <Choose
            label="Category"
            name="category"
            every="Every category"
            choices={CASE_STATUS_CATEGORIES.map((id) => ({ id, name: STATUS_CATEGORY_WORDS[id] }))}
          />
          <Choose
            label="SLA"
            name="sla"
            every="Any SLA"
            choices={CASE_SLA_STATES.map((id) => ({ id, name: SLA_STATE_WORDS[id] }))}
          />
        </div>
        {canIncludePersonalData ? (
          <Checkbox
            name="include-personal-data"
            checked={personal}
            onChange={(event) => {
              setPersonal(event.currentTarget.checked);
            }}
            label="Include personal data"
            description="Adds each case’s fields (and, in JSON, comment messages and attachment names). You confirm it before the export is asked."
          />
        ) : (
          <p className="text-sm text-ink-muted">
            The file holds no personal data: including the cases’ fields needs pii:view, which your
            role does not hold.
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
        description="The file will hold the selected cases’ fields, and in JSON their comment messages and attachment names: personal data of the people the cases are about. The export and each download are recorded in the audit log. Keep the file only as long as your policy allows; it is deleted here after 24 hours."
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
