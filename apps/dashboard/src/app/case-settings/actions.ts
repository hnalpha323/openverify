'use server';

/**
 * SLA policy and business calendar mutations of the case console (C133, C142.1), with
 * `case-queues:write`. Each is saved through the API with its problems by JSON Pointer. A calendar's
 * week is typed one day at a time ("09:00-12:00, 13:00-17:00"), its holidays one per line; the API
 * checks the zone's daylight-saving changes over the next two years and refuses a boundary in a gap
 * or a repeat (`calendar_invalid`), which the console says with the dates it names. The holiday CSV
 * import answers what it took and each refused row by number and code, never a value (P21).
 */
import {
  createCaseCalendarBodySchema,
  createCaseSlaPolicyBodySchema,
  idSchema,
  importCaseCalendarHolidaysBodySchema,
  updateCaseCalendarBodySchema,
  updateCaseSlaPolicyBodySchema,
} from '@openverify/contracts';
import { CASE_WEEKDAYS } from '@openverify/core';
import { OpenVerifyApiError } from '@openverify/node';
import { revalidatePath } from 'next/cache';
import { CASE_PROBLEM_WORDS, HOLIDAY_FILE_WORDS } from '../../components/cases/case-words';
import type { ActionResult, ActionState, DisplayProblem } from '../../lib/action-state';
import { ActionInputError, formString, parseInput } from '../../lib/api/action';
import { runCaseAction } from '../../lib/api/cases';

/** What a holiday import answers: how many were taken, and each refused row by number and code. */
export interface HolidayImportAnswer {
  readonly imported: number;
  readonly refused: readonly { readonly row: number; readonly code: string }[];
}

const ROOT = '/data/attributes';
const CSV = `${ROOT}/csv`;
const settingsPath = '/case-settings';
const policyPath = (id: string) => `${settingsPath}/sla-policies/${id}`;
const calendarPath = (id: string) => `${settingsPath}/calendars/${id}`;

/** A whole number as typed, or the text itself for the schema to refuse. */
const integerOf = (text: string | undefined): number | string | undefined => {
  const value = (text ?? '').trim();
  if (value === '') {
    return undefined;
  }
  return /^-?\d+$/u.test(value) ? Number(value) : value;
};

const nullableId = (formData: FormData, name: string) => {
  const value = formString(formData, name) ?? '';
  return value === '' ? null : value;
};

/** The SLA policy's attributes as the form gives them; no calendar counts around the clock. */
const slaAttributesOf = (formData: FormData) => ({
  name: formString(formData, 'name'),
  'target-minutes': integerOf(formString(formData, 'target-minutes')),
  'case-calendar-id': nullableId(formData, 'case-calendar-id'),
  'on-reopen': formString(formData, 'on-reopen'),
});

/** `POST /case-sla-policies`. */
export async function createSlaPolicy(
  _state: ActionState<{ id: string }>,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return runCaseAction(
    { permissions: ['case-queues:write'], environmentForm: formData },
    async ({ api }) => {
      const body = parseInput(createCaseSlaPolicyBodySchema, {
        data: { attributes: slaAttributesOf(formData) },
      });
      const { data } = await api.caseSlaPolicies.create(body.data.attributes);
      revalidatePath(settingsPath);
      return { id: data.id };
    },
  );
}

/** `PATCH /case-sla-policies/:id`: a new revision; running SLAs keep the one they pinned. */
export async function updateSlaPolicy(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runCaseAction({ permissions: ['case-queues:write'] }, async ({ api }) => {
    const id = parseInput(idSchema('cslap'), formString(formData, 'case-sla-policy-id'));
    const body = parseInput(updateCaseSlaPolicyBodySchema, {
      data: { attributes: slaAttributesOf(formData) },
    });
    await api.caseSlaPolicies.update(id, body.data.attributes);
    revalidatePath(policyPath(id));
    revalidatePath(settingsPath);
    return undefined;
  });
}

const INTERVAL = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/u;

/** Each weekday's intervals as typed; a day written another way refused at its place. */
function weekOf(formData: FormData) {
  const errors: { pointer: string; detail: string }[] = [];
  const week = Object.fromEntries(
    CASE_WEEKDAYS.map((day) => {
      const text = (formString(formData, day) ?? '').trim();
      const parts = text === '' ? [] : text.split(',').map((part) => part.trim());
      const intervals = parts.flatMap((part) => {
        const match = INTERVAL.exec(part);
        return match === null ? [] : [{ start: match[1] ?? '', end: match[2] ?? '' }];
      });
      if (intervals.length !== parts.length) {
        errors.push({
          pointer: `${ROOT}/week/${day}`,
          detail: 'Write each interval as HH:MM-HH:MM, separated by commas.',
        });
      }
      return [day, intervals];
    }),
  );
  if (errors.length > 0) {
    throw new ActionInputError({ title: 'Check the business hours you entered', errors });
  }
  return week;
}

