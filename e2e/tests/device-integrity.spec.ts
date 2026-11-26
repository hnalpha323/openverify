/**
 * C224.3 (Phase 10, Workflow 10B integration-10b): device integrity, full stack, through the flow API
 * as the Android SDK calls it (`User-Agent: OpenVerify-Android/0.1.0`, `OpenVerify-Flow-Spec: 2`), since
 * no Linux runner can drive the SDK's UI; the SDK's own encodings of these bodies are the committed
 * request fixtures (C224.4). Budget: 90 s per test.
 *
 * The 10A Android flow (consent with `notice.session-integrity`, the sandbox database, a screen, the
 * completion) runs with the stack's sandbox `deviceIntegrity` provider bound (C211.1). After consent the
 * client sends one Android signals body (C210.2) and, because the session says `integrity.request`,
 * one challenge and one sandbox magic token (C211.3), whose decode the worker runs before the flow
 * completes. Once the inquiry completes, the `inquiry-signals` job freezes:
 *
 * 1. Emulator, hooking and debugger evidence with `sandbox-strong`: `device_emulated` and
 *    `device_hooked` are `true` with their codes as reasons, `device_rooted` is `null` with
 *    `no_indicator_found` (never "not rooted"), `bot_score` carries `android_debugger_connected` and
 *    `automation_artefact_count` is 1, `behavior_threat_level` is `null` with `input_missing`, the two
 *    Play Integrity signals read `strong` and `true` from the sandbox; nothing is declined (C210.5).
 * 2. A clean Android-only body with `sandbox-unrecognized-app`: no indicator signal is `false`
 *    (each `null` with `no_indicator_found`), `bot_score` reads the low band with `no_artefact_found`
 *    and `automation_artefact_count` 0, and the sandbox verdict reads `device` and `false`.
 * Every value is synthetic; no Google endpoint is called (rule 9).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import pg from 'pg';
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

const CONSENT_KEYS = [
  'consent.biometric',
  'consent.processing',
  'notice.session-integrity',
  'notice.play-integrity',
];

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

/** The English Android digest of `key` at `days`, as the SDK reports it (C200.2, C200.4). */
function androidDigest(key: string, days: number): DigestCase {
  const found = DIGESTS.find(
    (entry) =>
      entry.key === key &&
      entry.locale === 'en' &&
      entry.values.days === String(days) &&
      entry.values.organization === undefined,
  );
  if (found === undefined) {
    throw new Error(`no Android digest of ${key} at ${String(days)} days`);
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
      body: text === '' ? null : (JSON.parse(text) as Record<string, unknown> | null),
    };
  };
  const ok = (answer: Answer, status: number, what: string) => {
    expect(answer.status, `${what}: ${JSON.stringify(answer.body)}`).toBe(status);
    return answer.body ?? {};
  };
  return { call, ok };
}

/** Whether the worker stored a verdict for the inquiry (sealed; only its row's presence is read). */
async function verdictStored(stack: StackInfo, inquiryId: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: stack.databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ found: boolean }>(
      'select exists(select 1 from inquiry_integrity_verdicts where inquiry_id = $1) as found',
      [inquiryId],
    );
    return rows[0]?.found === true;
  } finally {
    await client.end();
  }
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
    `e2e device integrity ${randomUUID().slice(0, 8)}`,
    flow,
    members,
  );
});

interface SignalDetail {
  reasons?: string[];
  'null-reason'?: string;
  sources?: { kind: string; provider?: string; sandbox?: boolean }[];
}

/**
 * The 10A flow in English with `androidIntegrity` sent after consent and `token` posted for the
 * session's challenge; answers the frozen signals and their details once the inquiry completes.
 */
