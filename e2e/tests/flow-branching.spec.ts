/**
 * C178.4 (Workflow 9A): a branching flow-spec 2 flow on the full stack, the server deciding every
 * step (ADR 0008). Budget: 90 s per test.
 *
 * Template A: consent, a government ID of one attempt whose `exhausted` edge falls back to a
 * proof-of-address document (`onFallback: review`), then a branch on the ID's extracted
 * `age-years`, with a screen for one route.
 * 1. The synthetic holder (born 1988-03-21) passes the ID and the branch's `under_60` route sends
 *    them to the details screen, then completion: completed, the ID on the path, no fallback.
 *    (The plan's example route is "a minor"; the synthetic ID holds one adult holder, so the
 *    route's limit is 60 to take the route with the same extraction. Its basis: the fixture.)
 * 2. An ID made of selfie stills fails its one attempt, the `exhausted` edge takes the document
 *    step, the bill passes it, and the inquiry goes to review: the fallback is in `flow-outcome`,
 *    and the failed ID stays failed (C150.6).
 *
 * Template B: consent, a government ID (a version needs a verification step), an intro screen,
 * then a branch that waits up to 3 seconds for the
 * provisional `inquiry/bot_score` snapshot (C150.9) and flags the inquiry for review above 80.
 * 3. A collector payload with the sandbox's `bot` outcome is sent on the intro screen, so the
 *    snapshot holds 95: the `bot` route, the `flag_for_review` action, and review with its flag.
 * 4. No payload: the snapshot is `not_yet_collected` (null), the wait ends, and the route's
 *    `onNull: else` takes the inquiry to completion with no flag (C150.3).
 *
 * Each test checks the inquiry's status, its `flow-outcome` and its step record, then replays the
 * inquiry through simulate (`POST /inquiry-template-versions/:id/simulate`, C156.4; C178.4, carried
 * from 9A by S4-12 and built in Workflow 9B) with the facts the inquiry was decided on: simulate
 * must take the same path, step by step and port by port, to the same status and `flow-outcome`.
 * Every value is synthetic.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DEFAULT_DOCUMENT_CHECKS, defaultInquiryTemplateAttributes } from '@openverify/contracts';
import { expect, test } from '@playwright/test';
import { FIXTURES, poaFixture, selfieStill } from '../src/paths.js';
import { readStackInfo } from '../src/stack-info.js';
import {
  consentStep,
  pathOf,
  pollSession,
  publishV2,
  settledInquiry,
  signedInAdmin,
  startV2Inquiry,
  stepRecord,
  v2Flow,
  type PublishedV2,
} from './support/flow-v2.js';
import { typeConfig } from './support/phase5.js';
import { phase5bFlow } from './support/phase5b.js';
import { flowApi, settledFlowVerification, submitGovernmentId } from './support/platform.js';

const BILL = poaFixture('en/utility-bill/happy.pdf');

const edge = (id: string, from: string, port: string, to: string) => ({ id, from, port, to });

/** The default template's government ID step, which the synthetic ID passes. */
function governmentIdStep() {
  return defaultInquiryTemplateAttributes().flow.steps.find(
    (step) => step.type === 'government_id',
  );
}

function idAndAgeFlow(run: string) {
  const id = governmentIdStep();
  return {
    metadata: { specVersion: 2, id: `e2e-branching-${run}`, version: 1, name: 'Branching' },
    entry: 'consent',
    steps: [
      consentStep(),
      { ...id, id: 'id_card', maxAttempts: 1, captureMethods: ['upload'], onFallback: 'review' },
      {
        id: 'age_route',
        type: 'branch',
        routes: [
          {
            key: 'under_60',
            label: 'Under 60',
            condition: { '<': [{ var: 'verifications.id_card.age-years' }, 60] },
            onNull: 'else',
          },
        ],
      },
      {
        id: 'details',
        type: 'screen',
        components: [
          { id: 'heading', kind: 'text', variant: 'title', copyKey: 'details.heading.title' },
          { id: 'go', kind: 'button', labelKey: 'screen.continue', action: 'submit' },
        ],
      },
      {
        id: 'poa',
        type: 'document',
        documentTypes: ['utility_bill', 'bank_statement'],
        captureMethods: ['upload'],
      },
      { id: 'done', type: 'completion' },
    ],
    edges: [
      edge('e1', 'consent', 'next', 'id_card'),
      edge('e2', 'id_card', 'next', 'age_route'),
      edge('e3', 'id_card', 'exhausted', 'poa'),
      edge('e4', 'age_route', 'route:under_60', 'details'),
      edge('e5', 'age_route', 'else', 'done'),
      edge('e6', 'details', 'next', 'done'),
      edge('e7', 'poa', 'next', 'done'),
    ],
  };
}

