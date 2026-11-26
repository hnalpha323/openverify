'use client';

import type { CaseCalendarResource, CaseSlaPolicyResource } from '@openverify/contracts';
import { CASE_LIMITS, CASE_SLA_ON_REOPEN, CASE_WEEKDAYS, type CaseWeekday } from '@openverify/core';
import { Checkbox } from '@openverify/ui';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import {
  fieldErrorOf,
  type ActionResult,
  type ActionState,
  type DisplayProblem,
} from '../../lib/action-state';
import { EnvironmentField } from '../environment-field';
import { withoutFieldErrors } from '../field-errors';
import { FormField, controlClassName } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';
import { ON_REOPEN_WORDS, WEEKDAY_WORDS, holidayRowWords, intervalsText } from './case-words';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;
type IdAction = (
  state: ActionState<{ id: string }>,
  formData: FormData,
) => Promise<ActionResult<{ id: string }>>;
type EitherAction = Action | IdAction;

/** What a holiday import answers (`app/case-settings/actions.ts`). */
export interface HolidayImportResult {
  readonly imported: number;
  readonly refused: readonly { readonly row: number; readonly code: string }[];
}

const ROOT = '/data/attributes';
const NAME = `${ROOT}/name`;

/** Every field error at `pointer` or under it, joined. */
function errorsUnder(problem: DisplayProblem | undefined, pointer: string): string | undefined {
  const details = (problem?.errors ?? [])
    .filter((error) => error.pointer === pointer || error.pointer.startsWith(`${pointer}/`))
    .map((error) =>
      error.pointer === pointer
        ? error.detail
        : `${error.pointer.slice(pointer.length)}: ${error.detail}`,
    );
  return details.length === 0 ? undefined : details.join('. ');
}

/** The problem without the errors under `roots`, which the form shows at their fields. */
const unplaced = (problem: DisplayProblem | undefined, roots: readonly string[]) =>
  withoutFieldErrors(
    problem,
    (problem?.errors ?? [])
      .map((error) => error.pointer)
      .filter((pointer) =>
        roots.some((root) => pointer === root || pointer.startsWith(`${root}/`)),
      ),
  );

/** One form for creating (an id answered, then its page) or editing (a toast). */
function useCreateOrEdit(action: EitherAction, editing: boolean, path: string, saved: string) {
  const router = useRouter();
  const { show } = useToast();
  return useFormAction<{ id: string } | undefined>(
    action as (
      state: ActionState<{ id: string } | undefined>,
      formData: FormData,
    ) => Promise<ActionResult<{ id: string } | undefined>>,
    {
      onSuccess: (data) => {
        if (!editing && data !== undefined) {
          router.push(`${path}/${data.id}`);
        } else {
          show({ tone: 'success', message: saved });
        }
      },
    },
  );
}

export interface CalendarChoice {
  readonly id: string;
  readonly name: string;
}

/**
 * An SLA policy's form (C133.1), to create one or edit it: its target in business minutes, the
 * calendar it counts on (none: around the clock) and what a reopened case does with the time used.
 */
