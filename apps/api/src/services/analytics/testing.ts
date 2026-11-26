/**
 * Test support (Workflow 9B, `api-analytics`): a synthetic analytics population written to a test
 * database (PGlite or a Testcontainers Postgres): inquiries at chosen instants and statuses, their
 * step records, verification attempts with capture methods, check results, signals, list screenings,
 * decisions and cases. Every id is generated, every value synthetic (rule 9). Not imported by any
 * production module.
 */
import {
  analyticsRollupTables,
  createInquiry,
  createUser,
  type Db,
  type InquiryTemplateWithVersion,
} from '@openverify/db';
import {
  createTestInquiry,
  createTestTenant,
  seedCase,
  seedCaseTemplate,
  seedInquiryDecision,
  testId,
} from '@openverify/db/testing';
import { eq, sql } from 'drizzle-orm';
import { ensureDefaultAccountType } from '../accounts.js';

/** A wrapped key in the column's form, never unwrapped: the rollups never read a file's bytes. */
const SYNTHETIC_WRAPPED_DEK = `ov1.synthetic00.${'A'.repeat(80)}`;

export interface AnalyticsTenant {
  organizationId: string;
  environmentId: string;
  template: InquiryTemplateWithVersion;
  templateId: string;
  versionId: string;
}

/** A tenant with a template whose version every seeded inquiry pins. */
export async function seedAnalyticsTenant(db: Db): Promise<AnalyticsTenant> {
  const { organization, environment } = await createTestTenant(db);
  await ensureDefaultAccountType(db, environment.id);
  const { template, inquiry } = await createTestInquiry(db, environment.id);
  await db.execute(sql`delete from inquiries where id = ${inquiry.id}`);
  return {
    organizationId: organization.id,
    environmentId: environment.id,
    template,
    templateId: template.id,
    versionId: template.latestVersion.id,
  };
}

/**
 * Every count a reader adds (both sources) for one environment, by table and column, histograms by
 * bucket; zeros left out.
 */
export async function rollupTotals(db: Db, environmentId: string): Promise<Record<string, number>> {
  const totals: Record<string, number> = {};
  for (const [name, table] of Object.entries(analyticsRollupTables)) {
    const rows = (await db
      .select()
      .from(table)
      .where(eq(table.environmentId, environmentId))) as Record<string, unknown>[];
    for (const row of rows) {
      for (const [column, value] of Object.entries(row)) {
        if (typeof value === 'number') {
          totals[`${name}.${column}`] = (totals[`${name}.${column}`] ?? 0) + value;
        } else if (column.endsWith('Histogram') && Array.isArray(value)) {
          (value as number[]).forEach((count, index) => {
            const key = `${name}.${column}.${String(index)}`;
            totals[key] = (totals[key] ?? 0) + count;
          });
        }
      }
    }
  }
  return Object.fromEntries(Object.entries(totals).filter(([, value]) => value !== 0));
}

/** A template in an environment that already exists (an API harness's tenant). */
export async function analyticsTenantOf(
  db: Db,
  tenant: { organizationId: string; environmentId: string },
): Promise<AnalyticsTenant> {
  await ensureDefaultAccountType(db, tenant.environmentId);
  const { template, inquiry } = await createTestInquiry(db, tenant.environmentId);
  await db.execute(sql`delete from inquiries where id = ${inquiry.id}`);
  return {
    organizationId: tenant.organizationId,
    environmentId: tenant.environmentId,
    template,
    templateId: template.id,
    versionId: template.latestVersion.id,
  };
}

/** Sets the environment's analytics settings (merged into its settings). */
export async function setAnalyticsSettings(
  db: Db,
  environmentId: string,
  settings: Readonly<Record<string, unknown>>,
): Promise<void> {
  await db.execute(
    sql`update environments set settings = settings || ${JSON.stringify(settings)}::jsonb
      where id = ${environmentId}`,
  );
}

export interface SeededInquiry {
  createdAt: Date;
  status?:
    | 'created'
    | 'pending'
    | 'completed'
    | 'failed'
    | 'expired'
    | 'approved'
    | 'declined'
    | 'needs_review';
  /** Set by default for every status but `created` and an `expired` before start. */
  started?: boolean;
  /** The flow reached completed (`completed`) or failed (`failed`); seconds after creation. */
  finished?: { as: 'completed' | 'failed'; afterSeconds: number };
  platform?: 'web' | 'android' | null;
  deviceKind?: 'desktop-web' | 'mobile-web' | 'native' | null;
  tags?: readonly string[];
  flowOutcome?: { verificationTypesOnPath: string[]; fallbacksTaken: string[]; flags: string[] };
  signals?: readonly { name: string; value: unknown }[];
  /** `updated_at`; defaults to `createdAt`. */
  updatedAt?: Date;
  templateId?: string;
  versionId?: string;
}

