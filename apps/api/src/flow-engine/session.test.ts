/**
 * C151.5-C151.7, V03 (Workflow 9A, api-flow-engine, checkpoint "session"): the session's flow
 * members are read from the server's position. The `flow` member is the v1 projection, and for
 * each of `contracts-9a`'s golden positions the builder serves the golden projection byte for byte,
 * so the Android host test (`FlowCoordinatorProjectionTest`) and the server cannot drift apart.
 * `step` goes only to a client that declared spec 2; `values` holds only the current screen's
 * fields, never a masked or write-once value. Every value is synthetic.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defaultInquiryTemplateAttributes, flowSessionLinksSchema } from '@openverify/contracts';
import {
  appendInquiryFlowStepInTx,
  exitInquiryFlowStepInTx,
  getInquiry,
  listInquirySessions,
  lockInquiry,
  setInquiryFlowPositionInTx,
  type Db,
  type Inquiry,
} from '@openverify/db';
import { createTestInquiry } from '@openverify/db/testing';
import { flowV2Schema, type FlowV2 } from '@openverify/flow-spec';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInquiryTestApi, type InquiryTestApi } from '../services/inquiries.test-support.js';
import { createInquiry, resumeInquiry, seedVerification } from '../test-support/harness.js';
import { positionFlowInTx } from './position.js';
import { stepVerificationType } from './verification-state.js';
import {
  FLOW_WAIT_POLL_MS,
  flowSessionMembers,
  prepareFlowSessionInTx,
  type FlowSessionMembersInput,
} from './session.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const FIXTURES = fileURLToPath(new URL('../../../../contracts/fixtures/', import.meta.url));
const fixture = (path: string): unknown => JSON.parse(readFileSync(FIXTURES + path, 'utf8'));

interface ProjectionCase {
  projection: string;
  flow: string;
  position: {
    current: string;
    exited: { stepId: string; port: string }[];
    verificationStatuses: Record<string, string>;
    consentRecorded: boolean;
    customConsentCopy: boolean;
  };
}

const CASES = (fixture('flows/v2/projection-cases.json') as { cases: ProjectionCase[] }).cases;

async function inquiryOf(inquiryId: string): Promise<Inquiry> {
  const inquiry = await getInquiry(api.database.db, api.environmentId, inquiryId);
  if (inquiry === null) throw new Error('no inquiry');
  return inquiry;
}

/** Writes the stored state of `position` for a new inquiry of `flow`: its record and position. */
async function storedAt(
  flow: FlowV2,
  position: { current: string; exited: { stepId: string; port: string }[] },
  options: { fields?: Record<string, unknown>; state?: 'active' | 'waiting' } = {},
): Promise<string> {
  const { inquiry } = await createTestInquiry(api.database.db, api.environmentId, {
    flow,
    ...(options.fields === undefined ? {} : { fields: options.fields }),
  });
  const typeOf = (stepId: string) =>
    flow.steps.find((step) => step.id === stepId)?.type ?? 'unknown';
  const at = new Date('2026-10-20T12:00:00.000Z');
  await api.database.db.transaction(async (tx) => {
    for (const exited of position.exited) {
      const entry = await appendInquiryFlowStepInTx(tx, api.environmentId, {
        inquiryId: inquiry.id,
        stepId: exited.stepId,
        stepType: typeOf(exited.stepId),
        enteredAt: at,
      });
      await exitInquiryFlowStepInTx(tx, api.environmentId, inquiry.id, entry.seq, {
        exitedAt: at,
        exitPort: exited.port,
        outcome: null,
        sensitive: false,
        notes: [],
      });
    }
    await appendInquiryFlowStepInTx(tx, api.environmentId, {
      inquiryId: inquiry.id,
      stepId: position.current,
      stepType: typeOf(position.current),
      enteredAt: at,
    });
    const terminal = ['completion', 'failure'].includes(typeOf(position.current));
    await setInquiryFlowPositionInTx(tx, api.environmentId, inquiry.id, {
      stepId: position.current,
      state: options.state ?? (terminal ? 'ended' : 'active'),
      previousStepId: position.exited.at(-1)?.stepId ?? null,
      specVersion: 2,
    });
  });
  return inquiry.id;
}