export function SlaPolicyForm({
  environmentId,
  policy,
  calendars,
  action,
}: {
  readonly environmentId: string;
  readonly policy?: CaseSlaPolicyResource;
  readonly calendars: readonly CalendarChoice[];
  readonly action: EitherAction;
}) {
  const form = useCreateOrEdit(
    action,
    policy !== undefined,
    '/case-settings/sla-policies',
    'Saved the SLA policy: a new revision.',
  );
  const attributes = policy?.attributes;
  const calendarId = attributes?.['case-calendar-id'] ?? null;
  const roots = ['name', 'target-minutes', 'case-calendar-id', 'on-reopen'].map(
    (member) => `${ROOT}/${member}`,
  );
  return (
    <form
      {...form.formProps}
      aria-label={policy === undefined ? 'Create an SLA policy' : 'Edit the SLA policy'}
      className="flex flex-col gap-4"
    >
      <EnvironmentField environmentId={environmentId} />
      {policy !== undefined && <input type="hidden" name="case-sla-policy-id" value={policy.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Name" required error={fieldErrorOf(form.problem, NAME)}>
          {(control) => (
            <input
              {...control}
              name="name"
              defaultValue={attributes?.name}
              maxLength={80}
              className={controlClassName(control)}
            />
          )}
        </FormField>
        <FormField
          label="Target in business minutes"
          required
          description={`1 to ${CASE_LIMITS['sla-target-minutes'].value.toLocaleString('en-GB')}, counted only in the calendar’s business hours.`}
          error={fieldErrorOf(form.problem, `${ROOT}/target-minutes`)}
        >
          {(control) => (
            <input
              {...control}
              type="number"
              name="target-minutes"
              min={1}
              max={CASE_LIMITS['sla-target-minutes'].value}
              defaultValue={attributes?.['target-minutes']}
              className={controlClassName(control)}
            />
          )}
        </FormField>
        <FormField label="Calendar" error={fieldErrorOf(form.problem, `${ROOT}/case-calendar-id`)}>
          {(control) => (
            <select
              {...control}
              name="case-calendar-id"
              defaultValue={calendarId ?? ''}
              className={controlClassName(control)}
            >
              <option value="">Around the clock (24x7)</option>
              {calendars.map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.name}
                </option>
              ))}
              {calendarId !== null && !calendars.some((calendar) => calendar.id === calendarId) && (
                <option value={calendarId}>{calendarId}</option>
              )}
            </select>
          )}
        </FormField>
        <FormField
          label="When a case reopens"
          error={fieldErrorOf(form.problem, `${ROOT}/on-reopen`)}
        >
          {(control) => (
            <select
              {...control}
              name="on-reopen"
              defaultValue={attributes?.['on-reopen'] ?? 'continue'}
              className={controlClassName(control)}
            >
              {CASE_SLA_ON_REOPEN.map((each) => (
                <option key={each} value={each}>
                  {ON_REOPEN_WORDS[each]}
                </option>
              ))}
            </select>
          )}
        </FormField>
      </div>
      <ProblemDisplay problem={unplaced(form.problem, roots)} />
      <div>
        <SubmitButton pendingLabel="Saving…" pending={form.pending}>
          {policy === undefined ? 'Create policy' : 'Save policy'}
        </SubmitButton>
      </div>
    </form>
  );
}

const NINE_TO_FIVE: Readonly<Record<CaseWeekday, string>> = Object.freeze({
  monday: '09:00-17:00',
  tuesday: '09:00-17:00',
  wednesday: '09:00-17:00',
  thursday: '09:00-17:00',
  friday: '09:00-17:00',
  saturday: '',
  sunday: '',
});

/**
 * A business calendar's form (C133.2), to create one or edit it: its zone, each weekday's intervals
 * as text ("09:00-12:00, 13:00-17:00", empty for closed) and, when editing, its holidays one per
 * line. Saving asks the API to check the zone's daylight-saving changes for the next two years; a
 * refusal names the dates, and a save is said with what was checked.
 */