/** An inquiry of the tenant's template, its timestamps and status set by SQL. */
export async function seedAnalyticsInquiry(
  db: Db,
  tenant: AnalyticsTenant,
  input: SeededInquiry,
): Promise<string> {
  const id = testId('inq');
  await createInquiry(db, tenant.environmentId, {
    id,
    inquiryTemplateId: input.templateId ?? tenant.templateId,
    inquiryTemplateVersionId: input.versionId ?? tenant.versionId,
    referenceId: null,
    fields: {},
    tags: [...(input.tags ?? [])],
  });
  const status = input.status ?? 'created';
  const started =
    input.started ??
    !(status === 'created' || (status === 'expired' && input.finished === undefined));
  const at = (seconds: number) =>
    new Date(input.createdAt.getTime() + seconds * 1000).toISOString();
  const finishedAt = input.finished === undefined ? null : at(input.finished.afterSeconds);
  await db.execute(sql`update inquiries set
      created_at = ${input.createdAt.toISOString()}::timestamptz,
      updated_at = ${(input.updatedAt ?? input.createdAt).toISOString()}::timestamptz,
      status = ${status},
      started_at = ${started ? at(1) : null}::timestamptz,
      completed_at = ${input.finished?.as === 'completed' ? finishedAt : null}::timestamptz,
      failed_at = ${input.finished?.as === 'failed' ? finishedAt : null}::timestamptz,
      first_platform = ${input.platform ?? null},
      first_device_kind = ${input.deviceKind ?? null},
      flow_outcome = ${input.flowOutcome === undefined ? null : JSON.stringify(input.flowOutcome)}::jsonb,
      signals = ${input.signals === undefined ? null : JSON.stringify(input.signals)}::jsonb
    where id = ${id}`);
  return id;
}

/** The inquiry's step record: each entry in order, exited unless it is the last and `open`. */
export async function seedAnalyticsSteps(
  db: Db,
  tenant: AnalyticsTenant,
  inquiryId: string,
  steps: readonly { stepId: string; type: string; exited?: boolean }[],
  /** When the first step was entered (each later one a second after); the database's now by default. */
  enteredAt?: Date,
): Promise<void> {
  let seq = 0;
  for (const step of steps) {
    const entered = new Date((enteredAt ?? new Date()).getTime() + seq * 1000).toISOString();
    seq += 1;
    const exited = step.exited ?? true;
    await db.execute(sql`insert into inquiry_flow_steps (environment_id, inquiry_id, seq, step_id,
        step_type, entered_at, exited_at, exit_port)
      values (${tenant.environmentId}, ${inquiryId}, ${seq}, ${step.stepId}, ${step.type},
        ${entered}::timestamptz, ${exited ? entered : null}::timestamptz, ${exited ? 'next' : null})`);
  }
}

/** A verification attempt of the inquiry, with an uploaded file reporting its capture method. */
export async function seedAnalyticsVerification(
  db: Db,
  tenant: AnalyticsTenant,
  inquiryId: string,
  input: {
    type: string;
    status: string;
    country?: string | null;
    captureMethod?: 'upload' | 'camera' | null;
    createdAt?: Date;
    updatedAt?: Date;
    checks?: readonly {
      name: string;
      status: 'passed' | 'failed' | 'not_applicable' | 'pending';
      requirement?: 'required' | 'not_required';
      reasons?: readonly string[];
    }[];
  },
): Promise<string> {
  const id = testId('ver');
  const createdAt = (input.createdAt ?? new Date()).toISOString();
  await db.execute(sql`insert into verifications (id, environment_id, inquiry_id, type, status,
      country, created_at, updated_at)
    values (${id}, ${tenant.environmentId}, ${inquiryId}, ${input.type}, ${input.status},
      ${input.country ?? null}, ${createdAt}::timestamptz,
      ${(input.updatedAt ?? input.createdAt ?? new Date()).toISOString()}::timestamptz)`);
  if (input.captureMethod !== undefined) {
    await db.execute(sql`insert into files (id, environment_id, verification_id, kind, storage_key,
        mime_type, byte_size, sha256, wrapped_dek, capture_method)
      values (${testId('file')}, ${tenant.environmentId}, ${id}, 'front', ${`synthetic/${id}`},
        'image/jpeg', 3, ${'0'.repeat(64)}, ${SYNTHETIC_WRAPPED_DEK}, ${input.captureMethod})`);
  }
  for (const check of input.checks ?? []) {
    await db.execute(sql`insert into verification_checks (environment_id, verification_id, name,
        status, type, requirement, reasons)
      values (${tenant.environmentId}, ${id}, ${check.name}, ${check.status}, 'fraud',
        ${check.requirement ?? 'required'},
        ${`{${(check.reasons ?? []).join(',')}}`}::text[])`);
  }
  return id;
}

