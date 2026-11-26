/**
 * C133.2 (Workflow 8B): what `routes/server/case-calendars.ts` calls. Owner `api-queues-sla`;
 * `foundation-8b` (Stage 1b (Q)) froze each name and its route.
 *
 * - A calendar is checked with `case-logic`'s `calendarProblems`: the zone known to the runtime, and no
 *   boundary of the next two years in a gap or a repeat (`calendar_invalid`, naming the dates).
 * - An edit (a holiday import included) recomputes, in its transaction, the running deadlines of the
 *   cases whose SLA counts on it, each with a history row (decision 59): the time used is measured on
 *   the calendar as it was, and what remains runs on the calendar as it is. A target the new hours
 *   cannot reach within ten years refuses the edit (`sla_out_of_range`). The calendar row is locked
 *   first, then the cases.
 * - Holidays import from a `date,label` CSV through `readCsv` (C118.5), merged by date unless
 *   `replace`; a refused row is named by its line and a code, never its value (P21), and a file refused
 *   whole (a header other than `date,label`, an encoding, too many rows) answers 422 with its codes.
 */
import { readCsv, type CsvProblem } from '@openverify/checks';
import {
  caseCalendarHolidaySchema,
  newId,
  type CaseCalendarDocument,
  type CaseCalendarImportDocument,
  type CaseCalendarListDocument,
  type CreateCaseCalendarBody,
  type ImportCaseCalendarHolidaysBody,
  type listCaseCalendarsQuerySchema,
  type UpdateCaseCalendarBody,
} from '@openverify/contracts';
import { CASE_LIMITS } from '@openverify/core';
import {
  createCaseCalendarRow,
  getCaseCalendarRow,
  getCaseRow,
  listCaseCalendarRows,
  lockCaseCalendarRow,
  lockCasesOnCalendar,
  updateCaseCalendarRow,
  type CaseCalendarContent,
  type CaseCalendarRow,
} from '@openverify/db';
import type { z } from 'zod';
import { NotFoundError, UnprocessableContentError } from '../../../errors.js';
import type { ApiDependencies } from '../../context.js';
import { nextLink, pageRequest, withCursor } from '../../pagination.js';
import { CaseProblemError } from '../problems.js';
import type { CaseActing } from '../service.js';
import { caseChange, createdAtOf, dateOf, type CaseUnit } from '../shared.js';
import { queueAudit } from '../queues/audit.js';
import { caseCalendarResource } from '../queues/resources.js';
import { workOfUnit } from '../queues/work.js';
import { calendarProblems, type BusinessCalendar } from './business-time.js';
import { businessCalendarOf, measured, slaOf, writeSlaChangeInTx } from './policy-sla.js';
import { recomputeSla } from './sla-state.js';

const PATH = '/api/v1/case-calendars';
const ATTRIBUTES = '/data/attributes';
const CSV_POINTER = `${ATTRIBUTES}/csv`;
/** One `date,label` record: a date, a label of at most 80 characters, quotes and a separator. */
const HOLIDAY_RECORD_CHARACTERS = 1_024;

/**
 * C133.3: a calendar the runtime can read, with no boundary of the next two years in a clock change.
 * @throws {CaseProblemError} `calendar_invalid` naming the dates.
 */
function assertCalendar(calendar: BusinessCalendar, now: Date): void {
  const problems = measured(() => calendarProblems(calendar, now));
  if (problems.length === 0) {
    return;
  }
  const unknownZone = problems.some(({ reason }) => reason === 'time-zone-unknown');
  const dates = [...new Set(problems.flatMap((problem) => problem.dates))].sort();
  throw new CaseProblemError(
    'calendar_invalid',
    unknownZone
      ? 'This calendar’s time zone is not one the runtime knows.'
      : 'A boundary of this calendar falls in a clock change.',
    {
      members: { dates },
      errors: [
        unknownZone
          ? { location: 'body', pointer: `${ATTRIBUTES}/time-zone`, detail: 'is not a known zone' }
          : { location: 'body', pointer: `${ATTRIBUTES}/week`, detail: 'falls in a clock change' },
      ],
    },
  );
}

const contentOf = (row: CaseCalendarRow): CaseCalendarContent => ({
  name: row.name,
  timeZone: row.timeZone,
  week: row.week,
  holidays: row.holidays,
  closures: row.closures,
});

