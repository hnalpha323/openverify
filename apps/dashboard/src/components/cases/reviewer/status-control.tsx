'use client';

import type { CaseStatusDefinitionResource } from '@openverify/contracts';
import { useId, useState, type ReactNode } from 'react';
import { fieldErrorOf, type ActionResult, type ActionState } from '../../../lib/action-state';
import { withoutFieldErrors } from '../../field-errors';
import { FormField, controlClassName } from '../../form-field';
import { ProblemDisplay } from '../../problem-display';
import { SubmitButton } from '../../submit-button';
import { useToast } from '../../toasts';
import { useFormAction } from '../../use-form-action';
import { CASES_REPORTS_COPY } from '../../../lib/copy/cases-reports';
import { itemsBlocking, type ChecklistView } from '../checklists/checklist-model';
import { CATEGORY_WORDS } from './case-words';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

export interface StatusControlProps {
  readonly caseId: string;
  readonly lockVersion: number;
  /** The case's status key now. */
  readonly current: string;
  /** The pinned version's statuses, transitions and resolutions (C130.2). */
  readonly statuses: readonly CaseStatusDefinitionResource[];
  readonly transitions: Readonly<Record<string, readonly string[]>>;
  readonly resolutions: readonly string[];
  readonly action: Action;
  /** C172.2: the case's checklists, for the items a target status needs checked first. */
  readonly checklists?: readonly ChecklistView[];
  /** C172.3: the version's field labels by key, for the fields a target status needs. */
  readonly fieldLabels?: ReadonlyMap<string, string>;
  /** C172.5: the case actions placed in the status switcher. */
  readonly placedActions?: ReactNode;
}

const SWITCHER = CASES_REPORTS_COPY.statusSwitcher;

const POINTERS = ['/meta/status', '/meta/resolution', '/meta/comment', '/meta/status-tag'];

/**
 * The status control (C131.1, C142.2): only the statuses the version's transition map allows from
 * the current one; a resolution when the target is an end status; a comment the target requires;
 * and a status tag from the target's list, required when the target says so. The API decides; the
 * form only offers what the map allows, and sends the lock version it rendered (a stale one is 409).
 */
export function StatusControl({
  caseId,
  lockVersion,
  current,
  statuses,
  transitions,
  resolutions,
  action,
  checklists = [],
  fieldLabels = new Map(),
  placedActions,
}: StatusControlProps) {
  const { show } = useToast();
  const [chosen, setChosen] = useState('');
  const { pending, problem, formProps } = useFormAction(action, {
    resetOnSuccess: true,
    onSuccess: () => {
      setChosen('');
      show({ tone: 'success', message: 'The status was changed.' });
    },
  });
  const allowed = transitions[current] ?? statuses.map((status) => status.key);
  const targets = statuses.filter(
    (status) => status.key !== current && allowed.includes(status.key),
  );
  const target = targets.find((status) => status.key === chosen);
  if (targets.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-muted">The version allows no move from this status.</p>
        {placedActions}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <form {...formProps} className="flex flex-col gap-3">
        <input type="hidden" name="case-id" value={caseId} />
        <input type="hidden" name="lock-version" value={String(lockVersion)} />
        <FormField label="New status" required error={fieldErrorOf(problem, '/meta/status')}>
          {(control) => (
            <select
              {...control}
              name="status"
              value={chosen}
              onChange={(event) => {
                setChosen(event.target.value);
              }}
              className={controlClassName(control)}
            >
              <option value="">Choose a status</option>
              {targets.map((status) => (
                <option key={status.key} value={status.key}>
                  {status.label}
                </option>
              ))}
            </select>
          )}
        </FormField>
        {target !== undefined && (
          <p className="text-sm text-ink-muted">
            {CATEGORY_WORDS[target.category]} status
            {target['pauses-sla'] ? '; it pauses the SLA' : ''}.
          </p>
        )}
        {target !== undefined && (
          <StatusRequirements
            fields={(target['requires-fields'] ?? []).map((key) => fieldLabels.get(key) ?? key)}
            items={itemsBlocking(checklists, target.key).map((item) => item.label)}
          />
        )}
        {target?.category === 'end' && resolutions.length > 0 && (
          <FormField label="Resolution" error={fieldErrorOf(problem, '/meta/resolution')}>
            {(control) => (
              <select
                {...control}
                name="resolution"
                defaultValue={resolutions.includes(target.label) ? target.label : ''}
                key={target.key}
                className={controlClassName(control)}
              >
                <option value="">The status's own label, if it is a resolution</option>
                {resolutions.map((resolution) => (
                  <option key={resolution} value={resolution}>
                    {resolution}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        )}
        {target !== undefined && target['status-tags'].length > 0 && (
          <FormField
            label="Status tag"
            required={target['status-tag-required']}
            error={fieldErrorOf(problem, '/meta/status-tag')}
          >
            {(control) => (
              <select
                {...control}
                name="status-tag"
                key={target.key}
                defaultValue=""
                className={controlClassName(control)}
              >
                <option value="">No tag</option>
                {target['status-tags'].map((tag) => (
                  <option key={tag.key} value={tag.key}>
                    {tag.label}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        )}
        {target !== undefined && (
          <FormField
            label="Comment"
            required={target['required-comment']}
            description={
              target['required-comment']
                ? 'This status needs a comment; it is added to the case.'
                : 'Optional; it is added to the case.'
            }
            error={fieldErrorOf(problem, '/meta/comment')}
          >
            {(control) => (
              <textarea
                {...control}
                name="comment"
                rows={3}
                maxLength={10_000}
                className={controlClassName(control)}
              />
            )}
          </FormField>
        )}
        <ProblemDisplay problem={withoutFieldErrors(problem, POINTERS)} />
        <div>
          <SubmitButton pendingLabel="Changing…" pending={pending} disabled={target === undefined}>
            Change status
          </SubmitButton>
        </div>
      </form>
      {placedActions}
    </div>
  );
}

/**
 * C172.2, C172.3: what the chosen status needs first, in words. The API decides (422
 * `case_checklist_incomplete` or `case_fields_required`); this only says it before the operator
 * asks. A field's value may be masked for this reader, so a field is named whether or not it holds
 * a value.
 */
function StatusRequirements({
  fields,
  items,
}: {
  readonly fields: readonly string[];
  readonly items: readonly string[];
}) {
  const fieldsId = useId();
  const itemsId = useId();
  if (fields.length === 0 && items.length === 0) {
    return <p className="text-sm text-ink-muted">{SWITCHER.noneRequired}</p>;
  }
  return (
    <div className="flex flex-col gap-2 text-sm">
      {fields.length > 0 && (
        <div>
          <p id={fieldsId} className="font-medium">
            {SWITCHER.requiresFields}
          </p>
          <ul aria-labelledby={fieldsId} className="list-disc ps-5">
            {fields.map((field) => (
              <li key={field}>{field}</li>
            ))}
          </ul>
        </div>
      )}
      {items.length > 0 && (
        <div>
          <p id={itemsId} className="font-medium">
            {SWITCHER.requiresItems}
          </p>
          <ul aria-labelledby={itemsId} className="list-disc ps-5">
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
