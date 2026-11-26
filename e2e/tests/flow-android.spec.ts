/**
 * C224.3 (Phase 10, Workflow 10A integration-10a): the 10A flow driven through the flow API as the
 * Android SDK drives it, with its `User-Agent` (`OpenVerify-Android/0.1.0`) and `OpenVerify-Flow-Spec:
 * 2` on every request: read the session, render the position's client view, report the current step
 * only, read again. No Linux runner can drive the SDK's UI, so this is the API-driven client; the
 * SDK's own client runs the same flow in `:openverify-sdk:stackTest` (C224.4).
 * Budget: 90 s per test.
 *
 * 1. Spanish: a consent whose digest is not the text shown is refused (422 `consent_text_mismatch`)
 *    and records nothing; the Android digests of `contracts/fixtures/i18n/android-consent-digests.json`
 *    for `es` are accepted under the SDK's catalog version; the sandbox database passes; the screen
 *    is submitted; the branch on `session.locale` (the consent's base tag, D2) takes the Spanish
 *    route to a second screen, then the completion. The inquiry session names the Android SDK.
 * 2. English: the same flow skips the Spanish screen.
 * Every value is synthetic.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  ANDROID_FLOW_FILE,
  ANDROID_FLOW_STEPS,
  type AndroidFlowFixture,
} from '../src/android-flow.js';
import { REPO_ROOT } from '../src/paths.js';
import { readStackInfo, type StackInfo } from '../src/stack-info.js';
import {
  publishV2,
  settledInquiry,
  signedInAdmin,
  startV2Inquiry,
  stepRecord,
  type PublishedV2,
} from './support/flow-v2.js';
import { recordingClient } from './support/platform.js';

/** What the SDK sends on every flow request (C193.1, C193.7). */
const ANDROID_HEADERS = {
  'user-agent': 'OpenVerify-Android/0.1.0',
  'openverify-flow-spec': '2',
};

/** An invented person: the sandbox's nickname record (`sandbox-database-nickname`) holds "Robert". */
const PERSON = {
  'name-first': 'Bob',
  'name-last': 'Quillon',
  birthdate: '1984-07-09',
  'address-street-1': '12 Example Street',
  'address-city': 'Exampleton',
  'address-postal-code': '00000',
  'address-country-code': 'US',
};

interface DigestCase {
  'catalog-version': string;
  key: string;
  locale: string;
  values: { days: string; organization?: string };
  'text-sha256': string;
}

const DIGESTS = (
  JSON.parse(
    readFileSync(
      path.join(REPO_ROOT, 'contracts', 'fixtures', 'i18n', 'android-consent-digests.json'),
      'utf8',
    ),
  ) as { cases: DigestCase[] }
).cases;

/** The Android digest of `key` in `locale` at `days`, as the SDK reports it (C200.2, C200.4). */
function androidDigest(key: string, locale: string, days: number): DigestCase {
  const found = DIGESTS.find(
    (entry) =>
      entry.key === key &&
      entry.locale === locale &&
      entry.values.days === String(days) &&
      entry.values.organization === undefined,
  );
  if (found === undefined) {
    throw new Error(`no Android digest of ${key} in ${locale} at ${String(days)} days`);
  }
  return found;
}

interface Answer {
  status: number;
  body: Record<string, unknown> | null;
}

