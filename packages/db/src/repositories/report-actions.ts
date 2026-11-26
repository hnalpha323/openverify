/**
 * C74.2: report history actions, append-only (C73.2): inserts and reads. Their details (reason,
 * comment, the affected match ids) are sealed to the row; the redaction that nulls them is
 * `redactReportRecords` (`reports.ts`), under `openverify.report_redaction`.
 *
 * Owner: `api-reports` (Workflow 6A Stage 3), who adds every function this file needs. The file
 * and its export line in `repositories/index.ts` are frozen by `foundation-6` (Stage 1b).
 */
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { reportActions, type ReportActionRow } from '../schema.js';
import { openOptionalJson, sealOptionalJson } from '../sealed.js';
import { inserted } from './rows.js';

/** The owner of this repository file. */
export const REPORT_ACTIONS_REPOSITORY_OWNER = 'api-reports';

export type ReportActionTypeValue = ReportActionRow['actionType'];
export type ReportActorTypeValue = ReportActionRow['actorType'];

/** What an action records, sealed (C73.2). */
export interface ReportActionDetails {
  reason?: string | null;
  comment?: string | null;
  matchIds?: readonly string[];
  reviewStatus?: string | null;
  riskLevel?: string | null;
}

/** An action with its details opened (`null` once redacted). */
export type StoredReportAction = Omit<ReportActionRow, 'detailsSealed'> & {
  details: ReportActionDetails | null;
};

export interface NewReportActionInput {
  id: string;
  reportId: string;
  actionType: ReportActionTypeValue;
  actorType: ReportActorTypeValue;
  /** A `usr_` or `key_` id; `null` for `system`. */
  actorId: string | null;
  /** `null` for an action that records nothing more, such as a `redact` (owner decision 12). */
  details: ReportActionDetails | null;
  createdAt: Date;
}

const SEALED_DETAILS = 'report_actions.details';

function opened(row: ReportActionRow): StoredReportAction {
  const { detailsSealed, ...rest } = row;
  const details = openOptionalJson(SEALED_DETAILS, row.id, detailsSealed);
  return {
    ...rest,
    details: details !== null && typeof details === 'object' ? details : null,
  };
}

export async function insertReportAction(
  db: Db,
  environmentId: string,
  input: NewReportActionInput,
): Promise<StoredReportAction> {
  return opened(
    inserted(
      await db
        .insert(reportActions)
        .values({
          id: input.id,
          environmentId,
          reportId: input.reportId,
          actionType: input.actionType,
          actorType: input.actorType,
          actorId: input.actorId,
          detailsSealed: sealOptionalJson(SEALED_DETAILS, input.id, input.details),
          createdAt: input.createdAt,
        })
        .returning(),
      'insertReportAction',
    ),
  );
}

/** The report's actions, newest first, details opened. */
export async function listReportActions(
  db: Db,
  environmentId: string,
  reportId: string,
): Promise<StoredReportAction[]> {
  const rows = await db
    .select()
    .from(reportActions)
    .where(
      and(eq(reportActions.environmentId, environmentId), eq(reportActions.reportId, reportId)),
    )
    .orderBy(desc(reportActions.createdAt), desc(reportActions.id));
  return rows.map(opened);
}