/**
 * Decision 59: the running and paused SLAs counting on this calendar, recomputed from `previous` to
 * `next`. Answers how many moved.
 */
async function recomputeOnCalendar(
  unit: CaseUnit,
  calendarId: string,
  previous: BusinessCalendar,
  next: BusinessCalendar,
): Promise<number> {
  const { environmentId } = unit.acting.ctx;
  const work = workOfUnit(unit);
  let moved = 0;
  for (const id of await lockCasesOnCalendar(unit.tx, environmentId, calendarId)) {
    const row = await getCaseRow(unit.tx, environmentId, id);
    if (row?.slaTargetMs === null || row === null) {
      continue;
    }
    const targetMs = row.slaTargetMs;
    const change = measured(
      () =>
        recomputeSla(
          slaOf(row),
          { targetMs, calendar: previous },
          { targetMs, calendar: next },
          unit.at,
        ),
      `${ATTRIBUTES}/week`,
    );
    if (change.changed) {
      await writeSlaChangeInTx(work, row, change, { to: { 'case-calendar-id': calendarId } });
      moved += 1;
    }
  }
  return moved;
}

/** Writes `changes` to a locked calendar, checking it and recomputing the SLAs on it. */
async function changeCalendar(
  unit: CaseUnit,
  id: string,
  changes: Partial<CaseCalendarContent>,
): Promise<{ row: CaseCalendarRow; moved: number }> {
  const { environmentId } = unit.acting.ctx;
  const current = await lockCaseCalendarRow(unit.tx, environmentId, id);
  if (current === null) {
    throw new NotFoundError(`Case calendar ${id} was not found.`);
  }
  const previous = businessCalendarOf(current);
  const next = businessCalendarOf({ ...contentOf(current), ...changes });
  assertCalendar(next, unit.at);
  const row = await updateCaseCalendarRow(unit.tx, environmentId, id, changes);
  if (row === null) {
    throw new NotFoundError(`Case calendar ${id} was not found.`);
  }
  return { row, moved: await recomputeOnCalendar(unit, id, previous, next) };
}

export async function listCaseCalendars(
  deps: ApiDependencies,
  acting: CaseActing,
  query: z.infer<typeof listCaseCalendarsQuerySchema>,
): Promise<CaseCalendarListDocument> {
  const { start, end } = createdAtOf(query);
  const page = await withCursor(() =>
    listCaseCalendarRows(
      deps.db,
      acting.ctx.environmentId,
      { createdAtStart: dateOf(start), createdAtEnd: dateOf(end) },
      pageRequest(query),
    ),
  );
  return {
    data: page.items.map(caseCalendarResource),
    links: {
      next: nextLink(
        PATH,
        { 'filter[created-at-start]': start, 'filter[created-at-end]': end },
        query,
        page.next,
      ),
    },
  };
}

export async function createCaseCalendar(
  deps: ApiDependencies,
  acting: CaseActing,
  body: CreateCaseCalendarBody,
): Promise<CaseCalendarDocument> {
  const attributes = body.data.attributes;
  const content: CaseCalendarContent = {
    name: attributes.name,
    timeZone: attributes['time-zone'],
    week: attributes.week,
    holidays: attributes.holidays ?? [],
    closures: attributes.closures ?? [],
  };
  const row = await caseChange(deps, acting, async (unit) => {
    assertCalendar(businessCalendarOf(content), unit.at);
    const created = await createCaseCalendarRow(unit.tx, acting.ctx.environmentId, {
      id: newId('ccal'),
      ...content,
    });
    await unit.audit(
      queueAudit('case-calendar.created', created.id, {
        'holiday-count': content.holidays.length,
        'closure-count': content.closures.length,
      }),
    );
    return created;
  });
  return { data: caseCalendarResource(row) };
}

export async function getCaseCalendar(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
): Promise<CaseCalendarDocument> {
  const row = await getCaseCalendarRow(deps.db, acting.ctx.environmentId, id);
  if (row === null) {
    throw new NotFoundError(`Case calendar ${id} was not found.`);
  }
  return { data: caseCalendarResource(row) };
}