function botFlow(run: string) {
  return {
    metadata: { specVersion: 2, id: `e2e-bot-${run}`, version: 1, name: 'Bot route' },
    entry: 'consent',
    steps: [
      consentStep(),
      { ...governmentIdStep(), id: 'id_card', maxAttempts: 1, captureMethods: ['upload'] },
      {
        id: 'intro',
        type: 'screen',
        components: [
          { id: 'heading', kind: 'text', variant: 'title', copyKey: 'intro.heading.title' },
          { id: 'go', kind: 'button', labelKey: 'screen.continue', action: 'submit' },
        ],
      },
      {
        id: 'bot_route',
        type: 'branch',
        routes: [
          {
            key: 'bot',
            label: 'Bot score above 80',
            condition: { '>': [{ var: 'signals.inquiry/bot_score' }, 80] },
            onNull: 'else',
          },
        ],
        waitFor: { facts: ['signals.inquiry/bot_score'], maxSeconds: 3 },
      },
      {
        id: 'flag',
        type: 'action',
        action: { kind: 'flag_for_review', reasonCode: 'bot_suspected' },
      },
      { id: 'done', type: 'completion' },
    ],
    edges: [
      edge('e1', 'consent', 'next', 'id_card'),
      edge('e0', 'id_card', 'next', 'intro'),
      edge('e2', 'intro', 'next', 'bot_route'),
      edge('e3', 'bot_route', 'route:bot', 'flag'),
      edge('e4', 'bot_route', 'else', 'done'),
      edge('e5', 'flag', 'next', 'done'),
      edge('e6', 'flag', 'error', 'done'),
    ],
  };
}

/** A screen component's text is overridden on its `<step>.<component>.<attribute>` key (C162.2). */
const copyOf = (key: string, text: string) => ({ messages: { en: { [key]: text } } });

let idTemplate: PublishedV2;
let botTemplate: PublishedV2;

test.beforeAll(async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const admin = await signedInAdmin(stack);
  const run = randomUUID().slice(0, 8);
  idTemplate = await publishV2(stack, admin, `e2e branching ${run}`, idAndAgeFlow(run), {
    'verification-config': {
      'government-id': defaultInquiryTemplateAttributes()['verification-config']['government-id'],
      document: typeConfig(DEFAULT_DOCUMENT_CHECKS),
    },
    copy: copyOf('details.heading.title', 'A few more details'),
    'enabled-locales': ['en'],
    'default-locale': 'en',
  });
  botTemplate = await publishV2(stack, admin, `e2e bot route ${run}`, botFlow(run), {
    // A version needs a verification step (the version contract), so the ID comes first.
    'verification-config': {
      'government-id': defaultInquiryTemplateAttributes()['verification-config']['government-id'],
    },
    'signal-config': { collect: 'default' },
    copy: copyOf('intro.heading.title', 'Before you start'),
    'enabled-locales': ['en'],
    'default-locale': 'en',
  });
  // A route on a heuristic extraction is acknowledged whichever way it routes (C150.8); a fallback
  // that goes to review needs none (C150.6).
  expect(idTemplate.acknowledgements).toEqual(['heuristic:age_route']);
  expect(botTemplate.acknowledgements).toEqual(
    expect.arrayContaining([expect.stringMatching(/^heuristic:bot_route/)]),
  );
});

