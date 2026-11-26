/**
 * C224.3 (Phase 10, Workflow 10C integration-10c): the 10C flow driven through the flow API as the
 * Android SDK drives it, with its `User-Agent` (`OpenVerify-Android/0.1.0`) and `OpenVerify-Flow-Spec:
 * 2` on every request. No Linux runner can drive the SDK's UI, so this is the API-driven client; the
 * SDK's own client runs the same flow (`match`) in `:openverify-sdk:stackTest` (C224.4). The flow is
 * `fixtures/android-10c/flow.json`: consent, the Utopia TD3 passport page as a one-sided ID, person
 * A's selfie (the sandbox upload fallback), then the chip, whose `exhausted` edge leads to a
 * proof-of-address document.
 * Budget: 90 s per test.
 *
 * 1. `match`: the session at the chip step offers the sandbox test chip and the prefilled MRZ to the
 *    SDK only; the challenge is taken first, the chip's files (never DG2, which the server attached)
 *    go up through the real upload route, and the submit carries the chip's signature. Every required
 *    NFC check passes under the sandbox anchor, the verification is labelled `sandbox-chip: match`,
 *    and the inquiry completes.
 * 2. `face-mismatch`: the chip carries another person's face (the generated fixture set,
 *    `OPENVERIFY_SANDBOX_CHIP_FACES`), so the selfie comparison fails `face_mismatch`; the chip's own
 *    integrity still holds.
 * 3. A client that reports `nfc_unavailable` (C207.9): the verification ends `canceled`, the flow
 *    leaves the chip step through `exhausted` to the document, a second report is refused, and the
 *    inquiry, once the bill passes, lands in `needs_review`: a self-asserted report never completes
 *    an inquiry by itself.
 * A sandbox chip proves the flow and the server's checks, never a reader (C208.4). Every value is
 * synthetic: the issuer is Utopia and nothing comes from a real chip or person.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CLIENT_ELAPSED_MS_FIELD,
  DEFAULT_GOVERNMENT_ID_NFC_CHECKS,
  SELFIE_CAPTURE_ID_FIELD,
  SELFIE_CAPTURE_NONCE_FIELD,
  SELFIE_POSE_FILE_KINDS,
  type SelfiePose,
} from '@openverify/contracts';
import { expect, test } from '@playwright/test';
import {
  ANDROID_NFC_FLOW_FILE,
  ANDROID_NFC_FLOW_STEPS,
  type AndroidNfcFlowFixture,
} from '../src/android-nfc-flow.js';
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

const FIXTURE = JSON.parse(readFileSync(ANDROID_NFC_FLOW_FILE, 'utf8')) as AndroidNfcFlowFixture;
const STEPS = ANDROID_NFC_FLOW_STEPS;
const input = (relative: string) => path.join(REPO_ROOT, relative);

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

/** The Android digest of `key` in English at `days`, as the SDK reports it (C200.2, C200.4). */
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

interface SessionView {
  position?: { 'step-id': string; state: string };
  step?: {
    id: string;
    type: string;
    fallbackAvailable?: boolean;
    sandboxChipAvailable?: boolean;
    prefillMrz?: { documentNumber: string; birthDate: string; expiryDate: string };
  };
  'face-template-retention-days'?: number;
}

interface SandboxChip {
  files: { kind: string; content: string }[];
  'dg2-attached': boolean;
  'active-authentication-response'?: string;
}