/** A member sent replaces the stored one whole; the running deadlines on it are recomputed. */
export async function updateCaseCalendar(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
  body: UpdateCaseCalendarBody,
): Promise<CaseCalendarDocument> {
  const attributes = body.data.attributes;
  const row = await caseChange(deps, acting, async (unit) => {
    const changed = await changeCalendar(unit, id, {
      ...(attributes.name === undefined ? {} : { name: attributes.name }),
      ...(attributes['time-zone'] === undefined ? {} : { timeZone: attributes['time-zone'] }),
      ...(attributes.week === undefined ? {} : { week: attributes.week }),
      ...(attributes.holidays === undefined ? {} : { holidays: attributes.holidays }),
      ...(attributes.closures === undefined ? {} : { closures: attributes.closures }),
    });
    await unit.audit(
      queueAudit('case-calendar.updated', id, {
        attributes: Object.keys(attributes).sort(),
        'recomputed-case-count': changed.moved,
      }),
    );
    return changed.row;
  });
  return { data: caseCalendarResource(row) };
}

const HEADER = ['date', 'label'] as const;

function headerProblems(header: readonly string[]): CsvProblem[] {
  const names = header.map((name) => name.trim().toLowerCase());
  if (new Set(names).size !== names.length) {
    return [{ row: null, column: null, code: 'duplicate_column' }];
  }
  if (HEADER.some((name) => !names.includes(name))) {
    return [{ row: null, column: null, code: 'missing_column' }];
  }
  return names.length === HEADER.length
    ? []
    : [{ row: null, column: null, code: 'unknown_column' }];
}

interface HolidayReading {
  holidays: { date: string; label: string }[];
  refused: { row: number; code: string }[];
}

/** The rows of a `date,label` CSV: each read, or refused by line and code. */
function readHolidays(csv: string): HolidayReading {
  const reading = readCsv(new TextEncoder().encode(csv), {
    maxRows: CASE_LIMITS['calendar-holidays'].value,
    maxRecordCharacters: HOLIDAY_RECORD_CHARACTERS,
    headerProblems,
  });
  if (reading.refused) {
    throw new UnprocessableContentError(
      'The CSV was refused whole.',
      reading.errors.map(({ code }) => ({ location: 'body', pointer: CSV_POINTER, detail: code })),
    );
  }
  const refused: { row: number; code: string }[] = reading.errors.map(({ row, code }) => ({
    row: row ?? 0,
    code,
  }));
  const seen = new Set<string>();
  const holidays: { date: string; label: string }[] = [];
  for (const { row, cells } of reading.rows) {
    const cell = (name: string) =>
      (Object.entries(cells).find(([key]) => key.trim().toLowerCase() === name)?.[1] ?? '').trim();
    const parsed = caseCalendarHolidaySchema.safeParse({
      date: cell('date'),
      label: cell('label'),
    });
    if (!parsed.success) {
      refused.push({ row, code: 'invalid_value' });
    } else if (seen.has(parsed.data.date)) {
      refused.push({ row, code: 'date_repeated' });
    } else {
      seen.add(parsed.data.date);
      holidays.push(parsed.data);
    }
  }
  return { holidays, refused: refused.sort((a, b) => a.row - b.row) };
}

/** `date,label` rows through `readCsv` (C118.5); a refused row is named by number and code only. */
export async function importCaseCalendarHolidays(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
  body: ImportCaseCalendarHolidaysBody,
): Promise<CaseCalendarImportDocument> {
  const { csv, replace = false } = body.data.attributes;
  const reading = readHolidays(csv);
  const row = await caseChange(deps, acting, async (unit) => {
    const current = await getCaseCalendarRow(unit.tx, acting.ctx.environmentId, id);
    if (current === null) {
      throw new NotFoundError(`Case calendar ${id} was not found.`);
    }
    const byDate = new Map(
      (replace ? [] : current.holidays).map((holiday) => [holiday.date, holiday] as const),
    );
    for (const holiday of reading.holidays) {
      byDate.set(holiday.date, holiday);
    }
    const holidays = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    if (holidays.length > CASE_LIMITS['calendar-holidays'].value) {
      throw new UnprocessableContentError('A calendar holds at most 500 holidays.', [
        {
          location: 'body',
          pointer: CSV_POINTER,
          detail: 'too many holidays with the stored ones',
        },
      ]);
    }
    const changed = await changeCalendar(unit, id, { holidays });
    await unit.audit(
      queueAudit('case-calendar.holidays-imported', id, {
        'imported-count': reading.holidays.length,
        'refused-count': reading.refused.length,
        replace,
      }),
    );
    return changed.row;
  });
  return {
    data: caseCalendarResource(row),
    meta: { 'imported-count': reading.holidays.length, refused: reading.refused },
  };
}
