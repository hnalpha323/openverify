'use client';

import { Button } from '@openverify/ui';
import { useId } from 'react';
import type { ActionResult, ActionState } from '../../../lib/action-state';
import { CASES_REPORTS_COPY } from '../../../lib/copy/cases-reports';
import { ProblemDisplay } from '../../problem-display';
import { Timestamp } from '../../timestamp';
import { useToast } from '../../toasts';
import { useFormAction } from '../../use-form-action';
import type { ChecklistItemView, ChecklistView } from './checklist-model';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

const COPY = CASES_REPORTS_COPY.checklists;

export interface CaseChecklistsProps {
  readonly caseId: string;
  /** The case's lock version the checklist state answered. */
  readonly lockVersion: number;
  readonly checklists: readonly ChecklistView[];
  /** The version's statuses by key, for "Needed before". */
  readonly statusLabels: ReadonlyMap<string, string>;
  /** User emails by id, where the reader may list users. */
  readonly people: ReadonlyMap<string, string>;
  readonly canWrite: boolean;
  readonly action: Action;
}

/** Who checked an item: a person by email when the reader may list users, else by id. */
function checkerOf(id: string, people: ReadonlyMap<string, string>): string {
  if (id.startsWith('wfr_')) {
    return `${COPY.workflowRun} (${id})`;
  }
  return people.get(id) ?? id;
}

function ChecklistItem({
  caseId,
  lockVersion,
  item,
  statusLabels,
  people,
  canWrite,
  action,
}: Omit<CaseChecklistsProps, 'checklists'> & { readonly item: ChecklistItemView }) {
  const label = useId();
  const { show } = useToast();
  const { pending, problem, formProps } = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: item.checked ? COPY.unchecked : COPY.checked });
    },
  });
  const verb = item.checked ? COPY.uncheck : COPY.check;
  return (
    <li aria-labelledby={label} className="flex flex-col gap-1 rounded-lg border border-line p-3">
      <span id={label} className="font-medium">
        {item.label}
      </span>
      <span className="text-sm">
        {item.checked && item.checkedBy !== null ? (
          <>
            <span aria-hidden="true">✓ </span>
            {COPY.checkedBy} {checkerOf(item.checkedBy, people)}
            {item.checkedAt !== null && (
              <>
                {' '}
                {COPY.checkedAt} <Timestamp value={item.checkedAt} /> (UTC)
              </>
            )}
          </>
        ) : (
          <>
            <span aria-hidden="true">○ </span>
            {COPY.notChecked}
          </>
        )}
      </span>
      {item.requiredFor.length > 0 && (
        <span className="text-sm text-ink-muted">
          {`${COPY.requiredFor}: ${item.requiredFor.map((key) => statusLabels.get(key) ?? key).join(', ')}`}
        </span>
      )}
      {canWrite && (
        <form {...formProps} className="flex flex-col gap-2">
          <input type="hidden" name="case-id" value={caseId} />
          <input type="hidden" name="checklist-key" value={item.checklistKey} />
          <input type="hidden" name="item-key" value={item.itemKey} />
          <input type="hidden" name="checked" value={item.checked ? 'false' : 'true'} />
          <input type="hidden" name="lock-version" value={String(lockVersion)} />
          <div>
            <Button
              type="submit"
              variant="secondary"
              disabled={pending}
              aria-label={pending ? undefined : `${verb} ${item.label}`}
            >
              {pending ? COPY.pending : verb}
            </Button>
          </div>
          <ProblemDisplay problem={problem} />
        </form>
      )}
    </li>
  );
}

/**
 * The case's checklists (C172.2, C172.7): every item of the pinned version with who checked it and
 * when, or "Not checked", and the statuses it must be checked before. An operator with
 * `cases:write` checks or unchecks one item through its own button; nothing is checked on anyone's
 * behalf, and a refusal is said beside the item it was for.
 */
export function CaseChecklists({ checklists, ...rest }: CaseChecklistsProps) {
  if (checklists.length === 0) {
    return <p className="text-sm text-ink-muted">{COPY.empty}</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">{COPY.description}</p>
      {!rest.canWrite && <p className="text-sm text-ink-muted">{COPY.readOnly}</p>}
      {checklists.map((checklist) => (
        <ChecklistGroup key={checklist.key} checklist={checklist} {...rest} />
      ))}
    </div>
  );
}

function ChecklistGroup({
  checklist,
  ...rest
}: Omit<CaseChecklistsProps, 'checklists'> & { readonly checklist: ChecklistView }) {
  const heading = useId();
  return (
    <div role="group" aria-labelledby={heading} className="flex flex-col gap-2">
      <h3 id={heading} className="text-sm font-semibold">
        {checklist.label}
      </h3>
      <ul className="flex flex-col gap-2">
        {checklist.items.map((item) => (
          <ChecklistItem key={item.itemKey} item={item} {...rest} />
        ))}
      </ul>
    </div>
  );
}