/**
 * C178.4 (Workflow 9B, integration-9b): the inquiry replayed through simulate with `scope`, the
 * facts it was decided on. Simulate stores and sends nothing; its path is the step record's, and
 * its outcome the inquiry's.
 */
async function replayThroughSimulate(
  stack: ReturnType<typeof readStackInfo>,
  versionId: string,
  scope: Record<string, unknown>,
  inquiryId: string,
  inquiry: Readonly<Record<string, unknown>>,
): Promise<void> {
  const response = await fetch(
    `${stack.apiUrl}/api/v1/inquiry-template-versions/${versionId}/simulate`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${stack.apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ meta: { scope } }),
    },
  );
  const text = await response.text();
  expect(response.status, text).toBe(200);
  const simulated = (
    JSON.parse(text) as {
      data: {
        attributes: {
          steps: { 'step-id': string; port: string | null }[];
          outcome: { status: string; 'flow-outcome': unknown };
        };
      };
    }
  ).data.attributes;
  expect(simulated.steps.map((step) => [step['step-id'], step.port])).toEqual(
    pathOf(await stepRecord(stack, inquiryId)),
  );
  expect(simulated.outcome.status).toBe(inquiry.status);
  expect(simulated.outcome['flow-outcome']).toEqual(inquiry['flow-outcome']);
}

/** The government ID step through the flow API: both sides of the synthetic ID, decided passed. */
async function passTheId(stack: ReturnType<typeof readStackInfo>, sessionToken: string) {
  const idApi = flowApi(stack.apiUrl, sessionToken);
  const verificationId = await submitGovernmentId(idApi, {
    front: FIXTURES.idFront,
    back: FIXTURES.idBack,
  });
  expect((await settledFlowVerification(idApi, verificationId, 60_000)).attributes.status).toBe(
    'passed',
  );
}

test('an ID route on age-years sends the holder to the details screen, then completion (C150.2, C151.3)', async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const started = await startV2Inquiry(stack, idTemplate.templateId, `e2e-age-${randomUUID()}`);
  const flow = v2Flow(stack, started.sessionToken);
  await flow.consent();
  await passTheId(stack, started.sessionToken);
  const atDetails = await pollSession(
    flow,
    (session) => session.position?.['step-id'] === 'details',
  );
  expect(atDetails.step).toMatchObject({ id: 'details', type: 'screen' });
  // C151.5: no route condition or internal name ever reaches the client.
  expect(JSON.stringify(atDetails)).not.toContain('age-years');
  await flow.submitScreen('details');

  const inquiry = await settledInquiry(stack, started.inquiryId, ['completed']);
  expect(inquiry['flow-outcome']).toEqual({
    'verification-types-on-path': ['government-id'],
    'fallbacks-taken': [],
    flags: [],
  });
  expect(pathOf(await stepRecord(stack, started.inquiryId))).toEqual([
    ['consent', 'next'],
    ['id_card', 'next'],
    ['age_route', 'route:under_60'],
    ['details', 'next'],
    ['done', null],
  ]);
  // The synthetic holder's birthdate, which simulate turns into age-years as the engine does.
  await replayThroughSimulate(
    stack,
    idTemplate.versionId,
    { verifications: { id_card: { status: 'passed', extractions: { birthdate: '1988-03-21' } } } },
    started.inquiryId,
    inquiry,
  );
});

