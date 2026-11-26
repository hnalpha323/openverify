/**
 * Workflow 9B Stage 1b, checkpoint (F): what `foundation-9b` builds in the database for the 9A items
 * S4-12 carried (the orchestrator's decisions before 9B, 2; contracts B44, B45), columns only:
 *
 * - `inquiries.expiration_after_start_seconds`, `expiration_after_resume_seconds` and
 *   `one_time_link_expiration_seconds` (`INQUIRY_EXPIRY_OVERRIDE_COLUMNS`): an inquiry's own windows
 *   from `POST /inquiries`' `meta`, each `null` (the version decides) or within C11's bounds
 *   (300 to 2,592,000 seconds), written by `createInquiry` (`api-flow-expiry` applies them);
 * - `inquiry_template_versions.flow_run_grants` (`FLOW_RUN_GRANTS_COLUMN`): each `run_workflow`
 *   step's target grant and egress as the publish saw them (`FlowRunGrantRecord[]`), `[]` by
 *   default, an array only, stored at publish and carried by the version members (a copy), and
 *   served on the version row as `flowRunGrants`, the member `run-workflow.ts`' `recordedGrantOf`
 *   reads.
 *
 * Every value is synthetic.
 */
import {
  FLOW_RUN_GRANTS_COLUMN,
  INQUIRY_EXPIRY_OVERRIDE_COLUMNS,
  type FlowRunGrantRecord,
} from '@openverify/core';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import {
  createDraftInquiryTemplateVersion,
  createInquiry,
  createInquiryTemplate,
  getInquiryTemplateVersion,
  publishInquiryTemplateVersion,
} from './repositories/index.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from './testing.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase({ keyring: createKeyring(randomBytes(32)) });
}, 120_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await database.close();
});

const query = <Row extends object>(text: string, params: unknown[] = []) =>
  database.client.query<Row>(text, params);