const setVersion = (inquiryId: string, assignment: ReturnType<typeof sql>) =>
  api.database.db.execute(
    sql`update inquiry_template_versions set ${assignment}
         where id = (select inquiry_template_version_id from inquiries where id = ${inquiryId})`,
  );

const members = async (
  inquiryId: string,
  input: Partial<Omit<FlowSessionMembersInput, 'inquiry'>> = {},
) =>
  flowSessionMembers(api.database.db, {
    inquiry: await inquiryOf(inquiryId),
    specVersions: [1],
    consentRecorded: true,
    ...input,
  });

describe('the flow member is the golden v1 projection, byte for byte (C151.6, V03)', () => {
  it.each(CASES.map((entry) => [entry.projection, entry] as const))('%s', async (_, entry) => {
    const flow = flowV2Schema.parse(fixture(entry.flow));
    const inquiryId = await storedAt(flow, entry.position);
    for (const [stepId, status] of Object.entries(entry.position.verificationStatuses)) {
      const step = flow.steps.find((candidate) => candidate.id === stepId);
      const type = step === undefined ? null : stepVerificationType(step);
      if (type !== null) {
        await seedVerification(api, api.environmentId, inquiryId, {
          type,
          status: status as 'passed' | 'failed',
        });
      }
    }
    if (entry.position.customConsentCopy) {
      await setVersion(
        inquiryId,
        sql`copy = ${JSON.stringify({ messages: { en: { 'consent.biometric': 'Our own words.' } } })}::jsonb`,
      );
    }
    const served = await members(inquiryId, {
      consentRecorded: entry.position.consentRecorded,
    });
    expect(JSON.stringify(served?.flow)).toBe(JSON.stringify(fixture(entry.projection)));
  });
});

const consent = { id: 'consent', type: 'consent', textKeys: ['consent.biometric'], required: true };
const edge = (id: string, from: string, port: string, to: string) => ({ id, from, port, to });

/** consent -> about (a screen) -> phone (prefilled from a field) -> done. */
const SCREENS = flowV2Schema.parse({
  metadata: { specVersion: 2, id: 'screens', version: 1, name: 'Screens' },
  entry: 'consent',
  steps: [
    consent,
    {
      id: 'about',
      type: 'screen',
      name: 'About you, internal name',
      components: [
        { id: 'heading', kind: 'text', variant: 'title', copyKey: 'about.heading' },
        { id: 'nick', kind: 'text_input', field: 'nickname', labelKey: 'about.nickname' },
        {
          id: 'box',
          kind: 'container',
          direction: 'vertical',
          children: [
            { id: 'secret', kind: 'masked_text', field: 'tax_number', labelKey: 'about.tax' },
            { id: 'code', kind: 'text_input', field: 'member_code', labelKey: 'about.code' },
          ],
        },
        { id: 'go', kind: 'button', labelKey: 'screen.continue', action: 'submit' },
      ],
    },
    { id: 'phone', type: 'phone_otp', allowedCountries: ['US'], prefillFrom: 'mobile' },
    { id: 'done', type: 'completion' },
  ],
  edges: [
    edge('e1', 'consent', 'next', 'about'),
    edge('e2', 'about', 'next', 'phone'),
    edge('e3', 'phone', 'next', 'done'),
  ],
});

const FIELDS = {
  nickname: 'Ada',
  tax_number: '000-00-0000',
  member_code: 'M-1',
  mobile: '+15555550123',
  other: 'not on this screen',
};

