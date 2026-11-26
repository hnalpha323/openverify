/**
 * C150.7 (Workflow 9A, `api-flow-actions`; Phase 8 C128, not legal advice): the decision record of a
 * flow failure reached on an adverse path.
 * - A failure reached through a branch route that reads anything but this inquiry's verification
 *   outcomes (or through the `else` of such a branch) writes one `flow-failure` record: actor
 *   `inquiry-flow` named by the inquiry, the branches passed with their ports and `onNull`, the facts
 *   read as codes with their tiers (never a value), `solely-automated: true`, and the failure step's
 *   basis and contest route.
 * - A failure reached on verification outcomes only (or by no branch) writes none.
 * - Phase 8's gates (C128.3, C128.4): in production a missing basis or contest route, or a missing
 *   biometric basis on a biometric path, sends the inquiry to review instead of failing it, recorded
 *   on the record; with `explicit-consent` the recorded consent must list
 *   `consent.automated-decision` (and `consent.biometric` on a biometric path).
 * - A redacted inquiry gets no record.
 *
 * Every value is synthetic.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  createInquirySession,
  listInquiryDecisions,
  recordInquirySessionConsent,
  type Db,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { flowV2Schema } from '@openverify/flow-spec';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '../test-support/fakes.js';
import { recordFlowFailureInTx, type FlowPathExit } from './failure.js';

let database: TestDatabase;
let sandboxId: string;
let productionId: string;
const clock = fixedClock();

beforeAll(async () => {
  database = await createTestDatabase();
  sandboxId = (await createTestTenant(database.db)).environment.id;
  productionId = (await createTestTenant(database.db, { kind: 'production' })).environment.id;
}, 120_000);

afterAll(async () => {
  await database.close();
});

const CONTEST = { url: 'https://example.com/contest' };

/**
 * consent -> id_card -> face -> check (a branch) -> refused | done. Its routes are given; each
 * route's port leads to `refused`, and `else` to `done` unless `elseTo` says otherwise.
 */
function flowWith(
  routes: Record<string, unknown>[],
  failure: Record<string, unknown> = {},
  elseTo = 'done',
) {
  return flowV2Schema.parse({
    metadata: { specVersion: 2, id: 'flow-failure', version: 1, name: 'Failure' },
    entry: 'consent',
    steps: [
      { id: 'consent', type: 'consent', textKeys: ['consent.biometric'], required: true },
      {
        id: 'id_card',
        type: 'government_id',
        sides: 'front',
        maxAttempts: 2,
        captureMethods: ['camera'],
      },
      { id: 'face', type: 'selfie', poses: ['center'], liveness: 'passive', maxAttempts: 2 },
      { id: 'check', type: 'branch', routes },
      { id: 'refused', type: 'failure', ...failure },
      { id: 'done', type: 'completion' },
    ],
    edges: [
      { id: 'e1', from: 'consent', port: 'next', to: 'id_card' },
      { id: 'e2', from: 'id_card', port: 'next', to: 'face' },
      { id: 'e3', from: 'face', port: 'next', to: 'check' },
      ...routes.map((route, index) => ({
        id: `r${String(index)}`,
        from: 'check',
        port: `route:${String(route.key)}`,
        to: 'refused',
      })),
      { id: 'e4', from: 'check', port: 'else', to: elseTo },
    ],
  });
}

const MINOR = {
  key: 'minor',
  label: 'Under 18',
  condition: { '<': [{ var: 'verifications.id_card.age-years' }, 18] },
  onNull: 'else',
};
const ID_FAILED = {
  key: 'id_failed',
  label: 'ID failed',
  condition: { '===': [{ var: 'verifications.id_card.status' }, 'failed'] },
  onNull: 'else',
};
const GLARE = {
  key: 'glare',
  label: 'Glare',
  condition: {
    '===': [{ var: 'verifications.face.checks.selfie_glare_detection.status' }, 'failed'],
  },
  onNull: 'review',
};

const VISITED: FlowPathExit[] = [
  { stepId: 'consent', port: 'next', onNull: null },
  { stepId: 'id_card', port: 'next', onNull: null },
  { stepId: 'face', port: 'next', onNull: null },
];

async function inquiryOn(environmentId: string, flow: ReturnType<typeof flowWith>) {
  const { inquiry } = await createTestInquiry(database.db, environmentId, {
    flow: flow as unknown as Record<string, unknown>,
  });
  return inquiry;
}