/** The flow API as the Android SDK calls it. */
function androidClient(stack: StackInfo, sessionToken: string) {
  const call = async (method: 'GET' | 'POST', route: string, body?: unknown): Promise<Answer> => {
    const response = await fetch(`${stack.apiUrl}/api/v1/flow${route}`, {
      method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${sessionToken}`,
        ...ANDROID_HEADERS,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: text === '' ? null : (JSON.parse(text) as Record<string, unknown>),
    };
  };
  const ok = (answer: Answer, status: number, what: string) => {
    expect(answer.status, `${what}: ${JSON.stringify(answer.body)}`).toBe(status);
    return answer.body ?? {};
  };
  return {
    call,
    async session() {
      return ok(await call('GET', '/session'), 200, 'session') as {
        'spec-version'?: number;
        position?: { 'step-id': string; state: string };
        step?: { id: string; type: string };
        consent?: unknown;
        'face-template-retention-days'?: number;
      };
    },
    async databaseStep() {
      const created = ok(await call('POST', '/verifications', { type: 'database' }), 201, 'create');
      const id = (created.data as { id: string }).id;
      ok(await call('POST', `/verifications/${id}/inputs`, PERSON), 200, 'inputs');
      ok(await call('POST', `/verifications/${id}/submit`), 202, 'submit');
      await expect
        .poll(
          async () => {
            const read = ok(await call('GET', `/verifications/${id}`), 200, 'verification');
            return (read.data as { attributes: { status: string } }).attributes.status;
          },
          { timeout: 45_000, intervals: [500, 1_000] },
        )
        .toBe('passed');
    },
    async submitScreen(stepId: string) {
      return ok(
        await call('POST', `/screens/${stepId}/submit`, { values: {} }),
        200,
        `submit ${stepId}`,
      ) as { position?: { 'step-id': string; state: string }; step?: { type: string } };
    },
  };
}

let template: PublishedV2;

test.beforeAll(async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const fixture = JSON.parse(readFileSync(ANDROID_FLOW_FILE, 'utf8')) as AndroidFlowFixture;
  const { flow, ...members } = fixture.version;
  template = await publishV2(
    stack,
    await signedInAdmin(stack),
    `e2e android ${randomUUID().slice(0, 8)}`,
    flow,
    members,
  );
});

/** Consent, the database step and the first screen, as the SDK reports them; the answer after the screen. */
async function throughTheFirstScreen(locale: 'es' | 'en') {
  const stack = readStackInfo();
  const started = await startV2Inquiry(
    stack,
    template.templateId,
    `e2e-android-${randomUUID()} sandbox-database-nickname`,
  );
  const client = androidClient(stack, started.sessionToken);
  const first = await client.session();
  expect(first['spec-version']).toBe(2);
  expect(first.position).toMatchObject({ 'step-id': ANDROID_FLOW_STEPS.consent, state: 'active' });
  expect(first.step?.type).toBe('consent');
  const days = first['face-template-retention-days'];
  if (typeof days !== 'number') {
    throw new Error('the session serves no face-template-retention-days');
  }
  const keys = [
    'consent.biometric',
    'consent.processing',
    'notice.session-integrity',
    'notice.play-integrity',
  ];
  const digests = keys.map((key) => androidDigest(key, locale, days));
  const body = {
    accepted: true,
    'text-keys': keys,
    locale,
    'text-sha256': digests.map((entry) => entry['text-sha256']),
    'copy-source': 'built-in',
    'catalog-version': digests[0]?.['catalog-version'],
  };

  // A digest of a text the SDK did not show is refused, and no consent is recorded (C200.5).
  const refused = await client.call('POST', '/consent', {
    ...body,
    'text-sha256': ['0'.repeat(64), ...body['text-sha256'].slice(1)],
  });
  expect(refused.status, JSON.stringify(refused.body)).toBe(422);
  expect(refused.body?.code).toBe('consent_text_mismatch');
  expect((await client.session()).consent ?? null).toBeNull();

  const accepted = await client.call('POST', '/consent', body);
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
  expect((await client.session()).position?.['step-id']).toBe(ANDROID_FLOW_STEPS.records);
  await client.databaseStep();
  await expect
    .poll(async () => (await client.session()).position?.['step-id'], { timeout: 30_000 })
    .toBe(ANDROID_FLOW_STEPS.hello);
  expect((await client.session()).step?.type).toBe('screen');
  const after = await client.submitScreen(ANDROID_FLOW_STEPS.hello);
  return { stack, started, client, after };
}

test('Spanish: Android consent digests accepted, a wrong one refused, and the branch on session.locale takes the Spanish screen (C224.3, C200, D2)', async () => {
  test.setTimeout(90_000);
  const { stack, started, client, after } = await throughTheFirstScreen('es');
  expect(after.position).toMatchObject({ 'step-id': ANDROID_FLOW_STEPS.hola, state: 'active' });
  expect(after.step?.type).toBe('screen');
  await client.submitScreen(ANDROID_FLOW_STEPS.hola);

  const inquiry = await settledInquiry(stack, started.inquiryId, ['completed']);
  expect(inquiry.status).toBe('completed');
  const record = await stepRecord(stack, started.inquiryId);
  expect(record.find((entry) => entry.stepId === ANDROID_FLOW_STEPS.branch)?.exitPort).toBe(
    'route:spanish',
  );
  // C94.5: the SDK's User-Agent names the session's client.
  const { client: server } = recordingClient(stack.apiUrl, stack.apiKey);
  const { data: sessions } = await server.inquirySessions.list({
    filter: { 'inquiry-id': started.inquiryId },
  });
  expect(sessions.map((session) => session.attributes['mobile-sdk-name'])).toContain(
    'openverify-android',
  );
});

test('English: the same flow leaves the branch by its else port, straight to the completion (C224.3, D2)', async () => {
  test.setTimeout(90_000);
  const { stack, started, after } = await throughTheFirstScreen('en');
  expect(after.position?.['step-id']).not.toBe(ANDROID_FLOW_STEPS.hola);

  const inquiry = await settledInquiry(stack, started.inquiryId, ['completed']);
  expect(inquiry.status).toBe('completed');
  const record = await stepRecord(stack, started.inquiryId);
  expect(record.find((entry) => entry.stepId === ANDROID_FLOW_STEPS.branch)?.exitPort).toBe('else');
  expect(record.map((entry) => entry.stepId)).not.toContain(ANDROID_FLOW_STEPS.hola);
});