describe('the session members (C151.5, C151.7)', () => {
  it('answers null for an inquiry the engine never positioned', async () => {
    const { inquiry } = await createTestInquiry(api.database.db, api.environmentId, {
      flow: SCREENS,
    });
    expect(await members(inquiry.id)).toBeNull();
  });

  it('keeps serving a flow-spec 1 version its own v1 flow, transitions included', async () => {
    const v1 = defaultInquiryTemplateAttributes().flow;
    const { inquiry } = await createTestInquiry(api.database.db, api.environmentId, { flow: v1 });
    const advance = await api.database.db.transaction(async (tx) => {
      await lockInquiry(tx, api.environmentId, inquiry.id);
      return positionFlowInTx(tx, api.deps, {
        environmentId: api.environmentId,
        inquiryId: inquiry.id,
      });
    });
    await api.deps.events.dispatch(advance.staged);
    const served = await members(inquiry.id, { consentRecorded: false });
    expect(served?.flow).toEqual(v1);
    expect(served?.position).toMatchObject({ 'step-id': 'consent', state: 'active' });
  });

  it('names the position and serves spec 1 without a step to a client that declared only 1', async () => {
    const inquiryId = await storedAt(SCREENS, {
      current: 'about',
      exited: [{ stepId: 'consent', port: 'next' }],
    });
    const served = await members(inquiryId);
    expect(served).toMatchObject({
      position: { 'step-id': 'about', state: 'active', 'previous-step-id': 'consent' },
      locales: { enabled: ['en'], default: 'en' },
      'spec-version': 1,
    });
    expect(served).not.toHaveProperty('step');
    expect(served).not.toHaveProperty('values');
    expect(served?.position).not.toHaveProperty('retry-after-ms');
  });

  it('serves a spec-2 client the client view and only the screen’s own values, masked and write-once ones as set', async () => {
    const inquiryId = await storedAt(
      SCREENS,
      { current: 'about', exited: [{ stepId: 'consent', port: 'next' }] },
      { fields: FIELDS },
    );
    await setVersion(
      inquiryId,
      sql`field_schemas = ${JSON.stringify([
        {
          key: 'member_code',
          type: 'string',
          label: 'Member code',
          pii: false,
          'write-once': true,
        },
      ])}::jsonb, enabled_locales = '{en,ar}'::text[], default_locale = 'ar'`,
    );
    const served = await members(inquiryId, { specVersions: [1, 2] });
    expect(served?.['spec-version']).toBe(2);
    expect(served?.step).toMatchObject({ id: 'about', type: 'screen' });
    expect(served?.step).not.toHaveProperty('name');
    expect(served?.values).toEqual({
      nickname: 'Ada',
      tax_number: { set: true },
      member_code: { set: true },
    });
    expect(served?.locales).toEqual({ enabled: ['en', 'ar'], default: 'ar' });
  });

  it('serves a verification step with prefillFrom that one field, and an unset masked value as null', async () => {
    const phone = await storedAt(
      SCREENS,
      {
        current: 'phone',
        exited: [
          { stepId: 'consent', port: 'next' },
          { stepId: 'about', port: 'next' },
        ],
      },
      { fields: FIELDS },
    );
    expect((await members(phone, { specVersions: [2] }))?.values).toEqual({
      mobile: '+15555550123',
    });
    const empty = await storedAt(SCREENS, {
      current: 'about',
      exited: [{ stepId: 'consent', port: 'next' }],
    });
    expect((await members(empty, { specVersions: [2] }))?.values).toEqual({
      nickname: null,
      tax_number: null,
      member_code: null,
    });
  });

  it('asks a waiting client to poll, and never sends a branch to any client', async () => {
    const flow = flowV2Schema.parse({
      metadata: { specVersion: 2, id: 'wait', version: 1, name: 'Wait' },
      entry: 'consent',
      steps: [
        consent,
        {
          id: 'route',
          type: 'branch',
          routes: [
            {
              key: 'bots',
              label: 'Bots',
              condition: { '>': [{ var: 'signals.inquiry/bot_score' }, 80] },
              onNull: 'else',
            },
          ],
          waitFor: { facts: ['signals.inquiry/bot_score'], maxSeconds: 10 },
        },
        { id: 'done', type: 'completion' },
      ],
      edges: [
        edge('e1', 'consent', 'next', 'route'),
        edge('e2', 'route', 'route:bots', 'done'),
        edge('e3', 'route', 'else', 'done'),
      ],
    });
    const inquiryId = await storedAt(
      flow,
      { current: 'route', exited: [{ stepId: 'consent', port: 'next' }] },
      { state: 'waiting' },
    );
    const served = await members(inquiryId, { specVersions: [1, 2] });
    expect(served?.position).toEqual({
      'step-id': 'route',
      state: 'waiting',
      'previous-step-id': 'consent',
      'retry-after-ms': FLOW_WAIT_POLL_MS,
    });
    expect(served).not.toHaveProperty('step');
    expect(JSON.stringify(served)).not.toContain('bot_score');
  });
});

