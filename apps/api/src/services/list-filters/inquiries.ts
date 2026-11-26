/**
 * C165.3 (Workflow 9B; K10; contracts B16, B17): the inquiry list's new filters. Owner: `api-exports`;
 * `foundation-9b` (Stage 1b (X)) calls it from `listInquiries` (`services/inquiries.ts`) with the
 * query and the acting principal's PII visibility, and ANDs the conditions it answers.
 *
 * - `filter[list-match]` (`INQUIRY_LIST_MATCH_FILTERS`, B17), over Phase 7's screenings: `matched` an
 *   open list match (not redacted); `not-matched` a `completed` screening and no open match, since only
 *   a completed screening may claim no match (ADR 0005); `unscreened` a `pending`, `partial` or
 *   `errored` screening and no open match. An inquiry with no screening row (no list selected)
 *   matches none of the three.
 * - `filter[list-id]`: an open match on that list.
 * - `filter[check]` with `filter[check-status]`: a check of that name, with that status, on any of the
 *   inquiry's verifications (the contract holds the two together).
 * - `filter[next-step-name]`: the step the inquiry is on, while its flow has not ended; only with PII
 *   visibility (403 naming `pii:view` otherwise): the step reached can reveal a masked value (C151.8,
 *   review P15).
 *
 * Each condition is an `exists` over the inquiry's own rows, so the list keeps its order and paging.
 * The filters' values are repeated in the next link (`links`); a stored API log masks
 * `filter[next-step-name]` (`services/api-logs.ts`).
 */
import type { ListInquiriesQuery } from '@openverify/contracts';
import { inquiries, type Db } from '@openverify/db';
import { sql, type SQL } from 'drizzle-orm';
import { PermissionDeniedError } from '../../errors.js';
import type { ListFilterConditions } from './conditions.js';

/** The filters 9B added to `GET /inquiries` (C165.3). */
export const INQUIRY_LIST_NEW_FILTERS = Object.freeze([
  'filter[list-match]',
  'filter[list-id]',
  'filter[check]',
  'filter[check-status]',
  'filter[next-step-name]',
] as const);

export interface InquiryListFilterInput {
  environmentId: string;
  query: ListInquiriesQuery;
  /** The acting principal sees personal data (`pii:view`, an unmasked key). */
  piiVisible: boolean;
}

/** An open, unredacted list match of the inquiry, on `listId` when given. */
function openMatch(listId?: string): SQL {
  return sql`exists (select 1 from list_matches m
    where m.environment_id = ${inquiries.environmentId} and m.inquiry_id = ${inquiries.id}
      and m.status = 'open' and m.redacted_at is null
      ${listId === undefined ? sql`` : sql`and m.list_id = ${listId}`})`;
}

/** The inquiry's screening row, in one of `statuses`. */
function screening(statuses: readonly string[]): SQL {
  return sql`exists (select 1 from list_screenings s
    where s.environment_id = ${inquiries.environmentId} and s.inquiry_id = ${inquiries.id}
      and s.status in (${sql.join(
        statuses.map((status) => sql`${status}`),
        sql`, `,
      )}))`;
}

const LIST_MATCH_CONDITIONS: Readonly<Record<string, () => SQL>> = {
  matched: () => openMatch(),
  'not-matched': () => sql`(${screening(['completed'])} and not ${openMatch()})`,
  unscreened: () => sql`(${screening(['pending', 'partial', 'errored'])} and not ${openMatch()})`,
};

/** A check of `name` with `status` on one of the inquiry's verifications. */
function checkOutcome(name: string, status: string): SQL {
  return sql`exists (select 1 from verification_checks c
    join verifications v on v.environment_id = c.environment_id and v.id = c.verification_id
    where v.environment_id = ${inquiries.environmentId} and v.inquiry_id = ${inquiries.id}
      and c.name = ${name} and c.status = ${status})`;
}

/** The inquiry is on `stepId`, and its flow has not ended. */
function onStep(stepId: string): SQL {
  return sql`(${inquiries.flowStepId} = ${stepId}
    and ${inquiries.flowState} is distinct from 'ended')`;
}

export function inquiryListFilters(
  _db: Db,
  input: InquiryListFilterInput,
): Promise<ListFilterConditions> {
  const { query } = input;
  const where: SQL[] = [];
  const links: Record<string, string | undefined> = {};
  const stepName = query['filter[next-step-name]'];
  if (stepName !== undefined) {
    if (!input.piiVisible) {
      return Promise.reject(
        new PermissionDeniedError(
          'filter[next-step-name] needs pii:view: the step reached can reveal a masked value.',
          ['pii:view'],
        ),
      );
    }
    where.push(onStep(stepName));
    links['filter[next-step-name]'] = stepName;
  }
  const listMatch = query['filter[list-match]'];
  if (listMatch !== undefined) {
    const condition = LIST_MATCH_CONDITIONS[listMatch];
    if (condition !== undefined) {
      where.push(condition());
    }
    links['filter[list-match]'] = listMatch;
  }
  const listId = query['filter[list-id]'];
  if (listId !== undefined) {
    where.push(openMatch(listId));
    links['filter[list-id]'] = listId;
  }
  const check = query['filter[check]'];
  const checkStatus = query['filter[check-status]'];
  if (check !== undefined && checkStatus !== undefined) {
    where.push(checkOutcome(check, checkStatus));
    links['filter[check]'] = check;
    links['filter[check-status]'] = checkStatus;
  }
  return Promise.resolve({ where, links });
}
