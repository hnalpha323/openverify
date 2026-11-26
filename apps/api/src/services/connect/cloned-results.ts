/**
 * C235.4, C235.7 (Workflow 11A; review H02, H07): what a cloned verification or check counts for at
 * the destination. Owner: `api-redeem`, over `connect-logic`'s pure `clonedResultVerdict`
 * (`packages/core/src/connect/cloned-results.ts`). `foundation-11a` placed the hooks that call it
 * (Stage 1b (R)), each one line in a shared file:
 *
 * - `countedVerifications` where the decision path loads an inquiry's verifications: the flow engine
 *   (`flow-engine/engine.ts`, `loadEngine`), the session members (`flow-engine/session.ts`,
 *   `flowSessionMembers`) and the settlement of an unpositioned inquiry
 *   (`services/inquiry-settlement.ts`), so a clone that does not count is absent from every step
 *   outcome, exit and decision that reads them (`verification-state.ts` is unchanged);
 * - `verificationCountsInWorkflows` in Phase 8's `fetch_object` of a verification
 *   (`workflows/actions/objects/table.ts`), so a workflow condition cannot approve on a clone;
 * - `notClonedVerification` and `notClonedCheck`, SQL predicates of the analytics rollups
 *   (`services/analytics/rollup-sql.ts`), so a clone never enters a pass rate or a failure
 *   distribution (C235.7(c), orchestrator decision 21; unconditional: counted or not).
 *
 * The rule (C235.4): with the inquiry's template version's `accept-cloned-results` off (the
 * default), no clone counts. With it on, a clone counts only when its type is listed, it passed,
 * its source decided less than `max-age-days` before the destination's decision (`now`, never the
 * redemption; review H07), and its destination-side consent was not withdrawn by then
 * (`provenance.consent-withdrawn-at`, C237.6 (2)). A cloned failure never counts: it routes the
 * inquiry to review (`clonedInquiryReview`), never declines or fails it by itself.
 *
 * The source's decision time is the clone's own `completed_at`, which the redemption copies from
 * the source verification; a row without one falls back to `provenance.source-created-at`, which is
 * no later than the decision, so a clone never counts for longer than it should (connect-logic's
 * finding: the frozen provenance has no `source-decided-at`).
 */
import {
  acceptClonedResultsSchema,
  provenanceSchema,
  type AcceptClonedResults,
  type InquiryResource,
  type Provenance,
} from '@openverify/contracts';
import {
  clonedInquiryOutcome,
  clonedResultVerdict,
  reliedOnCloned,
  type ClonedInquiryOutcome,
  type ClonedResultVerdict,
} from '@openverify/core';
import {
  getInquiry,
  getInquiryTemplateVersion,
  listInquiryVerifications,
  type Db,
} from '@openverify/db';
import { sql, type SQL } from 'drizzle-orm';

/** A row that may be a copy (a verification or a check row, with its stored provenance). */
export interface MaybeCloned {
  provenance?: unknown;
}

/** A verification row as the verdict reads it (`Verification` is one). */
export interface ClonedVerificationRow extends MaybeCloned {
  type: string;
  status: string;
  completedAt?: Date | null;
}

/** What the verdict reads beyond the row: the inquiry's template version. */
export interface ClonedResultInquiry {
  environmentId: string;
  inquiryTemplateVersionId: string;
}

/** Whether a row is a clone (`provenance.kind` is `connect-clone`); a hydrate is not. */
export function isClonedVerification(row: MaybeCloned): boolean {
  const provenance = row.provenance;
  return (
    typeof provenance === 'object' &&
    provenance !== null &&
    (provenance as { kind?: unknown }).kind === 'connect-clone'
  );
}

/**
 * C235.3: the version's `accept-cloned-results`, or `null` (off) when it is absent, `null`, or
 * unreadable (a stored setting that no longer parses fails closed: no clone counts).
 */
export async function acceptClonedResultsOf(
  db: Db,
  inquiry: ClonedResultInquiry,
): Promise<AcceptClonedResults | null> {
  const version = await getInquiryTemplateVersion(
    db,
    inquiry.environmentId,
    inquiry.inquiryTemplateVersionId,
  );
  const stored = (version?.settings as Record<string, unknown> | undefined)?.[
    'accept-cloned-results'
  ];
  if (stored === undefined || stored === null) {
    return null;
  }
  const parsed = acceptClonedResultsSchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
}

const dateOf = (value: unknown): Date | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** C235.4: the verdict on one row at the destination's decision time `now`. */
export function clonedVerdictOf(
  accept: AcceptClonedResults | null,
  clone: ClonedVerificationRow,
  now: Date,
): ClonedResultVerdict {
  const provenance = (clone.provenance ?? {}) as Record<string, unknown>;
  const sourceDecidedAt =
    clone.completedAt ?? dateOf(provenance['source-created-at']) ?? new Date(now.getTime());
  return clonedResultVerdict(
    accept,
    {
      type: clone.type,
      status: clone.status,
      sourceDecidedAt,
      consentWithdrawnAt: dateOf(provenance['consent-withdrawn-at']),
    },
    now,
  );
}

/** C235.4: whether one cloned verification counts at `now` for the inquiry's template version. */
export async function clonedVerificationCounts(
  db: Db,
  inquiry: ClonedResultInquiry,
  clone: ClonedVerificationRow,
  now: Date,
): Promise<boolean> {
  return clonedVerdictOf(await acceptClonedResultsOf(db, inquiry), clone, now).use === 'count';
}