describe('preparing a session (C151.14, C151.1, C150.5)', () => {
  const prepare = (inquiryId: string, sessionId: string) =>
    api.database.db.transaction((tx: Db) =>
      prepareFlowSessionInTx(
        tx,
        api.deps,
        { environmentId: api.environmentId, inquiryId },
        sessionId,
      ),
    );

  it('starts a fresh inquiry at entry with the session’s device as the first device, once', async () => {
    const inquiryId = await createInquiry(api);
    await resumeInquiry(api, inquiryId);
    const [session] = (await listInquirySessions(api.database.db, api.environmentId, { inquiryId }))
      .items;
    await api.database.db.execute(
      sql`update inquiry_sessions set device_type = 'smartphone' where id = ${session?.id ?? ''}`,
    );
    const advance = await prepare(inquiryId, session?.id ?? '');
    expect(advance.staged.length).toBeGreaterThan(0);
    expect(await inquiryOf(inquiryId)).toMatchObject({
      status: 'pending',
      flowStepId: 'consent',
      flowState: 'active',
      firstDeviceKind: 'mobile-web',
      firstPlatform: 'web',
    });
    await api.database.db.execute(
      sql`update inquiry_sessions set device_type = 'desktop' where id = ${session?.id ?? ''}`,
    );
    await prepare(inquiryId, session?.id ?? '');
    expect(await inquiryOf(inquiryId)).toMatchObject({ firstDeviceKind: 'mobile-web' });
  });

  it('ends a branch wait the poll finds past its deadline, and leaves one still in time', async () => {
    const flow = flowV2Schema.parse({
      metadata: { specVersion: 2, id: 'poll', version: 1, name: 'Poll' },
      entry: 'consent',
      steps: [
        consent,
        {
          id: 'route',
          type: 'branch',
          routes: [
            {
              key: 'bots',
              label: 'Bots',
              condition: { '>': [{ var: 'signals.inquiry/bot_score' }, 80] },
              onNull: 'else',
            },
          ],
          waitFor: { facts: ['signals.inquiry/bot_score'], maxSeconds: 10 },
        },
        { id: 'done', type: 'completion' },
      ],
      edges: [
        edge('e1', 'consent', 'next', 'route'),
        edge('e2', 'route', 'route:bots', 'done'),
        edge('e3', 'route', 'else', 'done'),
      ],
    });
    const now = api.clock.now();
    const waiting = async (enteredSecondsAgo: number) => {
      const inquiryId = await storedAt(
        flow,
        { current: 'route', exited: [{ stepId: 'consent', port: 'next' }] },
        { state: 'waiting' },
      );
      await api.database.db.execute(
        sql`update inquiries set status = 'pending' where id = ${inquiryId}`,
      );
      await api.database.db.execute(
        sql`update inquiry_flow_steps set entered_at = ${new Date(
          now.getTime() - enteredSecondsAgo * 1000,
        ).toISOString()}::timestamptz where inquiry_id = ${inquiryId} and step_id = 'route'`,
      );
      return inquiryId;
    };
    const inTime = await waiting(3);
    await prepare(inTime, 'iqse_none');
    expect(await inquiryOf(inTime)).toMatchObject({ flowStepId: 'route', flowState: 'waiting' });

    const late = await waiting(11);
    await prepare(late, 'iqse_none');
    expect(await inquiryOf(late)).toMatchObject({
      flowStepId: 'done',
      flowState: 'ended',
      status: 'completed',
    });
  });
});