async function consentTo(environmentId: string, inquiryId: string, textKeys: string[]) {
  const session = await createInquirySession(database.db, environmentId, {
    id: testId('iqse'),
    inquiryId,
    tokenHash: createHash('sha256').update(randomBytes(16)).digest('hex'),
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await recordInquirySessionConsent(database.db, environmentId, session.id, {
    acceptedAt: new Date(Date.now() - 60_000),
    textKeys,
    locale: 'en',
    ip: null,
    userAgent: null,
  });
}

async function fail(
  environmentId: string,
  inquiry: Awaited<ReturnType<typeof inquiryOn>>,
  last: FlowPathExit,
) {
  return database.db.transaction((tx) =>
    recordFlowFailureInTx(
      tx as Db,
      { clock },
      { environmentId, inquiryId: inquiry.id },
      {
        templateVersionId: inquiry.inquiryTemplateVersionId,
        failureStepId: 'refused',
        exits: [...VISITED, last],
      },
    ),
  );
}

const decisionsOf = async (environmentId: string, inquiryId: string) =>
  (await listInquiryDecisions(database.db, environmentId, inquiryId, { size: 10 })).items;

describe('the flow-failure record on an adverse path (C150.7)', () => {
  it('records the routes, the facts as codes with their tiers, the basis and the contest route', async () => {
    const inquiry = await inquiryOn(
      sandboxId,
      flowWith([MINOR], { decisionBasis: 'contract', contestRoute: CONTEST }),
    );
    const verdict = await fail(sandboxId, inquiry, {
      stepId: 'check',
      port: 'route:minor',
      onNull: null,
    });
    const [record] = await decisionsOf(sandboxId, inquiry.id);
    expect(verdict).toEqual({
      outcome: 'fail',
      errorCode: null,
      decision: {
        id: record?.id,
        'solely-automated': true,
        'decision-basis': 'contract',
        'contest-route': CONTEST,
      },
    });
    expect(record).toMatchObject({
      kind: 'flow-failure',
      subjectType: 'inquiry',
      subjectId: inquiry.id,
      actorType: 'inquiry-flow',
      actorId: inquiry.id,
      run: null,
      solelyAutomated: true,
      decisionBasis: 'contract',
      contestRoute: CONTEST,
      biometricBasis: null,
      errorCode: null,
      flow: {
        templateVersionId: inquiry.inquiryTemplateVersionId,
        failureStepId: 'refused',
        routes: [{ stepId: 'check', port: 'route:minor', onNull: null }],
      },
      evidence: [
        {
          kind: 'extraction',
          id: null,
          name: 'verifications.id_card.age-years',
          status: null,
          tier: 'R/H',
          stage: 'beta',
          confidence: null,
        },
      ],
    });
  });

  it('counts every route tried before the one taken, and else after all of them', async () => {
    const inquiry = await inquiryOn(sandboxId, flowWith([ID_FAILED, MINOR], {}, 'refused'));
    await fail(sandboxId, inquiry, { stepId: 'check', port: 'else', onNull: null });
    const [record] = await decisionsOf(sandboxId, inquiry.id);
    expect(record?.flow?.routes).toEqual([{ stepId: 'check', port: 'else', onNull: null }]);
    expect(record?.evidence.map(({ kind, name }) => ({ kind, name }))).toEqual([
      { kind: 'verification', name: 'verifications.id_card.status' },
      { kind: 'extraction', name: 'verifications.id_card.age-years' },
    ]);
  });

  it('writes nothing for a failure reached on verification outcomes only, or by no branch', async () => {
    const inquiry = await inquiryOn(sandboxId, flowWith([ID_FAILED, MINOR]));
    expect(
      await fail(sandboxId, inquiry, { stepId: 'check', port: 'route:id_failed', onNull: null }),
    ).toEqual({ outcome: 'fail', decision: null, errorCode: null });
    expect(await fail(sandboxId, inquiry, { stepId: 'face', port: 'error', onNull: null })).toEqual(
      { outcome: 'fail', decision: null, errorCode: null },
    );
    expect(await decisionsOf(sandboxId, inquiry.id)).toEqual([]);
  });

  it('writes nothing for a redacted inquiry', async () => {
    const inquiry = await inquiryOn(sandboxId, flowWith([MINOR]));
    await database.client.query(`update inquiries set redacted_at = now() where id = $1`, [
      inquiry.id,
    ]);
    expect(
      await fail(sandboxId, inquiry, { stepId: 'check', port: 'route:minor', onNull: null }),
    ).toEqual({ outcome: 'fail', decision: null, errorCode: null });
    expect(await decisionsOf(sandboxId, inquiry.id)).toEqual([]);
  });
});

describe('the facts a record names (C150.7)', () => {
  it('names each kind of fact by its path, the heuristic and unknown ones never as more certain', async () => {
    const reads = [
      'signals.inquiry/bot_score',
      'account.status',
      'device.kind',
      'session.locale',
      'inquiry.fields.name_first',
      'workflows.run_check.status',
      'verifications.id_card.checks.id_expired.status',
    ];
    const ANY = {
      key: 'any',
      label: 'Any',
      condition: { or: reads.map((path) => ({ '===': [{ var: path }, 'x'] })) },
      onNull: 'else',
    };
    const inquiry = await inquiryOn(sandboxId, flowWith([ANY]));
    await fail(sandboxId, inquiry, { stepId: 'check', port: 'route:any', onNull: null });
    const [record] = await decisionsOf(sandboxId, inquiry.id);
    expect(record?.evidence.map(({ kind, name }) => ({ kind, name }))).toEqual([
      { kind: 'signal', name: 'signals.inquiry/bot_score' },
      { kind: 'account', name: 'account.status' },
      { kind: 'device', name: 'device.kind' },
      { kind: 'device', name: 'session.locale' },
      { kind: 'field', name: 'inquiry.fields.name_first' },
      { kind: 'workflow-output', name: 'workflows.run_check.status' },
      { kind: 'check', name: 'verifications.id_card.checks.id_expired.status' },
    ]);
    expect(record?.evidence.find(({ kind }) => kind === 'signal')).toMatchObject({
      tier: 'H',
      stage: 'beta',
    });
  });

  it('writes nothing for a v1 flow, or a failure step the flow does not have', async () => {
    const { inquiry } = await createTestInquiry(database.db, sandboxId, {
      flow: {
        metadata: { specVersion: 1, id: 'v1', version: 1, name: 'v1' },
        steps: [{ id: 'done', type: 'completion' }],
        transitions: [],
      },
    });
    expect(
      await fail(sandboxId, inquiry, { stepId: 'check', port: 'route:minor', onNull: null }),
    ).toEqual({ outcome: 'fail', decision: null, errorCode: null });
    const v2 = await inquiryOn(sandboxId, flowWith([MINOR]));
    expect(
      await database.db.transaction((tx) =>
        recordFlowFailureInTx(
          tx as Db,
          { clock },
          { environmentId: sandboxId, inquiryId: v2.id },
          {
            templateVersionId: v2.inquiryTemplateVersionId,
            failureStepId: 'done',
            exits: [...VISITED, { stepId: 'check', port: 'route:minor', onNull: null }],
          },
        ),
      ),
    ).toEqual({ outcome: 'fail', decision: null, errorCode: null });
    expect(await decisionsOf(sandboxId, v2.id)).toEqual([]);
  });
});

describe('Phase 8’s gates on a flow failure (C128.3, C128.4)', () => {
  it('sends a production failure without a basis or contest route to review, recorded', async () => {
    const inquiry = await inquiryOn(productionId, flowWith([MINOR]));
    const verdict = await fail(productionId, inquiry, {
      stepId: 'check',
      port: 'route:minor',
      onNull: null,
    });
    expect(verdict).toMatchObject({ outcome: 'review', errorCode: 'decision_basis_missing' });
    expect(await decisionsOf(productionId, inquiry.id)).toMatchObject([
      { kind: 'flow-failure', errorCode: 'decision_basis_missing', decisionBasis: null },
    ]);
  });

  it('needs a biometric basis on a biometric path in production, and records the onNull', async () => {
    const basis = { decisionBasis: 'contract', contestRoute: CONTEST };
    const without = await inquiryOn(productionId, flowWith([GLARE], basis));
    const last = { stepId: 'check', port: 'route:glare', onNull: 'review' };
    expect(await fail(productionId, without, last)).toMatchObject({
      outcome: 'review',
      errorCode: 'decision_basis_missing',
    });
    const withBasis = await inquiryOn(
      productionId,
      flowWith([GLARE], { ...basis, biometricBasis: 'substantial-public-interest' }),
    );
    expect(await fail(productionId, withBasis, last)).toMatchObject({
      outcome: 'fail',
      errorCode: null,
    });
    const [record] = await decisionsOf(productionId, withBasis.id);
    expect(record).toMatchObject({
      biometricBasis: 'substantial-public-interest',
      flow: { routes: [{ stepId: 'check', port: 'route:glare', onNull: 'review' }] },
      evidence: [
        { kind: 'check', name: 'verifications.face.checks.selfie_glare_detection.status' },
      ],
    });
  });

  it('checks the recorded consent for an explicit-consent basis', async () => {
    const explicit = { decisionBasis: 'explicit-consent', contestRoute: CONTEST };
    const missing = await inquiryOn(productionId, flowWith([MINOR], explicit));
    await consentTo(productionId, missing.id, ['consent.biometric']);
    const last = { stepId: 'check', port: 'route:minor', onNull: null };
    expect(await fail(productionId, missing, last)).toMatchObject({
      outcome: 'review',
      errorCode: 'automated_decision_consent_missing',
    });
    const given = await inquiryOn(productionId, flowWith([MINOR], explicit));
    await consentTo(productionId, given.id, ['consent.biometric', 'consent.automated-decision']);
    expect(await fail(productionId, given, last)).toMatchObject({
      outcome: 'fail',
      errorCode: null,
    });
  });
});