export function CalendarForm({
  environmentId,
  calendar,
  action,
}: {
  readonly environmentId: string;
  readonly calendar?: CaseCalendarResource;
  readonly action: EitherAction;
}) {
  const form = useCreateOrEdit(
    action,
    calendar !== undefined,
    '/case-settings/calendars',
    'Saved the calendar: no business-hours boundary falls in a daylight-saving change of its zone over the next two years.',
  );
  const attributes = calendar?.attributes;
  const roots = ['name', 'time-zone', 'week', 'holidays'].map((member) => `${ROOT}/${member}`);
  return (
    <form
      {...form.formProps}
      aria-label={calendar === undefined ? 'Create a calendar' : 'Edit the calendar'}
      className="flex flex-col gap-4"
    >
      <EnvironmentField environmentId={environmentId} />
      {calendar !== undefined && (
        <input type="hidden" name="case-calendar-id" value={calendar.id} />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Name" required error={fieldErrorOf(form.problem, NAME)}>
          {(control) => (
            <input
              {...control}
              name="name"
              defaultValue={attributes?.name}
              maxLength={80}
              className={controlClassName(control)}
            />
          )}
        </FormField>
        <FormField
          label="Time zone"
          required
          description="An IANA zone, such as Europe/London or America/New_York."
          error={fieldErrorOf(form.problem, `${ROOT}/time-zone`)}
        >
          {(control) => (
            <input
              {...control}
              name="time-zone"
              defaultValue={attributes?.['time-zone']}
              maxLength={64}
              className={controlClassName(control)}
            />
          )}
        </FormField>
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium text-ink">Business hours</legend>
        <p className="text-sm text-ink-muted">
          Each day’s open intervals in local time, as HH:MM-HH:MM separated by commas (24:00 ends a
          day); leave a day empty when closed. At least one business hour a week.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {CASE_WEEKDAYS.map((day) => (
            <FormField
              key={day}
              label={WEEKDAY_WORDS[day]}
              error={errorsUnder(form.problem, `${ROOT}/week/${day}`)}
            >
              {(control) => (
                <input
                  {...control}
                  name={day}
                  defaultValue={
                    attributes === undefined
                      ? NINE_TO_FIVE[day]
                      : intervalsText(attributes.week[day])
                  }
                  className={controlClassName(control)}
                />
              )}
            </FormField>
          ))}
        </div>
        {errorsUnder(form.problem, `${ROOT}/week`) !== undefined &&
          !CASE_WEEKDAYS.some(
            (day) => errorsUnder(form.problem, `${ROOT}/week/${day}`) !== undefined,
          ) && (
            <p className="text-sm font-medium text-danger">
              {errorsUnder(form.problem, `${ROOT}/week`)}
            </p>
          )}
      </fieldset>
      {attributes !== undefined && (
        <FormField
          label="Holidays"
          description={`One per line: a date and its label, such as 2026-12-25 Closing day. Closed all day; at most ${String(CASE_LIMITS['calendar-holidays'].value)}.`}
          error={errorsUnder(form.problem, `${ROOT}/holidays`)}
        >
          {(control) => (
            <textarea
              {...control}
              name="holidays"
              rows={5}
              defaultValue={attributes.holidays
                .map(({ date, label }) => `${date} ${label}`)
                .join('\n')}
              className={controlClassName(control)}
            />
          )}
        </FormField>
      )}
      <ProblemDisplay problem={unplaced(form.problem, roots)} />
      <div>
        <SubmitButton pendingLabel="Saving…" pending={form.pending}>
          {calendar === undefined ? 'Create calendar' : 'Save calendar'}
        </SubmitButton>
      </div>
    </form>
  );
}

/**
 * A calendar's holiday import (C133.2): a `date,label` CSV file, merged with the holidays (a date
 * already there takes the file's label) or replacing them all. The answer says how many were taken
 * and each refused row by its number and why, in words, never its value (P21).
 */
export function HolidayImportForm({
  calendarId,
  action,
}: {
  readonly calendarId: string;
  readonly action: (
    state: ActionState<HolidayImportResult>,
    formData: FormData,
  ) => Promise<ActionResult<HolidayImportResult>>;
}) {
  const fileId = useId();
  const listId = useId();
  const [result, setResult] = useState<HolidayImportResult | null>(null);
  const form = useFormAction(action, {
    onSuccess: (answer) => {
      setResult(answer);
    },
    onProblem: () => {
      setResult(null);
    },
  });
  const fileError = errorsUnder(form.problem, `${ROOT}/csv`);
  return (
    <form {...form.formProps} aria-label="Import holidays" className="flex flex-col gap-4">
      <input type="hidden" name="case-calendar-id" value={calendarId} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fileId} className="text-sm font-medium text-ink">
          CSV file
        </label>
        <p id={`${fileId}-description`} className="text-sm text-ink-muted">
          A header of date,label, then one holiday a row (YYYY-MM-DD). At most{' '}
          {CASE_LIMITS['holiday-csv-characters'].value.toLocaleString('en-GB')} characters.
        </p>
        <input
          id={fileId}
          type="file"
          name="file"
          accept=".csv,text/csv"
          aria-describedby={`${fileId}-description${fileError === undefined ? '' : ` ${fileId}-error`}`}
          aria-invalid={fileError === undefined ? undefined : true}
          className="text-sm file:me-3 file:min-h-11 file:rounded-md file:border file:border-control file:bg-surface file:px-3"
        />
        {fileError !== undefined && (
          <p id={`${fileId}-error`} className="text-sm font-medium text-danger">
            {fileError}
          </p>
        )}
      </div>
      <Checkbox
        name="replace"
        label="Replace every holiday"
        description="Without it, the file’s rows join the holidays already listed."
      />
      <ProblemDisplay problem={withoutFieldErrors(form.problem, [`${ROOT}/csv`])} />
      <div>
        <SubmitButton pendingLabel="Importing…" pending={form.pending}>
          Import
        </SubmitButton>
      </div>
      <div role="status" aria-label="Import result" className="text-sm">
        {result !== null && (
          <>
            <p>
              {`Imported ${String(result.imported)} ${result.imported === 1 ? 'holiday' : 'holidays'}.`}
              {result.refused.length > 0 &&
                ` ${String(result.refused.length)} ${result.refused.length === 1 ? 'row was' : 'rows were'} refused.`}
            </p>
            {result.refused.length > 0 && (
              <>
                <p id={listId} className="sr-only">
                  Refused rows
                </p>
                <ul aria-labelledby={listId} className="list-disc ps-5">
                  {result.refused.map(({ row, code }) => (
                    <li key={row}>{holidayRowWords(row, code)}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </form>
  );
}