/** The inquiry's list screening (a completed one carries its open matches). */
export async function seedAnalyticsScreening(
  db: Db,
  tenant: AnalyticsTenant,
  inquiryId: string,
  input: { status: 'pending' | 'completed' | 'errored'; matchCount?: number },
): Promise<void> {
  await db.execute(sql`insert into list_screenings (environment_id, inquiry_id, trigger_status,
      status, match_count, screened_at)
    values (${tenant.environmentId}, ${inquiryId}, 'completed', ${input.status},
      ${input.matchCount ?? null}, ${input.status === 'pending' ? null : new Date().toISOString()}::timestamptz)`);
}

/** A decision record on the inquiry. */
export async function seedAnalyticsDecision(
  db: Db,
  tenant: AnalyticsTenant,
  inquiryId: string,
  input: {
    kind: 'approve' | 'decline' | 'review';
    actorType?: 'user' | 'api-key' | 'workflow-run';
    solelyAutomated?: boolean | null;
  },
): Promise<void> {
  const { id } = await seedInquiryDecision(db, tenant.environmentId, {
    kind: input.kind,
    subjectId: inquiryId,
  });
  const actorType = input.actorType ?? 'user';
  const actorPrefix = { user: 'usr', 'api-key': 'key', 'workflow-run': 'wfr' } as const;
  await db.execute(sql`update inquiry_decisions set actor_type = ${actorType},
      actor_id = ${testId(actorPrefix[actorType])},
      solely_automated = ${input.solelyAutomated ?? null}
    where id = ${id}`);
}

/** An operator of the tenant's organisation. */
export async function seedAnalyticsUser(db: Db, tenant: AnalyticsTenant): Promise<string> {
  const id = testId('usr');
  await createUser(db, {
    id,
    organizationId: tenant.organizationId,
    email: `${id.toLowerCase()}@example.com`,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c3ludGhldGlj$c3ludGhldGljLWhhc2g',
  });
  return id;
}

export interface AnalyticsCaseTemplate {
  id: string;
  versionId: string;
  key: string;
  next: number;
}

export async function seedAnalyticsCaseTemplate(
  db: Db,
  tenant: AnalyticsTenant,
): Promise<AnalyticsCaseTemplate> {
  const template = await seedCaseTemplate(db, tenant.environmentId);
  return { ...template, next: 1 };
}

/** A case created at `createdAt`, resolved after `resolvedAfterSeconds` when given. */
export async function seedAnalyticsCase(
  db: Db,
  tenant: AnalyticsTenant,
  template: AnalyticsCaseTemplate,
  input: {
    createdAt: Date;
    resolvedAfterSeconds?: number;
    slaMet?: boolean;
    slaMissed?: boolean;
    assigneeId?: string | null;
  },
): Promise<string> {
  const number = template.next;
  template.next += 1;
  const { id } = await seedCase(db, tenant.environmentId, {
    caseTemplateId: template.id,
    caseTemplateVersionId: template.versionId,
    key: template.key,
    number,
    assigneeId: input.assigneeId ?? null,
  });
  const resolvedAt =
    input.resolvedAfterSeconds === undefined
      ? null
      : new Date(input.createdAt.getTime() + input.resolvedAfterSeconds * 1000).toISOString();
  await db.execute(sql`update cases set
      created_at = ${input.createdAt.toISOString()}::timestamptz,
      updated_at = ${input.createdAt.toISOString()}::timestamptz,
      resolved_at = ${resolvedAt}::timestamptz,
      status = ${resolvedAt === null ? 'open' : 'approved'},
      status_category = ${resolvedAt === null ? 'initial' : 'end'},
      resolver_type = ${resolvedAt === null ? null : 'user'},
      resolver_id = ${resolvedAt === null ? null : testId('usr')},
      sla_met_at = ${input.slaMet === true ? resolvedAt : null}::timestamptz,
      sla_expired_at = ${input.slaMissed === true ? input.createdAt.toISOString() : null}::timestamptz
    where id = ${id}`);
  return id;
}
