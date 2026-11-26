/**
 * C84.1 (F07): the `report-config` publish rule of an inquiry template version, which
 * `assertPublishable` (`services/inquiry-templates.ts`) runs when a template is created and when a
 * version is published: each `on-completion` entry names a report template of the environment
 * that is active and has a published version, and a template at most once (the schema refuses a
 * repeat). Each broken entry is a 422 `report_template_not_published` at
 * `reportConfigEntryPointer(i)`.
 *
 * Owner: `api-reports` (Workflow 6A Stage 3); the signature is frozen by `foundation-6`
 * (Stage 1b). A report template archived after the inquiry template was published still runs
 * (C71.1, C84.1): the rule applies when publishing only.
 */
import { reportConfigEntryPointer, type ReportConfig } from '@openverify/contracts';
import {
  getPublishedReportTemplateVersion,
  getReportTemplate,
  type Db,
} from '@openverify/db';
import type { EnvironmentKind } from '../../ports.js';

export interface ReportConfigPublishContext {
  /** The request's database, or the transaction that publishes. */
  db: Db;
  environment: { id: string; kind: EnvironmentKind };
  reportConfig: ReportConfig;
}

/** One refused entry: a JSON Pointer into the request (`/data/attributes/report-config/...`). */
export interface ReportConfigProblem {
  code: 'report_template_not_published';
  pointer: string;
  detail: string;
}

export type ReportConfigPublishProblems = (
  ctx: ReportConfigPublishContext,
) => Promise<ReportConfigProblem[]>;

/** Why an entry is refused, or `null` when its template may run. */
async function refusal(db: Db, environmentId: string, templateId: string): Promise<string | null> {
  // The published version first: a template is read with it, and an unknown id has none.
  const published = await getPublishedReportTemplateVersion(db, environmentId, templateId);
  if (published === null) {
    return 'names no report template of this environment with a published version';
  }
  const template = await getReportTemplate(db, environmentId, templateId);
  return template?.status === 'active' ? null : 'names an archived report template';
}

export const reportConfigPublishProblems: ReportConfigPublishProblems = async (ctx) => {
  const problems: ReportConfigProblem[] = [];
  const entries = ctx.reportConfig['on-completion'] ?? [];
  for (const [index, entry] of entries.entries()) {
    const detail = await refusal(ctx.db, ctx.environment.id, entry['report-template-id']);
    if (detail !== null) {
      problems.push({
        code: 'report_template_not_published',
        pointer: reportConfigEntryPointer(index),
        detail,
      });
    }
  }
  return problems;
};
