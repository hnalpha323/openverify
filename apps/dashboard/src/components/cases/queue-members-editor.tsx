'use client';

import type { CaseQueueMember } from '@openverify/contracts';
import { CASE_LIMITS } from '@openverify/core';
import { Button } from '@openverify/ui';
import { useRef, useState } from 'react';
import type { ActionResult, ActionState, DisplayProblem } from '../../lib/action-state';
import { withoutFieldErrors } from '../field-errors';
import { FormField, controlClassName } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';

/** An operator a member can be: the id, and the email and name read with `users:read`. */
export interface DirectoryEntry {
  readonly id: string;
  readonly label: string;
}

export interface QueueMembersEditorProps {
  readonly queueId: string;
  readonly members: readonly CaseQueueMember[];
  /** Empty without `users:read`: members are then typed by id. */
  readonly directory: readonly DirectoryEntry[];
  readonly action: (state: ActionState, formData: FormData) => Promise<ActionResult>;
}

interface Row {
  /** A key of the row's own, so removing one keeps the others' state. */
  readonly key: number;
  readonly userId: string;
  readonly maxOpen: string;
  readonly paused: boolean;
}

const DEFAULT_MAX_OPEN = CASE_LIMITS['member-max-open-default'].value;
const MAX_OPEN = CASE_LIMITS['member-max-open'].value;
const MEMBERS = '/data/attributes/members';

/** The errors the problem names for one row, joined, by its member. */
function rowError(
  problem: DisplayProblem | undefined,
  index: number,
  member?: 'user-id' | 'max-open' | 'paused',
): string | undefined {
  const root = `${MEMBERS}/${String(index)}`;
  const details = (problem?.errors ?? [])
    .filter((error) =>
      member === undefined ? error.pointer === root : error.pointer === `${root}/${member}`,
    )
    .map((error) => error.detail);
  return details.length === 0 ? undefined : details.join('. ');
}

/**
 * A queue's members (C132.1, C142.1): each row a person, how many open cases they take at once (1
 * to 500, 50 by default) and whether they are paused (a paused member keeps their cases and takes
 * no new one). Rows are added and removed with buttons, each change said in a polite status, and the
 * whole list is saved at once, replacing the stored one; a refusal is shown at the row it names.
 */
export function QueueMembersEditor({
  queueId,
  members,
  directory,
  action,
}: QueueMembersEditorProps) {
  const { show } = useToast();
  const next = useRef(members.length);
  const [rows, setRows] = useState<readonly Row[]>(() =>
    members.map((member, index) => ({
      key: index,
      userId: member['user-id'],
      maxOpen: String(member['max-open']),
      paused: member.paused,
    })),
  );
  const [said, setSaid] = useState('');
  // The row just added, whose control takes focus once it is drawn.
  const added = useRef<number | null>(null);
  const focusIfAdded = (element: HTMLElement | null, key: number) => {
    if (element !== null && added.current === key) {
      added.current = null;
      element.focus();
    }
  };
  const form = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: 'Saved the members.' });
    },
  });
  const names = new Map(directory.map((entry) => [entry.id, entry.label]));
  const nameOf = (userId: string) =>
    names.get(userId)?.split(' (')[0] ?? (userId || 'the new member');
  const count = (length: number) => `${String(length)} ${length === 1 ? 'member' : 'members'}.`;
  const update = (key: number, change: Partial<Row>) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));
  };
  const placed = (form.problem?.errors ?? [])
    .map((error) => error.pointer)
    .filter((pointer) => pointer.startsWith(`${MEMBERS}/`));
  return (
    <form {...form.formProps} aria-label="Edit the members" className="flex flex-col gap-4">
      <input type="hidden" name="case-queue-id" value={queueId} />
      <p role="status" aria-label="Members" className="sr-only">
        {said}
      </p>
      {rows.length === 0 && (
        <p className="text-sm text-ink-muted">
          No members: nobody pulls this queue’s cases and no policy can assign them.
        </p>
      )}
      {rows.map((row, index) => {
        const label = `Member ${String(index + 1)}`;
        const userError = rowError(form.problem, index, 'user-id') ?? rowError(form.problem, index);
        return (
          <fieldset
            key={row.key}
            aria-label={label}
            className="grid items-end gap-3 rounded-lg border border-line p-3 sm:grid-cols-[2fr_1fr_auto_auto]"
          >
            <input type="hidden" name="member-paused" value={row.paused ? 'true' : 'false'} />
            <FormField label={label} error={userError}>
              {(control) =>
                directory.length > 0 ? (
                  <select
                    {...control}
                    name="member-user-id"
                    value={row.userId}
                    ref={(element) => {
                      focusIfAdded(element, row.key);
                    }}
                    onChange={(event) => {
                      update(row.key, { userId: event.currentTarget.value });
                    }}
                    className={controlClassName(control)}
                  >
                    <option value="">Choose an operator</option>
                    {directory.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                    {row.userId !== '' && !names.has(row.userId) && (
                      <option value={row.userId}>{row.userId}</option>
                    )}
                  </select>
                ) : (
                  <input
                    {...control}
                    name="member-user-id"
                    value={row.userId}
                    placeholder="usr_…"
                    ref={(element) => {
                      focusIfAdded(element, row.key);
                    }}
                    onChange={(event) => {
                      update(row.key, { userId: event.currentTarget.value });
                    }}
                    className={controlClassName(control)}
                  />
                )
              }
            </FormField>
            <FormField
              label="Open cases at most"
              description={`1 to ${String(MAX_OPEN)}`}
              error={rowError(form.problem, index, 'max-open')}
            >
              {(control) => (
                <input
                  {...control}
                  type="number"
                  name="member-max-open"
                  min={1}
                  max={MAX_OPEN}
                  value={row.maxOpen}
                  onChange={(event) => {
                    update(row.key, { maxOpen: event.currentTarget.value });
                  }}
                  className={controlClassName(control)}
                />
              )}
            </FormField>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-6 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                checked={row.paused}
                onChange={(event) => {
                  update(row.key, { paused: event.currentTarget.checked });
                }}
              />
              Paused: takes no new case
            </label>
            <Button
              variant="secondary"
              aria-label={`Remove ${nameOf(row.userId)}`}
              onClick={() => {
                const left = rows.filter((each) => each.key !== row.key);
                setRows(left);
                setSaid(`Removed ${nameOf(row.userId)}. ${count(left.length)}`);
              }}
            >
              Remove
            </Button>
          </fieldset>
        );
      })}
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          disabled={rows.length >= CASE_LIMITS['queue-members'].value}
          onClick={() => {
            const key = next.current;
            next.current += 1;
            const longer = [
              ...rows,
              { key, userId: '', maxOpen: String(DEFAULT_MAX_OPEN), paused: false },
            ];
            added.current = key;
            setRows(longer);
            setSaid(`Added a member row. ${count(longer.length)}`);
          }}
        >
          Add a member
        </Button>
        <SubmitButton pendingLabel="Saving…" pending={form.pending}>
          Save members
        </SubmitButton>
      </div>
      <p className="text-sm text-ink-muted">
        Saving replaces the whole list. A member you remove gives back their open cases of this
        queue at once, to its policy or to nobody.
      </p>
      <ProblemDisplay problem={withoutFieldErrors(form.problem, placed)} />
    </form>
  );
}