test('an ID that fails its one attempt falls back to a document and the inquiry goes to review (C150.6)', async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const sidecar = JSON.parse(await readFile(poaFixture('en/utility-bill/happy.json'), 'utf8')) as {
    inquiry_fields: Record<string, string>;
  };
  const started = await startV2Inquiry(
    stack,
    idTemplate.templateId,
    `e2e-fallback-${randomUUID()}`,
    sidecar.inquiry_fields,
  );
  const flow = v2Flow(stack, started.sessionToken);
  await flow.consent();
  const idApi = flowApi(stack.apiUrl, started.sessionToken);
  const idAttempt = await submitGovernmentId(idApi, {
    front: selfieStill('a', 'center'),
    back: selfieStill('a', 'left'),
  });
  expect((await settledFlowVerification(idApi, idAttempt, 60_000)).attributes.status).toBe(
    'failed',
  );
  await pollSession(flow, (session) => session.position?.['step-id'] === 'poa');

  const documents = phase5bFlow(stack, started.sessionToken);
  const documentId = await documents.create('document');
  await documents.upload(documentId, 'document', await readFile(BILL));
  await documents.submit(documentId);
  await settledFlowVerification(idApi, documentId, 60_000);

  const inquiry = await settledInquiry(stack, started.inquiryId, ['needs_review']);
  expect(inquiry['flow-outcome']).toEqual({
    'verification-types-on-path': ['government-id', 'document'],
    'fallbacks-taken': ['id_card'],
    flags: [],
  });
  expect(pathOf(await stepRecord(stack, started.inquiryId))).toEqual([
    ['consent', 'next'],
    ['id_card', 'exhausted'],
    ['poa', 'next'],
    ['done', null],
  ]);
  // A failed verification is never counted passed, whatever path follows (ADR 0008).
  expect((await idApi.verification(idAttempt)).attributes.status).toBe('failed');
  const poa = (await idApi.verification(documentId)).attributes.status;
  await replayThroughSimulate(
    stack,
    idTemplate.versionId,
    { verifications: { id_card: { status: 'failed' }, poa: { status: poa } } },
    started.inquiryId,
    inquiry,
  );
});

test('a provisional bot score above 80 takes the bot route and flags the inquiry for review (C150.9, C152.6)', async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const started = await startV2Inquiry(stack, botTemplate.templateId, `e2e-bot-${randomUUID()}`);
  const flow = v2Flow(stack, started.sessionToken);
  await flow.consent();
  await passTheId(stack, started.sessionToken);
  // The collector's payload on the screen before the branch, with the sandbox outcome (C90.9).
  await flow.signals('intro', 'bot');
  await flow.submitScreen('intro');

  const inquiry = await settledInquiry(stack, started.inquiryId, ['needs_review']);
  expect(inquiry['flow-outcome']).toMatchObject({
    'verification-types-on-path': ['government-id'],
    'fallbacks-taken': [],
    flags: [expect.stringContaining('bot_suspected')],
  });
  expect(pathOf(await stepRecord(stack, started.inquiryId))).toEqual([
    ['consent', 'next'],
    ['id_card', 'next'],
    ['intro', 'next'],
    ['bot_route', 'route:bot'],
    ['flag', 'next'],
    ['done', null],
  ]);
  await replayThroughSimulate(
    stack,
    botTemplate.versionId,
    {
      verifications: { id_card: { status: 'passed' } },
      signals: { 'inquiry/bot_score': 95 },
    },
    started.inquiryId,
    inquiry,
  );
});

test('with no collector payload the bot score is null, the wait ends and onNull takes else (C150.3, C150.9)', async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const started = await startV2Inquiry(stack, botTemplate.templateId, `e2e-nobot-${randomUUID()}`);
  const flow = v2Flow(stack, started.sessionToken);
  await flow.consent();
  await passTheId(stack, started.sessionToken);
  await flow.submitScreen('intro');
  // The session poll ends a wait it finds over (C150.5).
  await pollSession(flow, (session) => session.position?.state === 'ended', 30_000);

  const inquiry = await settledInquiry(stack, started.inquiryId, ['completed']);
  expect(inquiry['flow-outcome']).toEqual({
    'verification-types-on-path': ['government-id'],
    'fallbacks-taken': [],
    flags: [],
  });
  expect(pathOf(await stepRecord(stack, started.inquiryId))).toEqual([
    ['consent', 'next'],
    ['id_card', 'next'],
    ['intro', 'next'],
    ['bot_route', 'else'],
    ['done', null],
  ]);
  await replayThroughSimulate(
    stack,
    botTemplate.versionId,
    { verifications: { id_card: { status: 'passed' } }, signals: { 'inquiry/bot_score': null } },
    started.inquiryId,
    inquiry,
  );
});