/** The flow API as the Android SDK calls it. */
function flowClient(stack: StackInfo, sessionToken: string) {
  const call = async (
    method: 'GET' | 'POST',
    route: string,
    body?: unknown,
    form?: FormData,
  ): Promise<Answer> => {
    const response = await fetch(`${stack.apiUrl}/api/v1/flow${route}`, {
      method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${sessionToken}`,
        ...ANDROID_HEADERS,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(form === undefined ? {} : { body: form }),
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
  const idOf = (body: Record<string, unknown>) => (body.data as { id: string }).id;
  const client = {
    call,
    ok,
    async session(): Promise<SessionView> {
      return ok(await call('GET', '/session'), 200, 'session');
    },
    async create(type: string): Promise<string> {
      return idOf(ok(await call('POST', '/verifications', { type }), 201, `create ${type}`));
    },
    /** One file part named `<kind>.bin`, as the SDK names a chip file (C207.1). */
    async upload(
      verificationId: string,
      kind: string,
      bytes: Uint8Array,
      fields: Readonly<Record<string, string>> = {},
    ): Promise<void> {
      const form = new FormData();
      form.append('kind', kind);
      for (const [name, value] of Object.entries(fields)) {
        form.append(name, value);
      }
      form.append('file', new Blob([new Uint8Array(bytes)]), `${kind}.bin`);
      ok(
        await call('POST', `/verifications/${verificationId}/files`, undefined, form),
        201,
        `upload ${kind}`,
      );
    },
    async submit(verificationId: string, body?: unknown): Promise<void> {
      ok(await call('POST', `/verifications/${verificationId}/submit`, body), 202, 'submit');
    },
    /** Polls the verification until it is decided, and answers its status. */
    async settled(verificationId: string): Promise<string> {
      let status = '';
      await expect
        .poll(
          async () => {
            const read = ok(
              await call('GET', `/verifications/${verificationId}`),
              200,
              'verification',
            );
            status = (read.data as { attributes: { status: string } }).attributes.status;
            return ['passed', 'failed', 'needs_review', 'requires_retry', 'canceled'].includes(
              status,
            );
          },
          { timeout: 60_000, intervals: [500, 1_000] },
        )
        .toBe(true);
      return status;
    },
    async at(stepId: string): Promise<SessionView> {
      let last: SessionView = {};
      await expect
        .poll(
          async () => {
            last = await client.session();
            return last.position?.['step-id'];
          },
          { timeout: 45_000, intervals: [500, 1_000] },
        )
        .toBe(stepId);
      return last;
    },
  };
  return client;
}

type FlowClient = ReturnType<typeof flowClient>;

let template: PublishedV2;

test.beforeAll(async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const { flow, ...members } = FIXTURE.version;
  template = await publishV2(
    stack,
    await signedInAdmin(stack),
    `e2e android nfc ${randomUUID().slice(0, 8)}`,
    flow,
    members,
  );
});

/** Consent, the passport page and person A's selfie, as the SDK sends them; the session at the chip. */
async function toTheChipStep() {
  const stack = readStackInfo();
  const started = await startV2Inquiry(
    stack,
    template.templateId,
    `e2e-android-nfc-${randomUUID()}`,
    FIXTURE['inquiry-fields'],
  );
  const client = flowClient(stack, started.sessionToken);

  const first = await client.session();
  expect(first.position).toMatchObject({ 'step-id': STEPS.consent, state: 'active' });
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
  const digests = keys.map((key) => androidDigest(key, days));
  client.ok(
    await client.call('POST', '/consent', {
      accepted: true,
      'text-keys': keys,
      locale: 'en',
      'text-sha256': digests.map((entry) => entry['text-sha256']),
      'copy-source': 'built-in',
      'catalog-version': digests[0]?.['catalog-version'],
    }),
    201,
    'consent',
  );

  await client.at(STEPS.idCard);
  const idCard = await client.create('government-id');
  await client.upload(idCard, 'front', await readFile(input(FIXTURE.inputs['id-front'])));
  await client.submit(idCard);
  expect(await client.settled(idCard)).toBe('passed');

  await client.at(STEPS.face);
  const selfie = await client.create('selfie');
  const capture = (
    client.ok(
      await client.call('POST', `/verifications/${selfie}/selfies`, { method: 'upload' }),
      201,
      'selfie capture',
    ) as { data: { id: string; attributes: { nonce: string; prompts: SelfiePose[] } } }
  ).data;
  let elapsed = 800;
  for (const pose of capture.attributes.prompts) {
    await client.upload(
      selfie,
      SELFIE_POSE_FILE_KINDS[pose],
      await readFile(input(FIXTURE.inputs.selfie[pose])),
      {
        [SELFIE_CAPTURE_ID_FIELD]: capture.id,
        [SELFIE_CAPTURE_NONCE_FIELD]: capture.attributes.nonce,
        [CLIENT_ELAPSED_MS_FIELD]: String(elapsed),
      },
    );
    elapsed += 1_500;
  }
  await client.submit(selfie, { capture: { id: capture.id, nonce: capture.attributes.nonce } });
  // Passed, not reviewed (the fixture holds liveness advisory for uploaded stills), so an inquiry
  // that ends in review below does so for the chip step's reason alone.
  expect(await client.settled(selfie)).toBe('passed');

  const atChip = await client.at(STEPS.chip);
  return { stack, started, client, atChip };
}

/** The chip step with the sandbox test chip: challenge, the server-built chip, uploads, submit. */
async function readSandboxChip(client: FlowClient, scenario: string) {
  const verificationId = await client.create('government-id-nfc');
  // C207.2: the challenge is taken first, before any chip file exists.
  const challenge = client.ok(
    await client.call('POST', `/verifications/${verificationId}/chip-challenges`, {}),
    201,
    'chip challenge',
  ) as { id: string; nonce: string };
  const chip = client.ok(
    await client.call('POST', `/verifications/${verificationId}/sandbox-chip`, {
      'challenge-id': challenge.id,
      scenario,
    }),
    200,
    'sandbox chip',
  ) as unknown as SandboxChip;
  // C208.1: the server attached DG2 itself; no answer carries a face.
  expect(chip['dg2-attached']).toBe(true);
  expect(chip.files.map((file) => file.kind)).not.toContain('chip-dg2');
  expect(chip.files.map((file) => file.kind)).toEqual(
    expect.arrayContaining(['chip-sod', 'chip-dg1']),
  );
  for (const file of chip.files) {
    await client.upload(verificationId, file.kind, Buffer.from(file.content, 'base64'));
  }
  await client.submit(verificationId, {
    chip: {
      'challenge-id': challenge.id,
      nonce: challenge.nonce,
      ...(chip['active-authentication-response'] === undefined
        ? {}
        : { 'active-authentication-response': chip['active-authentication-response'] }),
    },
  });
  return { verificationId, status: await client.settled(verificationId) };
}

async function serverVerification(stack: StackInfo, verificationId: string) {
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const { data } = await client.verifications.retrieve(verificationId);
  return {
    status: data.attributes.status,
    checks: Object.fromEntries(data.attributes.checks.map((check) => [check.name, check])),
    attributes: data.attributes as Record<string, unknown>,
  };
}

test('match: the sandbox test chip is offered to the SDK only, read after its challenge, and passes every required NFC check; the inquiry completes (C207.2, C208, C224.3)', async () => {
  test.setTimeout(90_000);
  const { stack, started, client, atChip } = await toTheChipStep();

  // The nfc client view: the author's fallback, the test chip, and the ID's MRZ key, for the SDK.
  expect(atChip.step).toMatchObject({
    id: STEPS.chip,
    type: 'nfc',
    fallbackAvailable: true,
    sandboxChipAvailable: true,
    prefillMrz: { documentNumber: 'UP7316408', birthDate: '880321', expiryDate: '330913' },
  });
  // (A session no SDK ever used is served neither SDK-only member: api-nfc's
  // `flow-views/nfc-session.contract.test.ts`. The members follow the session's stored client.)

  const read = await readSandboxChip(client, 'match');
  expect(read.status).toBe('passed');
  const verification = await serverVerification(stack, read.verificationId);
  for (const name of DEFAULT_GOVERNMENT_ID_NFC_CHECKS.required) {
    expect(verification.checks[name], name).toMatchObject({
      status: 'passed',
      requirement: 'required',
    });
  }
  expect(verification.checks.id_nfc_passive_authentication_detection?.metadata).toMatchObject({
    integrity: 'established',
    'anchor-sandbox-only': true,
  });
  // C208.4: the verification says it was read from a sandbox test chip, and which.
  expect(verification.attributes['sandbox-chip']).toBe('match');

  const inquiry = await settledInquiry(stack, started.inquiryId, ['completed', 'needs_review']);
  expect(inquiry.status).toBe('completed');
  const record = await stepRecord(stack, started.inquiryId);
  expect(record.find((entry) => entry.stepId === STEPS.chip)?.exitPort).toBe('next');
  expect(record.map((entry) => entry.stepId)).not.toContain(STEPS.papers);
});

test('face-mismatch: a test chip carrying another person’s face fails the selfie comparison, while its integrity holds (C208.1, C62.4)', async () => {
  test.setTimeout(90_000);
  const { stack, client } = await toTheChipStep();

  const read = await readSandboxChip(client, 'face-mismatch');
  expect(read.status).toBe('failed');
  const verification = await serverVerification(stack, read.verificationId);
  expect(verification.checks.id_nfc_selfie_comparison).toMatchObject({
    status: 'failed',
    reasons: ['face_mismatch'],
  });
  expect(verification.checks.id_nfc_passive_authentication_detection).toMatchObject({
    status: 'passed',
  });
  expect(verification.attributes['sandbox-chip']).toBe('face-mismatch');
});

test('nfc_unavailable: a client-unable report takes the chip step’s fallback to the document, and the inquiry lands in needs_review (C207.9, C224.3)', async () => {
  test.setTimeout(90_000);
  const { stack, started, client, atChip } = await toTheChipStep();
  expect(atChip.step?.fallbackAvailable).toBe(true);
  // The author did not acknowledge client-unable for this step: its fallback reviews (the default).
  expect(template.acknowledgements).not.toContain(`client-unable:${STEPS.chip}`);

  const verificationId = await client.create('government-id-nfc');
  const report = client.ok(
    await client.call('POST', `/verifications/${verificationId}/client-unable`, {
      reason: 'nfc_unavailable',
    }),
    200,
    'client-unable',
  );
  // The answer never says where the fallback leads: the client reads the session.
  expect(report).toEqual({ 'verification-id': verificationId, status: 'canceled' });
  const second = await client.call('POST', `/verifications/${verificationId}/client-unable`, {
    reason: 'nfc_unavailable',
  });
  expect(second.status, JSON.stringify(second.body)).toBe(409);

  const atPapers = await client.at(STEPS.papers);
  expect(atPapers.step?.type).toBe('document');
  const document = await client.create('document');
  await client.upload(document, 'document', await readFile(input(FIXTURE.inputs.document)));
  await client.submit(document);
  expect(await client.settled(document)).toBe('passed');

  const inquiry = await settledInquiry(stack, started.inquiryId, ['completed', 'needs_review']);
  expect(inquiry.status).toBe('needs_review');
  const record = await stepRecord(stack, started.inquiryId);
  const chip = record.find((entry) => entry.stepId === STEPS.chip);
  expect(chip?.exitPort).toBe('exhausted');
  expect(chip?.notes).toEqual(
    expect.arrayContaining([
      'client-unable',
      'client-unable-reason:nfc_unavailable',
      'client-unable-platform:android',
    ]),
  );
  expect(chip?.notes).not.toContain('fallback-continue');
  expect((await serverVerification(stack, verificationId)).status).toBe('canceled');
});