describe('the session links (C162.3; 9A Stage 3 amendment 47, B43)', () => {
  it('serves the pinned version’s help and privacy links to every client', async () => {
    const inquiryId = await storedAt(SCREENS, {
      current: 'about',
      exited: [{ stepId: 'consent', port: 'next' }],
    });
    await setVersion(
      inquiryId,
      sql`help_url = 'https://help.example.com/verify', privacy_url = 'https://example.com/privacy'`,
    );
    const links = {
      'help-url': 'https://help.example.com/verify',
      'privacy-url': 'https://example.com/privacy',
    };
    expect((await members(inquiryId))?.links).toEqual(links);
    expect((await members(inquiryId, { specVersions: [1, 2] }))?.links).toEqual(links);
    expect(flowSessionLinksSchema.parse((await members(inquiryId))?.links)).toEqual(links);
  });

  it('names each link null when the version sets none, a flow-spec 1 version included', async () => {
    const inquiryId = await storedAt(SCREENS, {
      current: 'about',
      exited: [{ stepId: 'consent', port: 'next' }],
    });
    expect((await members(inquiryId))?.links).toEqual({ 'help-url': null, 'privacy-url': null });

    const { inquiry } = await createTestInquiry(api.database.db, api.environmentId, {
      flow: defaultInquiryTemplateAttributes().flow,
    });
    await api.database.db.transaction(async (tx) => {
      await lockInquiry(tx, api.environmentId, inquiry.id);
      await positionFlowInTx(tx, api.deps, {
        environmentId: api.environmentId,
        inquiryId: inquiry.id,
      });
    });
    await setVersion(inquiry.id, sql`privacy_url = 'https://example.com/privacy'`);
    expect((await members(inquiry.id, { consentRecorded: false }))?.links).toEqual({
      'help-url': null,
      'privacy-url': 'https://example.com/privacy',
    });
  });

  it('fails closed: a stored link that is not an https: URL of at most 2,048 characters is null', async () => {
    const inquiryId = await storedAt(SCREENS, {
      current: 'about',
      exited: [{ stepId: 'consent', port: 'next' }],
    });
    await setVersion(
      inquiryId,
      sql`help_url = 'http://help.example.com/verify',
          privacy_url = ${`https://example.com/${'p'.repeat(2048)}`}`,
    );
    expect((await members(inquiryId))?.links).toEqual({ 'help-url': null, 'privacy-url': null });
    await setVersion(inquiryId, sql`help_url = 'javascript:alert(1)', privacy_url = 'not a url'`);
    expect((await members(inquiryId))?.links).toEqual({ 'help-url': null, 'privacy-url': null });
  });
});

/** consent -> registry (a database step) -> licence (an AAMVA form step) -> done, each prefilled. */
const PREFILLED = flowV2Schema.parse({
  metadata: { specVersion: 2, id: 'prefill', version: 1, name: 'Prefill' },
  entry: 'consent',
  steps: [
    consent,
    {
      id: 'registry',
      type: 'database',
      fields: ['name_first', 'name_last', 'birthdate', 'phone_number', 'address_country_code'],
      prefillFrom: {
        name_first: 'legal_given_name',
        name_last: 'legal_family_name',
        phone_number: 'mobile',
        birthdate: 'date_of_birth',
      },
    },
    {
      id: 'licence',
      type: 'aamva',
      source: 'form',
      prefillFrom: {
        'name-first': 'legal_given_name',
        'identification-number': 'licence_number',
        'address-postal-code': 'postal_code',
      },
    },
    { id: 'done', type: 'completion' },
  ],
  edges: [
    edge('e1', 'consent', 'next', 'registry'),
    edge('e2', 'registry', 'next', 'licence'),
    edge('e3', 'licence', 'next', 'done'),
  ],
});

const PREFILL_FIELDS = {
  legal_given_name: 'Ada',
  legal_family_name: 'Vellacott',
  mobile: '+15555550123',
  licence_number: 'D1234567',
  postal_code: '00123',
  name_first: 'not the mapped field',
  other: 'not mapped at all',
};