async function completedWith(androidIntegrity: Record<string, unknown>, token: string) {
  const stack = readStackInfo();
  const started = await startV2Inquiry(
    stack,
    template.templateId,
    `e2e-device-integrity-${randomUUID()} sandbox-database-nickname`,
  );
  const { call, ok } = androidClient(stack, started.sessionToken);
  const first = ok(await call('GET', '/session'), 200, 'session') as {
    'face-template-retention-days'?: number;
    integrity?: { request: boolean };
  };
  // C211.3: nothing is asked before consent.
  expect(first.integrity?.request ?? false).toBe(false);
  const days = first['face-template-retention-days'];
  if (typeof days !== 'number') {
    throw new Error('the session serves no face-template-retention-days');
  }
  const digests = CONSENT_KEYS.map((key) => androidDigest(key, days));
  ok(
    await call('POST', '/consent', {
      accepted: true,
      'text-keys': CONSENT_KEYS,
      locale: 'en',
      'text-sha256': digests.map((entry) => entry['text-sha256']),
      'copy-source': 'built-in',
      'catalog-version': digests[0]?.['catalog-version'],
    }),
    201,
    'consent',
  );

  // C210.2: one Android signals body, with the indicator lists in `android-integrity`.
  ok(
    await call('POST', '/signals', {
      platform: 'android',
      'collector-version': 1,
      screen: ANDROID_FLOW_STEPS.consent,
      sequence: 0,
      'android-integrity': androidIntegrity,
      'device-class': 'smartphone',
    }),
    202,
    'signals',
  );

  // C211.3: the session asks once; one challenge, one token, decoded by the worker.
  const consented = ok(await call('GET', '/session'), 200, 'session') as {
    integrity?: { request: boolean };
  };
  expect(consented.integrity).toEqual({ request: true });
  const challenge = ok(await call('POST', '/integrity-challenges', {}), 201, 'challenge') as {
    id: string;
    'request-hash': string;
  };
  expect(challenge.id).toMatch(/^ich_/);
  expect(challenge['request-hash']).toMatch(/^[A-Za-z0-9_-]{43}$/);
  ok(
    await call('POST', '/integrity-tokens', { 'challenge-id': challenge.id, token }),
    202,
    'token',
  );
  const asked = ok(await call('GET', '/session'), 200, 'session') as {
    integrity?: { request: boolean };
  };
  expect(asked.integrity).toEqual({ request: false });
  await expect
    .poll(() => verdictStored(stack, started.inquiryId), { timeout: 30_000, intervals: [500] })
    .toBe(true);

  // The rest of the flow, as the SDK reports it.
  const created = ok(await call('POST', '/verifications', { type: 'database' }), 201, 'create');
  const verificationId = (created.data as { id: string }).id;
  ok(await call('POST', `/verifications/${verificationId}/inputs`, PERSON), 200, 'inputs');
  ok(await call('POST', `/verifications/${verificationId}/submit`), 202, 'submit');
  await expect
    .poll(
      async () =>
        (
          ok(await call('GET', '/session'), 200, 'session') as {
            position?: { 'step-id': string };
          }
        ).position?.['step-id'],
      { timeout: 45_000, intervals: [500, 1_000] },
    )
    .toBe(ANDROID_FLOW_STEPS.hello);
  ok(
    await call('POST', `/screens/${ANDROID_FLOW_STEPS.hello}/submit`, { values: {} }),
    200,
    'screen',
  );
  const inquiry = await settledInquiry(stack, started.inquiryId, ['completed']);
  expect(inquiry.status).toBe('completed');

  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  type Attributes = Awaited<ReturnType<typeof client.inquiries.retrieve>>['data']['attributes'];
  let attributes: Attributes | undefined;
  await expect
    .poll(
      async () => {
        attributes = (await client.inquiries.retrieve(started.inquiryId)).data.attributes;
        return attributes['signal-details']?.['computed-at'] ?? null;
      },
      { timeout: 45_000, intervals: [500, 1_000] },
    )
    .not.toBeNull();
  if (attributes === undefined) {
    throw new Error('the inquiry was not read');
  }
  const values = Object.fromEntries(
    (attributes.signals ?? []).map(({ name, value }) => [name, value]),
  );
  const details = (attributes['signal-details'] ?? {}) as unknown as Record<string, SignalDetail>;
  return { values, details, status: attributes.status };
}

test('emulator, hooking and debugger evidence and a strong sandbox verdict reach the signals, and nothing is declined (C210.4, C210.5, C211.5, C224.3)', async () => {
  test.setTimeout(90_000);
  const { values, details, status } = await completedWith(
    {
      'debugger-connected': true,
      'app-debuggable': false,
      'emulator-indicators': [
        'build_hardware_goldfish_or_ranchu',
        'build_product_sdk',
        'qemu_device_file',
      ],
      'root-indicators': [],
      'hooking-indicators': ['frida_thread_name'],
    },
    'sandbox-strong',
  );

  // C210.5: heuristics never decide alone; the flow completed and was not declined.
  expect(status).toBe('completed');
  expect(values['inquiry/device_emulated']).toBe(true);
  expect(details['inquiry/device_emulated']?.reasons).toEqual(
    expect.arrayContaining([
      'build_hardware_goldfish_or_ranchu',
      'build_product_sdk',
      'qemu_device_file',
    ]),
  );
  expect(values['inquiry/device_hooked']).toBe(true);
  expect(details['inquiry/device_hooked']?.reasons).toEqual(['frida_thread_name']);
  // C210.6: a clean probe is never "not rooted".
  expect(values['inquiry/device_rooted']).toBeNull();
  expect(details['inquiry/device_rooted']?.['null-reason']).toBe('no_indicator_found');
  // Stage 1a amendment 17: the debugger is medium evidence and an automation artefact.
  expect(details['inquiry/bot_score']?.reasons).toContain('android_debugger_connected');
  expect(values['inquiry/automation_artefact_count']).toBe(1);
  expect(details['inquiry/automation_artefact_count']?.reasons).toContain(
    'android_debugger_connected',
  );
  expect(values['inquiry/behavior_threat_level']).toBeNull();
  expect(details['inquiry/behavior_threat_level']?.['null-reason']).toBe('input_missing');
  // C211.5: the sandbox provider's verdict, with its provenance.
  expect(values['inquiry/device_integrity_level']).toBe('strong');
  expect(values['inquiry/app_recognized']).toBe(true);
  expect(details['inquiry/app_recognized']?.sources).toEqual([
    expect.objectContaining({ kind: 'provider', provider: 'sandbox', sandbox: true }),
  ]);
});

test('a clean Android-only session reads no indicator as false, the low bot band and an unrecognized app (C210.6, C211.5, C224.3)', async () => {
  test.setTimeout(90_000);
  const { values, details, status } = await completedWith(
    {
      'debugger-connected': false,
      'app-debuggable': false,
      'emulator-indicators': [],
      'root-indicators': [],
      'hooking-indicators': [],
    },
    'sandbox-unrecognized-app',
  );

  expect(status).toBe('completed');
  for (const name of [
    'inquiry/device_emulated',
    'inquiry/device_rooted',
    'inquiry/device_hooked',
  ]) {
    expect(values[name], name).toBeNull();
    expect(details[name]?.['null-reason'], name).toBe('no_indicator_found');
  }
  expect(details['inquiry/bot_score']?.reasons).toEqual(['no_artefact_found']);
  expect(values['inquiry/automation_artefact_count']).toBe(0);
  expect(values['inquiry/behavior_threat_level']).toBeNull();
  expect(details['inquiry/behavior_threat_level']?.['null-reason']).toBe('input_missing');
  expect(values['inquiry/device_integrity_level']).toBe('device');
  expect(values['inquiry/app_recognized']).toBe(false);
});