/** The error's message, or `accepted`. */
const refused = async (text: string, params: unknown[] = []) =>
  query(text, params).then(
    () => 'accepted',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

const WINDOW_COLUMNS = Object.values(INQUIRY_EXPIRY_OVERRIDE_COLUMNS);

async function windowsOf(inquiryId: string) {
  const { rows } = await query<Record<string, number | null>>(
    `select ${WINDOW_COLUMNS.join(', ')} from inquiries where id = $1`,
    [inquiryId],
  );
  return rows[0];
}

const GRANT: FlowRunGrantRecord = {
  stepId: 'run_check',
  workflowId: 'wfl_01M5CK16P0D13FXHZSS4TCFBVH',
  workflowVersionId: 'wflv_01M5CK16P0D13FXHZSS4TCFBVH',
  scopes: ['inquiries:write'],
  pii: false,
  egress: ['send'],
};

describe('inquiries: the per-inquiry expiry windows (C151.10; contracts B44)', () => {
  it('names the three columns the contract placed', () => {
    expect(WINDOW_COLUMNS).toEqual([
      'expiration_after_start_seconds',
      'expiration_after_resume_seconds',
      'one_time_link_expiration_seconds',
    ]);
  });

  it('holds none by default, so the version decides', async () => {
    const { environment } = await createTestTenant(database.db);
    const { inquiry } = await createTestInquiry(database.db, environment.id);

    expect(await windowsOf(inquiry.id)).toEqual({
      expiration_after_start_seconds: null,
      expiration_after_resume_seconds: null,
      one_time_link_expiration_seconds: null,
    });
  });

  it('stores the windows createInquiry is given, null left as none', async () => {
    const { environment } = await createTestTenant(database.db);
    const { template } = await createTestInquiry(database.db, environment.id);

    const created = await createInquiry(database.db, environment.id, {
      id: testId('inq'),
      inquiryTemplateId: template.id,
      inquiryTemplateVersionId: template.currentVersion.id,
      expirationAfterStartSeconds: 3_600,
      expirationAfterResumeSeconds: 600,
      oneTimeLinkExpirationSeconds: null,
    });

    expect(await windowsOf(created.id)).toEqual({
      expiration_after_start_seconds: 3_600,
      expiration_after_resume_seconds: 600,
      one_time_link_expiration_seconds: null,
    });
    expect(created).toMatchObject({
      expirationAfterStartSeconds: 3_600,
      expirationAfterResumeSeconds: 600,
      oneTimeLinkExpirationSeconds: null,
    });
  });

  it('holds each window within C11’s bounds, 300 to 2,592,000 seconds', async () => {
    const { environment } = await createTestTenant(database.db);
    const { inquiry } = await createTestInquiry(database.db, environment.id);

    for (const column of WINDOW_COLUMNS) {
      for (const seconds of [300, 2_592_000]) {
        expect(
          await refused(`update inquiries set ${column} = $2 where id = $1`, [inquiry.id, seconds]),
          `${column} = ${String(seconds)}`,
        ).toBe('accepted');
      }
      for (const seconds of [0, 299, 2_592_001, -1]) {
        expect(
          await refused(`update inquiries set ${column} = $2 where id = $1`, [inquiry.id, seconds]),
          `${column} = ${String(seconds)}`,
        ).toContain('inquiries_expiry_overrides_range');
      }
      expect(
        await refused(`update inquiries set ${column} = null where id = $1`, [inquiry.id]),
      ).toBe('accepted');
    }
  });
});

describe('inquiry_template_versions.flow_run_grants (C152.2; 9A amendment 31, contracts B45)', () => {
  it('names the column the contract placed', () => {
    expect(FLOW_RUN_GRANTS_COLUMN).toBe('flow_run_grants');
  });

  it('is empty for a version made without one, and served on the row as flowRunGrants', async () => {
    const { environment } = await createTestTenant(database.db);
    const { template } = await createTestInquiry(database.db, environment.id);

    const { rows } = await query<{ flow_run_grants: unknown }>(
      'select flow_run_grants from inquiry_template_versions where id = $1',
      [template.currentVersion.id],
    );
    expect(rows).toEqual([{ flow_run_grants: [] }]);
    const version = await getInquiryTemplateVersion(
      database.db,
      environment.id,
      template.currentVersion.id,
    );
    expect((version as Record<string, unknown> | null)?.flowRunGrants).toEqual([]);
  });

  it('stores the records a publish is given, and keeps a draft’s until then', async () => {
    const { environment } = await createTestTenant(database.db);
    const { template } = await createTestInquiry(database.db, environment.id);
    const draft = await createDraftInquiryTemplateVersion(
      database.db,
      environment.id,
      template.id,
      {
        id: testId('itmplv'),
        flow: {},
        verificationConfig: {},
      },
    );
    if (draft === null) throw new Error('no draft');

    const published = await publishInquiryTemplateVersion(
      database.db,
      environment.id,
      draft.id,
      new Date('2026-11-06T12:00:00Z'),
      { flowRunGrants: [GRANT] },
    );

    expect(published?.status).toBe('published');
    const { rows } = await query<{ flow_run_grants: unknown }>(
      'select flow_run_grants from inquiry_template_versions where id = $1',
      [draft.id],
    );
    expect(rows).toEqual([{ flow_run_grants: [GRANT] }]);
    expect((published?.version as Record<string, unknown> | undefined)?.flowRunGrants).toEqual([
      GRANT,
    ]);
  });

  it('is carried by the version members, as a copy carries its source’s', async () => {
    const { environment } = await createTestTenant(database.db);

    const copied = await createInquiryTemplate(database.db, environment.id, {
      id: testId('itmpl'),
      name: 'Synthetic copy',
      version: {
        id: testId('itmplv'),
        flow: {},
        verificationConfig: {},
        members: { flowRunGrants: [GRANT] },
      },
    });

    const { rows } = await query<{ flow_run_grants: unknown }>(
      'select flow_run_grants from inquiry_template_versions where id = $1',
      [copied.currentVersion.id],
    );
    expect(rows).toEqual([{ flow_run_grants: [GRANT] }]);
  });

  it('holds an array only', async () => {
    const { environment } = await createTestTenant(database.db);
    const { template } = await createTestInquiry(database.db, environment.id);

    for (const value of ['{}', '"grants"', 'null']) {
      expect(
        await refused(
          `update inquiry_template_versions set flow_run_grants = $2::jsonb where id = $1`,
          [template.currentVersion.id, value],
        ),
        value,
      ).toContain('inquiry_template_versions_flow_run_grants_array');
    }
  });
});