/**
 * The verifications the decision path reads: every verification that is not a clone, as today, and a
 * clone only when it counts. Order is kept. The version's setting is read once, and only when the
 * inquiry holds a clone.
 */
export async function countedVerifications<T extends ClonedVerificationRow>(
  db: Db,
  inquiry: ClonedResultInquiry,
  verifications: readonly T[],
  now: Date,
): Promise<T[]> {
  if (!verifications.some(isClonedVerification)) {
    return [...verifications];
  }
  const accept = await acceptClonedResultsOf(db, inquiry);
  return verifications.filter(
    (verification) =>
      !isClonedVerification(verification) ||
      clonedVerdictOf(accept, verification, now).use === 'count',
  );
}

/** The clones of an inquiry with their verdicts at `now`, in the inquiry's verification order. */
export async function clonedVerdictsOfInquiry(
  db: Db,
  inquiry: ClonedResultInquiry & { id: string },
  now: Date,
): Promise<{
  accept: AcceptClonedResults | null;
  verdicts: { verificationId: string; shareTokenId: string | null; verdict: ClonedResultVerdict }[];
}> {
  const clones = (await listInquiryVerifications(db, inquiry.environmentId, inquiry.id)).filter(
    isClonedVerification,
  );
  if (clones.length === 0) {
    return { accept: null, verdicts: [] };
  }
  const accept = await acceptClonedResultsOf(db, inquiry);
  return {
    accept,
    verdicts: clones.map((clone) => ({
      verificationId: clone.id,
      shareTokenId: shareTokenIdOf(clone.provenance),
      verdict: clonedVerdictOf(accept, clone, now),
    })),
  };
}

/**
 * C235.4: what the clones of an inquiry say of its outcome at `now`: `null` when it holds no clone
 * (the destination's rules alone), else `connect-logic`'s `clonedInquiryOutcome` (off: review; a
 * fresh listed failure: review; otherwise the destination's rules with the counted clones).
 */
export async function clonedInquiryReview(
  db: Db,
  inquiry: ClonedResultInquiry & { id: string },
  now: Date,
): Promise<ClonedInquiryOutcome | null> {
  const { accept, verdicts } = await clonedVerdictsOfInquiry(db, inquiry, now);
  return verdicts.length === 0
    ? null
    : clonedInquiryOutcome(
        accept,
        verdicts.map(({ verdict }) => verdict),
      );
}

/**
 * C235.4, C128.1 (Phase 8's decision record; the named borrowed edit in
 * `services/decisions/record.ts`): whether the decision relies on a counted clone, and the share
 * token it names (the first counted clone's, in the inquiry's verification order).
 */
export async function clonedRelianceOf(
  db: Db,
  inquiry: ClonedResultInquiry & { id: string },
  now: Date,
): Promise<{ reliedOnCloned: boolean; shareTokenId: string | null }> {
  const { verdicts } = await clonedVerdictsOfInquiry(db, inquiry, now);
  const counted = verdicts.find(({ verdict }) => verdict.use === 'count');
  return {
    reliedOnCloned: reliedOnCloned(verdicts.map(({ verdict }) => verdict)) && counted !== undefined,
    shareTokenId: counted?.shareTokenId ?? null,
  };
}

/**
 * C235.7(b): whether Phase 8's condition reads and actions see a verification. One that is not a
 * clone, always; a clone only when C235.4 counts it at `now` for its inquiry.
 */
export async function verificationCountsInWorkflows(
  db: Db,
  verification: ClonedVerificationRow & { environmentId?: string; inquiryId?: string },
  now?: Date,
): Promise<boolean> {
  if (!isClonedVerification(verification)) {
    return true;
  }
  if (verification.environmentId === undefined || verification.inquiryId === undefined) {
    return false;
  }
  const inquiry = await getInquiry(db, verification.environmentId, verification.inquiryId);
  if (inquiry === null) {
    return false;
  }
  return clonedVerificationCounts(db, inquiry, verification, now ?? inquiry.updatedAt);
}

/** The share token a copy names, or `null` when the provenance names none. */
export function shareTokenIdOf(provenance: unknown): string | null {
  const id = (provenance as Record<string, unknown> | null | undefined)?.['share-token-id'];
  return typeof id === 'string' ? id : null;
}

/** C235.1: a stored provenance in its served form, or `undefined` for a row that is not a copy. */
export function servedProvenance(stored: unknown): Provenance | undefined {
  if (stored === null || stored === undefined) {
    return undefined;
  }
  const parsed = provenanceSchema.safeParse(stored);
  return parsed.success ? parsed.data : undefined;
}

/**
 * C235.7(a): an inquiry resource with the row's `provenance` when the inquiry is a copy, so every
 * `inquiry.*` event and read about a cloned or filled inquiry says what it is. Unchanged otherwise.
 */
export function withInquiryProvenance(
  resource: InquiryResource,
  row: { provenance?: unknown },
): InquiryResource {
  const provenance = servedProvenance(row.provenance);
  return provenance === undefined
    ? resource
    : { ...resource, attributes: { ...resource.attributes, provenance } };
}

/** C235.7(c): the rollups' predicate over a verification alias (`v`): not a clone. */
export const notClonedVerification = (alias: string): SQL =>
  sql.raw(`(${alias}.provenance is null or ${alias}.provenance->>'kind' <> 'connect-clone')`);

/** C235.7(c): the rollups' predicate over a check alias (`c`): not a cloned check. */
export const notClonedCheck = (alias: string): SQL =>
  sql.raw(
    `(${alias}.connect_provenance is null or ${alias}.connect_provenance->>'kind' <> 'connect-clone')`,
  );
