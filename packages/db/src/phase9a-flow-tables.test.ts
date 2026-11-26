/**
 * Workflow 9A Stage 1b, checkpoint (S): what `foundation-9a` builds in the database for the server
 * flow engine (C151.1, C152.8, C150.9, C149.4, C150.7, C174.5):
 *
 * - the inquiry's flow position, first device kind and platform, `flow-outcome` and sealed initial
 *   fields, each vocabulary held by a CHECK;
 * - the step record, the action rows and the signal snapshots, deleted with their inquiry;
 * - a decision record's flow path, present exactly on a `flow-failure`;
 * - the initial fields sealed for the row, listed for the rewrap and re-wrapped by `kek:rewrap`;
 * - the inquiry's redaction nulls the initial fields and deletes the flow records, and the C16
 *   step deletes any a redacted inquiry still holds;
 *
 * Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { ENCRYPTED_COLUMNS, SEALED } from './encrypted-columns.js';
import {
  createInquiry,
  deleteFlowRecordsOfRedactedInquiries,
  getInquiry,
  getInquiryInitialFields,
  redactInquiryRecords,
} from './repositories/index.js';
import { REWRAP_TABLES, rewrapAll } from './repositories/key-rotation.js';
import { openJson, type Sealed } from './sealed.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from './testing.js';

const oldKek = randomBytes(32);
const newKek = randomBytes(32);
const oldKeyring = createKeyring(oldKek);
let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase({ keyring: oldKeyring });
}, 120_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await database.close();
});

const query = <Row extends object>(text: string, params: unknown[] = []) =>
  database.client.query<Row>(text, params);

async function seededInquiry() {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  return { environmentId: environment.id, inquiryId: inquiry.id, accountId: inquiry.accountId };
}

const refused = async (text: string, params: unknown[]) =>
  query(text, params).then(
    () => 'accepted',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

const insertStep = (
  environmentId: string,
  inquiryId: string,
  seq: number,
  more = '',
  values: unknown[] = [],
) =>
  query(
    `insert into inquiry_flow_steps (environment_id, inquiry_id, seq, step_id, step_type, entered_at${more ? `, ${more}` : ''})
     values ($1, $2, $3, 'id_card', 'government_id', now()${values.map((_, i) => `, $${String(i + 4)}`).join('')})`,
    [environmentId, inquiryId, seq, ...values],
  );

describe('the inquiry flow position (C151.1, C151.13)', () => {
  it('starts with no position, no first device and no outcome', async () => {
    const { environmentId, inquiryId } = await seededInquiry();
    const [row] = (
      await query<Record<string, unknown>>(
        `select flow_step_id, flow_state, flow_previous_step_id, flow_spec_version, first_device_kind,
           first_platform, flow_outcome, initial_fields from inquiries where environment_id = $1 and id = $2`,
        [environmentId, inquiryId],
      )
    ).rows;
    expect(row).toEqual({
      flow_step_id: null,
      flow_state: null,
      flow_previous_step_id: null,
      flow_spec_version: null,
      first_device_kind: null,
      first_platform: null,
      flow_outcome: null,
      initial_fields: null,
    });
  });

  it('holds a position, a device kind, a platform and an outcome in their vocabularies', async () => {
    const { environmentId, inquiryId } = await seededInquiry();
    await query(
      `update inquiries set flow_step_id = 'consent', flow_state = 'waiting', flow_previous_step_id = 'intro',
         flow_spec_version = 2, first_device_kind = 'mobile-web', first_platform = 'android',
         flow_outcome = '{"verificationTypesOnPath": ["government_id"], "fallbacksTaken": [], "flags": []}'::jsonb
       where environment_id = $1 and id = $2`,
      [environmentId, inquiryId],
    );
    const inquiry = await getInquiry(database.db, environmentId, inquiryId);
    expect(inquiry).toMatchObject({
      flowStepId: 'consent',
      flowState: 'waiting',
      flowPreviousStepId: 'intro',
      flowSpecVersion: 2,
      firstDeviceKind: 'mobile-web',
      firstPlatform: 'android',
      flowOutcome: { verificationTypesOnPath: ['government_id'], fallbacksTaken: [], flags: [] },
    });
    expect(inquiry).not.toHaveProperty('initialFieldsSealed');
    for (const [column, value, constraint] of [
      ['flow_state', 'paused', 'inquiries_flow_state_valid'],
      ['flow_spec_version', 3, 'inquiries_flow_spec_version_valid'],
      ['flow_step_id', 'Not An Id', 'inquiries_flow_step_id_format'],
      ['flow_previous_step_id', '9lives', 'inquiries_flow_step_id_format'],
      ['first_device_kind', 'tv', 'inquiries_first_device_kind_valid'],
      ['first_platform', 'ios', 'inquiries_first_platform_valid'],
    ] as const) {
      expect(
        await refused(`update inquiries set ${column} = $3 where environment_id = $1 and id = $2`, [
          environmentId,
          inquiryId,
          value,
        ]),
        column,
      ).toContain(constraint);
    }
  });
});

describe('the initial fields (C149.4, C174.5)', () => {
  it('seals the fields given at creation for the row, and reads them back', async () => {
    const { environment } = await createTestTenant(database.db);
    const { inquiry: first } = await createTestInquiry(database.db, environment.id);
    const id = testId('inq');
    const fields = { 'name-first': 'Alexis', birthdate: '1990-05-04' };
    const created = await createInquiry(database.db, environment.id, {
      id,
      inquiryTemplateId: first.inquiryTemplateId,
      inquiryTemplateVersionId: first.inquiryTemplateVersionId,
      accountId: first.accountId,
      fields,
      initialFields: fields,
    });
    expect(created).not.toHaveProperty('initialFieldsSealed');
    expect(await getInquiryInitialFields(database.db, environment.id, id)).toEqual(fields);
    const [row] = (
      await query<{ initial_fields: string }>(
        'select initial_fields from inquiries where id = $1',
        [id],
      )
    ).rows;
    expect(row?.initial_fields).not.toContain('Alexis');
    // Bound to its row: another inquiry's id does not open it.
    expect(() =>
      openJson(SEALED.inquiryInitialFields, first.id, row?.initial_fields as Sealed),
    ).toThrow();
    // Created without fields, or in another environment: none.
    expect(await getInquiryInitialFields(database.db, environment.id, first.id)).toBeNull();
    const other = await createTestTenant(database.db);
    expect(await getInquiryInitialFields(database.db, other.environment.id, id)).toBeNull();
  });

  it('lists the column for the rewrap, and kek:rewrap re-wraps it', async () => {
    expect(ENCRYPTED_COLUMNS).toContainEqual({
      table: 'inquiries',
      column: 'initial_fields',
      aad: 'row',
    });
    expect(SEALED.inquiryInitialFields).toBe('inquiries.initial_fields');
    expect(REWRAP_TABLES).toContain('inquiries');
    const { environment } = await createTestTenant(database.db);
    const { inquiry: first } = await createTestInquiry(database.db, environment.id);
    const id = testId('inq');
    await createInquiry(database.db, environment.id, {
      id,
      inquiryTemplateId: first.inquiryTemplateId,
      inquiryTemplateVersionId: first.inquiryTemplateVersionId,
      accountId: first.accountId,
      initialFields: { 'name-last': 'Example' },
    });
    const before = (
      await query<{ v: string }>('select initial_fields as v from inquiries where id = $1', [id])
    ).rows[0]?.v;
    const newKeyring = createKeyring(newKek, [oldKek]);
    await rewrapAll(database.db, { keyring: newKeyring });
    const after = (
      await query<{ v: string }>('select initial_fields as v from inquiries where id = $1', [id])
    ).rows[0]?.v;
    expect(after).not.toBe(before);
    setDefaultKeyring(createKeyring(newKek));
    try {
      expect(await getInquiryInitialFields(database.db, environment.id, id)).toEqual({
        'name-last': 'Example',
      });
    } finally {
      setDefaultKeyring(newKeyring);
    }
  });
});

describe('the step record, action rows and signal snapshots (C151.1, C152.8, C150.9)', () => {
  it('keeps codes in their forms, and an exit, an error and a finish coherent', async () => {
    const { environmentId, inquiryId } = await seededInquiry();
    await insertStep(environmentId, inquiryId, 1);
    await insertStep(
      environmentId,
      inquiryId,
      2,
      'exited_at, exit_port, outcome, waited_ms, sensitive, notes',
      [new Date(), 'route:minor', 'passed', 1200, true, ['waited_for_facts']],
    );
    expect(
      await refused(`update inquiry_flow_steps set seq = 0 where inquiry_id = $1 and seq = 1`, [
        inquiryId,
      ]),
    ).toContain('inquiry_flow_steps_seq_positive');
    expect(
      await refused(
        `update inquiry_flow_steps set exit_port = 'next' where inquiry_id = $1 and seq = 1`,
        [inquiryId],
      ),
    ).toContain('inquiry_flow_steps_exit_coherent');
    expect(
      await refused(
        `update inquiry_flow_steps set step_id = 'Bad Id' where inquiry_id = $1 and seq = 1`,
        [inquiryId],
      ),
    ).toContain('inquiry_flow_steps_step_id_format');
    expect(
      await refused(
        `update inquiry_flow_steps set outcome = 'Has A Value' where inquiry_id = $1 and seq = 2`,
        [inquiryId],
      ),
    ).toContain('inquiry_flow_steps_codes_format');

    const action = `insert into inquiry_flow_actions (environment_id, inquiry_id, step_id, entry, status, error_type,
      finished_at, workflow_run_id, target_account_id, copied_keys, entered_at)
      values ($1, $2, 'run_check', $3, $4, $5, $6, $7, $8, $9, now())`;
    const runId = testId('wfr');
    const accountId = testId('acc');
    expect(
      await refused(action, [environmentId, inquiryId, 1, 'running', null, null, runId, null, []]),
    ).toBe('accepted');
    expect(
      await refused(action, [
        environmentId,
        inquiryId,
        2,
        'completed',
        null,
        new Date(),
        null,
        accountId,
        ['phone'],
      ]),
    ).toBe('accepted');
    expect(
      await refused(action, [
        environmentId,
        inquiryId,
        3,
        'errored',
        null,
        new Date(),
        null,
        null,
        [],
      ]),
    ).toContain('inquiry_flow_actions_error_coherent');
    expect(
      await refused(action, [
        environmentId,
        inquiryId,
        4,
        'running',
        null,
        new Date(),
        null,
        null,
        [],
      ]),
    ).toContain('inquiry_flow_actions_finished_coherent');
    expect(
      await refused(action, [
        environmentId,
        inquiryId,
        5,
        'paused',
        null,
        new Date(),
        null,
        null,
        [],
      ]),
    ).toContain('inquiry_flow_actions_status_valid');
    expect(
      await refused(action, [
        environmentId,
        inquiryId,
        6,
        'running',
        null,
        null,
        'wfl_1',
        null,
        [],
      ]),
    ).toContain('inquiry_flow_actions_ids_format');

    const snapshot = `insert into inquiry_flow_signal_snapshots (environment_id, inquiry_id, step_record_seq, name, value,
      tier, stage, null_reason, computed_at) values ($1, $2, $3, $4, $5, 'H', 'beta', $6, now())`;
    expect(
      await refused(snapshot, [environmentId, inquiryId, 1, 'inquiry/vpn_detected', 'true', null]),
    ).toBe('accepted');
    expect(
      await refused(snapshot, [
        environmentId,
        inquiryId,
        1,
        'inquiry/bot_score',
        null,
        'not_yet_collected',
      ]),
    ).toBe('accepted');
    expect(
      await refused(snapshot, [
        environmentId,
        inquiryId,
        1,
        'inquiry/tor_detected',
        'false',
        'not_yet_collected',
      ]),
    ).toContain('inquiry_flow_signal_snapshots_null_coherent');
    // A snapshot belongs to a step record entry.
    expect(
      await refused(snapshot, [environmentId, inquiryId, 9, 'inquiry/vpn_detected', 'true', null]),
    ).toContain('inquiry_flow_signal_snapshots_step_fk');
  });

  it('belongs to its inquiry: another environment cannot hold a row of it', async () => {
    const { inquiryId } = await seededInquiry();
    const other = await createTestTenant(database.db);
    expect(
      await refused(
        `insert into inquiry_flow_steps (environment_id, inquiry_id, seq, step_id, step_type, entered_at)
       values ($1, $2, 1, 'consent', 'consent', now())`,
        [other.environment.id, inquiryId],
      ),
    ).toContain('inquiry_flow_steps_inquiry_fk');
  });
});

describe('a decision record of a flow failure (C150.7)', () => {
  const decision = `insert into inquiry_decisions (id, environment_id, kind, subject_type, subject_id, actor_type,
    actor_id, flow) values ($1, $2, $3, 'inquiry', $4, $5, $6, $7)`;

  it('carries its flow path, and only a flow failure does', async () => {
    const { environmentId, inquiryId } = await seededInquiry();
    const path = JSON.stringify({
      templateVersionId: testId('itmplv'),
      failureStepId: 'minor_failure',
      routes: [{ stepId: 'age_route', port: 'route:minor', onNull: null }],
    });
    expect(
      await refused(decision, [
        testId('idec'),
        environmentId,
        'flow-failure',
        inquiryId,
        'inquiry-flow',
        inquiryId,
        path,
      ]),
    ).toBe('accepted');
    expect(
      await refused(decision, [
        testId('idec'),
        environmentId,
        'flow-failure',
        inquiryId,
        'inquiry-flow',
        inquiryId,
        null,
      ]),
    ).toContain('inquiry_decisions_flow_coherent');
    expect(
      await refused(decision, [
        testId('idec'),
        environmentId,
        'review',
        inquiryId,
        'api-key',
        testId('key'),
        path,
      ]),
    ).toContain('inquiry_decisions_flow_coherent');
  });
});

describe('redaction and retention (C174.3, C174.5)', () => {
  it("nulls the initial fields and deletes the inquiry's flow records, and only its own", async () => {
    const { environment } = await createTestTenant(database.db);
    const { inquiry: kept } = await createTestInquiry(database.db, environment.id);
    const id = testId('inq');
    await createInquiry(database.db, environment.id, {
      id,
      inquiryTemplateId: kept.inquiryTemplateId,
      inquiryTemplateVersionId: kept.inquiryTemplateVersionId,
      accountId: kept.accountId,
      initialFields: { 'name-first': 'Robin' },
    });
    for (const inquiryId of [id, kept.id]) {
      await insertStep(environment.id, inquiryId, 1);
      await query(
        `insert into inquiry_flow_actions (environment_id, inquiry_id, step_id, entry, status, entered_at)
         values ($1, $2, 'run_check', 1, 'running', now())`,
        [environment.id, inquiryId],
      );
      await query(
        `insert into inquiry_flow_signal_snapshots (environment_id, inquiry_id, step_record_seq, name, value, tier,
           stage, computed_at) values ($1, $2, 1, 'inquiry/vpn_detected', 'false', 'H', 'beta', now())`,
        [environment.id, inquiryId],
      );
    }
    const counts = async (inquiryId: string) =>
      (
        await query<{ steps: number; actions: number; snapshots: number }>(
          `select (select count(*)::int from inquiry_flow_steps where inquiry_id = $1) as steps,
             (select count(*)::int from inquiry_flow_actions where inquiry_id = $1) as actions,
             (select count(*)::int from inquiry_flow_signal_snapshots where inquiry_id = $1) as snapshots`,
          [inquiryId],
        )
      ).rows[0];
    await redactInquiryRecords(database.db, environment.id, id);
    expect(await getInquiryInitialFields(database.db, environment.id, id)).toBeNull();
    expect(await counts(id)).toEqual({ steps: 0, actions: 0, snapshots: 0 });
    expect(await counts(kept.id)).toEqual({ steps: 1, actions: 1, snapshots: 1 });

    // The C16 step: a row a race left on a redacted inquiry goes; an unredacted inquiry's stays.
    await insertStep(environment.id, id, 7);
    expect(
      await deleteFlowRecordsOfRedactedInquiries(database.db, { limit: 100 }),
    ).toBeGreaterThanOrEqual(1);
    expect(await counts(id)).toEqual({ steps: 0, actions: 0, snapshots: 0 });
    expect(await counts(kept.id)).toEqual({ steps: 1, actions: 1, snapshots: 1 });
    expect(await deleteFlowRecordsOfRedactedInquiries(database.db, { limit: 100 })).toBe(0);
  });
});