describe('prefill by input name (C148.7; 9A Stage 3 amendment 49, B48)', () => {
  it('keys a database step’s values by its input names, each the mapped field’s value', async () => {
    const inquiryId = await storedAt(
      PREFILLED,
      { current: 'registry', exited: [{ stepId: 'consent', port: 'next' }] },
      { fields: PREFILL_FIELDS },
    );
    await setVersion(
      inquiryId,
      sql`field_schemas = ${JSON.stringify([
        {
          key: 'legal_family_name',
          type: 'string',
          label: 'Family name',
          pii: true,
          'write-once': true,
        },
      ])}::jsonb`,
    );
    expect((await members(inquiryId, { specVersions: [1, 2] }))?.values).toEqual({
      name_first: 'Ada',
      name_last: { set: true },
      phone_number: '+15555550123',
      birthdate: null,
    });
  });

  it('keys an AAMVA form step’s values by its input names as the web flow reads them', async () => {
    const inquiryId = await storedAt(
      PREFILLED,
      {
        current: 'licence',
        exited: [
          { stepId: 'consent', port: 'next' },
          { stepId: 'registry', port: 'next' },
        ],
      },
      { fields: PREFILL_FIELDS },
    );
    const served = await members(inquiryId, { specVersions: [2] });
    expect(served?.values).toEqual({
      name_first: 'Ada',
      identification_number: 'D1234567',
      address_postal_code: '00123',
    });
    expect(JSON.stringify(served)).not.toContain('not mapped at all');
    expect(JSON.stringify(served)).not.toContain('legal_given_name');
  });

  it('sends no values to a client that declared only spec 1', async () => {
    const inquiryId = await storedAt(
      PREFILLED,
      { current: 'registry', exited: [{ stepId: 'consent', port: 'next' }] },
      { fields: PREFILL_FIELDS },
    );
    expect(await members(inquiryId)).not.toHaveProperty('values');
  });
});

describe('a session without consent of its own on a flow-spec 2 version (C94.6; 9A amendment 23, B48)', () => {
  const passed = () =>
    storedAt(
      SCREENS,
      { current: 'about', exited: [{ stepId: 'consent', port: 'next' }] },
      { fields: FIELDS },
    );

  it('is served the passed consent step’s client view first, the position unchanged', async () => {
    const served = await members(await passed(), {
      specVersions: [1, 2],
      consentRecorded: false,
    });
    expect(served?.position).toMatchObject({ 'step-id': 'about', state: 'active' });
    expect(served?.step).toEqual({
      id: 'consent',
      type: 'consent',
      textKeys: ['consent.biometric'],
      required: true,
    });
    expect(served).not.toHaveProperty('values');
    expect(JSON.stringify(served)).not.toContain('Ada');
  });

  it('is served the current step once it holds a consent, and the consent step while it is current', async () => {
    const inquiryId = await passed();
    expect(
      (await members(inquiryId, { specVersions: [1, 2], consentRecorded: true }))?.step,
    ).toMatchObject({ id: 'about', type: 'screen' });
    const atConsent = await storedAt(SCREENS, { current: 'consent', exited: [] });
    expect(
      (await members(atConsent, { specVersions: [1, 2], consentRecorded: false }))?.step,
    ).toMatchObject({ id: 'consent', type: 'consent' });
  });

  it('is served no consent step when the path passed none, nor while the flow waits or has ended', async () => {
    const noConsent = flowV2Schema.parse({
      metadata: { specVersion: 2, id: 'no-consent', version: 1, name: 'No consent' },
      entry: 'about',
      steps: [SCREENS.steps[1], { id: 'done', type: 'completion' }],
      edges: [edge('e1', 'about', 'next', 'done')],
    });
    const inquiryId = await storedAt(noConsent, { current: 'about', exited: [] });
    expect(
      (await members(inquiryId, { specVersions: [1, 2], consentRecorded: false }))?.step,
    ).toMatchObject({ id: 'about' });
    const ended = await storedAt(SCREENS, {
      current: 'done',
      exited: [
        { stepId: 'consent', port: 'next' },
        { stepId: 'about', port: 'next' },
        { stepId: 'phone', port: 'next' },
      ],
    });
    expect(
      (await members(ended, { specVersions: [1, 2], consentRecorded: false }))?.step,
    ).toMatchObject({ id: 'done', type: 'completion' });
  });

  it('is never served the consent step by a client that declared only spec 1', async () => {
    expect(await members(await passed(), { consentRecorded: false })).not.toHaveProperty('step');
  });
});
