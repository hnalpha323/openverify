/**
 * C75: report matches: the match state machine's writes, the suppression lookup by entry index
 * and evidence hash, and the ignore list. Only `source_id`, `score` and the statuses are plain;
 * the entry key and the evidence are HMACs the caller computes, and everything readable is in
 * the sealed snapshot (C73.2, P01).
 *
 * Owner: `api-reports` (Workflow 6A Stage 3), who adds every function this file needs. The file
 * and its export line in `repositories/index.ts` are frozen by `foundation-6` (Stage 1b).
 */
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { reportMatches, type ReportMatchRow } from '../schema.js';
import { openOptionalJson, sealJson } from '../sealed.js';
import { inserted } from './rows.js';

/** The owner of this repository file. */
export const REPORT_MATCHES_REPOSITORY_OWNER = 'api-reports';

export type ReportMatchStatusValue = ReportMatchRow['status'];
export type ReportReviewStatusValue = ReportMatchRow['reviewStatus'];

/** A match row with its snapshot opened (`null` once redacted). */
export type StoredReportMatch = Omit<ReportMatchRow, 'snapshotSealed'> & {
  snapshot: Record<string, unknown> | null;
};

export interface NewReportMatchInput {
  id: string;
  reportId: string;
  sourceId: string | null;
  entryIndex: string;
  evidenceHash: string;
  score: number;
  snapshot: Record<string, unknown>;
  status: ReportMatchStatusValue;
  reviewStatus: ReportReviewStatusValue;
  riskLevel?: ReportMatchRow['riskLevel'];
  notifyOnChange?: boolean;
  runId: string;
  lapsedFrom?: string | null;
  at: Date;
}

export interface ReportMatchChanges {
  status?: ReportMatchStatusValue;
  reviewStatus?: ReportReviewStatusValue;
  riskLevel?: ReportMatchRow['riskLevel'];
  notifyOnChange?: boolean;
  presentInLastRun?: boolean;
  evidenceHash?: string;
  score?: number;
  snapshot?: Record<string, unknown>;
  lastRunId?: string;
  reviewedAt?: Date;
  delistedAt?: Date;
  at: Date;
}

const SEALED_SNAPSHOT = 'report_matches.snapshot';

const matchIn = (environmentId: string, id: string) =>
  and(eq(reportMatches.environmentId, environmentId), eq(reportMatches.id, id));

function opened(row: ReportMatchRow): StoredReportMatch {
  const { snapshotSealed, ...rest } = row;
  const snapshot = openOptionalJson(SEALED_SNAPSHOT, row.id, snapshotSealed);
  return {
    ...rest,
    snapshot:
      snapshot !== null && typeof snapshot === 'object'
        ? (snapshot as Record<string, unknown>)
        : null,
  };
}

/** Every match of the report, newest first, snapshots opened. */
export async function listReportMatches(
  db: Db,
  environmentId: string,
  reportId: string,
): Promise<StoredReportMatch[]> {
  const rows = await db
    .select()
    .from(reportMatches)
    .where(
      and(eq(reportMatches.environmentId, environmentId), eq(reportMatches.reportId, reportId)),
    )
    .orderBy(desc(reportMatches.createdAt), desc(reportMatches.id));
  return rows.map(opened);
}

export async function insertReportMatch(
  db: Db,
  environmentId: string,
  input: NewReportMatchInput,
): Promise<StoredReportMatch> {
  return opened(
    inserted(
      await db
        .insert(reportMatches)
        .values({
          id: input.id,
          environmentId,
          reportId: input.reportId,
          sourceId: input.sourceId,
          entryIndex: input.entryIndex,
          evidenceHash: input.evidenceHash,
          score: input.score,
          snapshotSealed: sealJson(SEALED_SNAPSHOT, input.id, input.snapshot),
          status: input.status,
          reviewStatus: input.reviewStatus,
          riskLevel: input.riskLevel ?? null,
          notifyOnChange: input.notifyOnChange ?? false,
          presentInLastRun: true,
          firstRunId: input.runId,
          lastRunId: input.runId,
          lapsedFrom: input.lapsedFrom ?? null,
          createdAt: input.at,
          updatedAt: input.at,
        })
        .returning(),
      'insertReportMatch',
    ),
  );
}

export async function updateReportMatch(
  db: Db,
  environmentId: string,
  id: string,
  changes: ReportMatchChanges,
): Promise<void> {
  const set: Partial<typeof reportMatches.$inferInsert> = { updatedAt: changes.at };
  if (changes.status !== undefined) set.status = changes.status;
  if (changes.reviewStatus !== undefined) set.reviewStatus = changes.reviewStatus;
  if (changes.riskLevel !== undefined) set.riskLevel = changes.riskLevel;
  if (changes.notifyOnChange !== undefined) set.notifyOnChange = changes.notifyOnChange;
  if (changes.presentInLastRun !== undefined) set.presentInLastRun = changes.presentInLastRun;
  if (changes.evidenceHash !== undefined) set.evidenceHash = changes.evidenceHash;
  if (changes.score !== undefined) set.score = changes.score;
  if (changes.snapshot !== undefined) {
    set.snapshotSealed = sealJson(SEALED_SNAPSHOT, id, changes.snapshot);
  }
  if (changes.lastRunId !== undefined) set.lastRunId = changes.lastRunId;
  if (changes.reviewedAt !== undefined) set.reviewedAt = changes.reviewedAt;
  if (changes.delistedAt !== undefined) set.delistedAt = changes.delistedAt;
  await db.update(reportMatches).set(set).where(matchIn(environmentId, id));
}

/** C75.3: whether a dismissed match of the entry has this evidence hash (the suppression check). */
export async function dismissedEvidenceExists(
  db: Db,
  environmentId: string,
  input: { reportId: string; entryIndex: string; evidenceHash: string },
): Promise<boolean> {
  const rows = await db
    .select({ id: reportMatches.id })
    .from(reportMatches)
    .where(
      and(
        eq(reportMatches.environmentId, environmentId),
        eq(reportMatches.reportId, input.reportId),
        eq(reportMatches.entryIndex, input.entryIndex),
        eq(reportMatches.evidenceHash, input.evidenceHash),
        eq(reportMatches.status, 'dismissed'),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