/** Holidays one per line, a date and its label: "2026-12-25 Closing day". */
function holidaysOf(text: string | undefined) {
  return (text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const match = /^(\S+)[\s,]+(.+)$/u.exec(line);
      return match === null
        ? { date: line, label: '' }
        : { date: match[1] ?? '', label: (match[2] ?? '').trim() };
    });
}

/**
 * `calendar_invalid` said with the dates it names (the two-year check of C133.3); `null` for any
 * other failure.
 */
function calendarProblemOf(error: unknown): DisplayProblem | null {
  if (!(error instanceof OpenVerifyApiError) || error.code !== 'calendar_invalid') {
    return null;
  }
  const dates: unknown = error.problem.dates;
  const named = Array.isArray(dates)
    ? dates.filter((date): date is string => typeof date === 'string')
    : [];
  return {
    title: CASE_PROBLEM_WORDS.calendar_invalid,
    ...(named.length > 0
      ? {
          detail: `Over the next two years, a boundary of the business hours falls in a daylight-saving gap or repeat of the time zone on these dates: ${named.join(', ')}. Move the boundary off the change, or choose another zone.`,
        }
      : typeof error.problem.detail === 'string'
        ? { detail: error.problem.detail }
        : {}),
    status: error.status,
    ...(error.requestId === null ? {} : { requestId: error.requestId }),
  };
}

/** Runs a calendar write, saying a refused two-year check with its dates. */
async function checkedCalendarWrite<Data>(write: () => Promise<Data>): Promise<Data> {
  try {
    return await write();
  } catch (error) {
    const problem = calendarProblemOf(error);
    if (problem !== null) {
      throw new ActionInputError(problem);
    }
    throw error;
  }
}

/** `POST /case-calendars`: its name, zone and week; holidays and closures start empty. */
export async function createCalendar(
  _state: ActionState<{ id: string }>,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return runCaseAction(
    { permissions: ['case-queues:write'], environmentForm: formData },
    async ({ api }) => {
      const body = parseInput(createCaseCalendarBodySchema, {
        data: {
          attributes: {
            name: formString(formData, 'name'),
            'time-zone': formString(formData, 'time-zone'),
            week: weekOf(formData),
          },
        },
      });
      const { data } = await checkedCalendarWrite(() =>
        api.caseCalendars.create(body.data.attributes),
      );
      revalidatePath(settingsPath);
      return { id: data.id };
    },
  );
}

/** `PATCH /case-calendars/:id`: the name, zone, week and holidays; closures are kept as they are. */
export async function updateCalendar(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runCaseAction({ permissions: ['case-queues:write'] }, async ({ api }) => {
    const id = parseInput(idSchema('ccal'), formString(formData, 'case-calendar-id'));
    const body = parseInput(updateCaseCalendarBodySchema, {
      data: {
        attributes: {
          name: formString(formData, 'name'),
          'time-zone': formString(formData, 'time-zone'),
          week: weekOf(formData),
          holidays: holidaysOf(formString(formData, 'holidays', { trim: false })),
        },
      },
    });
    await checkedCalendarWrite(() => api.caseCalendars.update(id, body.data.attributes));
    revalidatePath(calendarPath(id));
    revalidatePath(settingsPath);
    return undefined;
  });
}

/** A refused file's codes (the API's detail at `/data/attributes/csv`) said in words. */
function fileProblemInWords(problem: DisplayProblem): DisplayProblem {
  return problem.errors === undefined
    ? problem
    : {
        ...problem,
        errors: problem.errors.map((error) => ({
          ...error,
          detail: HOLIDAY_FILE_WORDS[error.detail] ?? error.detail,
        })),
      };
}

/** `POST /case-calendars/:id/holidays/import`: a `date,label` CSV file, merged or replacing. */
export async function importHolidays(
  _state: ActionState<HolidayImportAnswer>,
  formData: FormData,
): Promise<ActionResult<HolidayImportAnswer>> {
  const result = await runCaseAction({ permissions: ['case-queues:write'] }, async ({ api }) => {
    const id = parseInput(idSchema('ccal'), formString(formData, 'case-calendar-id'));
    const file = formData.get('file');
    const csv = file instanceof File ? await file.text() : '';
    if (csv.trim() === '') {
      throw new ActionInputError({
        title: 'Choose a file',
        errors: [{ pointer: CSV, detail: 'Choose a CSV file with a date,label header.' }],
      });
    }
    const body = parseInput(importCaseCalendarHolidaysBodySchema, {
      data: { attributes: { csv, replace: formData.get('replace') === 'on' } },
    });
    const answer = await checkedCalendarWrite(() =>
      api.caseCalendars.importHolidays(id, body.data.attributes),
    );
    revalidatePath(calendarPath(id));
    return {
      imported: answer.meta['imported-count'],
      refused: answer.meta.refused.map(({ row, code }) => ({ row, code })),
    };
  });
  return result.ok ? result : { ok: false, problem: fileProblemInWords(result.problem) };
}
