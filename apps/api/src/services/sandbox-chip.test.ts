/**
 * C208.1, C208.3, C208.4 (Phase 10, Workflow 10C; `api-nfc`): the sandbox test chip.
 * `POST /api/v1/flow/verifications/:id/sandbox-chip` builds a synthetic Utopia chip for the
 * session's NFC verification and open challenge and answers every file but DG2, which the server
 * attaches itself, with the Active Authentication response over the challenge's nonce. The
 * scenarios' outcomes through the server's real checks are tested against Postgres
 * (`sandbox-chip.integration.test.ts`); here: what the route builds, stores, answers and refuses.
 * Every key, chip, MRZ and image is synthetic.
 */
import { createHash, createPublicKey, verify } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  flowSandboxChipResponseSchema,
  newId,
  type FlowSandboxChipResponse,
} from '@openverify/contracts';
import {
  createVerification,
  decryptBytes,
  getChipChallenge,
  listInquirySessions,
  listVerificationFiles,
  recordInquirySessionConsent,
  recordSessionDeviceFields,
  setVerificationStatus,
} from '@openverify/db';
import { createTestInquiry } from '@openverify/db/testing';
import { parseMrz } from '@openverify/checks';
import { parseDg1, parseDg15, parseDg2, parseSod } from '@openverify/emrtd';
import { flowV2Schema, type FlowV2 } from '@openverify/flow-spec';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { bearer, expectStatus, resumeInquiry, seedVerification } from '../test-support/harness.js';
import { maskPersonalData } from './api-logs.js';
import { td3ExtractionFields } from './chip-challenges/testing.js';
import { createInquiryTestApi, type InquiryTestApi } from './inquiries.test-support.js';
import {
  SANDBOX_CHIP_FACES_ENV,
  SANDBOX_CHIP_OTHER_FACE_FILE,
  sandboxChipLabelOf,
} from './sandbox-chip.js';

let api: InquiryTestApi;
let facesDirectory: string;

/** A synthetic JPEG (magic bytes and padding, no face) standing in for another person's photo. */
const OTHER_FACE = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 9, 8, 7, 6, 5, 0xff, 0xd9,
]);

beforeAll(async () => {
  api = await createInquiryTestApi();
  facesDirectory = await mkdtemp(path.join(tmpdir(), 'openverify-sandbox-faces-'));
  await writeFile(path.join(facesDirectory, SANDBOX_CHIP_OTHER_FACE_FILE), OTHER_FACE);
});

afterAll(async () => {
  await api.close();
  await rm(facesDirectory, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const edge = (id: string, from: string, port: string, to: string) => ({ id, from, port, to });

function v2(name: string, entry: string, steps: unknown[], edges: unknown[]): FlowV2 {
  return flowV2Schema.parse({
    metadata: { specVersion: 2, id: name, version: 1, name },
    entry,
    steps,
    edges,
  });
}

const chip = { id: 'chip', type: 'nfc', androidOnly: true };
const done = { id: 'done', type: 'completion' };
const idCard = {
  id: 'id_card',
  type: 'government_id',
  sides: 'front',
  maxAttempts: 2,
  captureMethods: ['camera'],
};
const AT_CHIP = v2('sandbox-chip', 'chip', [chip, done], [edge('e1', 'chip', 'next', 'done')]);
const CHIP_LATER = v2(
  'sandbox-chip-later',
  'id_card',
  [idCard, chip, done],
  [edge('e0', 'id_card', 'next', 'chip'), edge('e1', 'chip', 'next', 'done')],
);

const MRZ_SOURCES = Object.fromEntries(
  (
    [
      'name-first',
      'name-last',
      'birthdate',
      'sex',
      'nationality',
      'identification-number',
      'expiration-date',
      'issuing-authority-code',
    ] as const
  ).map((field) => [field, ['mrz'] as const]),
);

interface Opened {
  inquiryId: string;
  sessionToken: string;
  verificationId: string;
  selfieVerificationId: string | null;
}

/**
 * A consented session at the `chip` step (an SDK's unless `web`) with a passed selfie holding a
 * centre photo, a passed Utopia passport reading (unless left out) and an `initiated` NFC
 * verification.
 */
async function opened(
  options: { flow?: FlowV2; web?: boolean; selfie?: boolean; governmentId?: boolean } = {},
): Promise<Opened> {
  const { db } = api.database;
  const { inquiry } = await createTestInquiry(db, api.environmentId, {
    flow: options.flow ?? AT_CHIP,
  });
  const sessionToken = await resumeInquiry(api, inquiry.id);
  const [session] = (await listInquirySessions(db, api.environmentId, { inquiryId: inquiry.id }))
    .items;
  if (session === undefined) {
    throw new Error('the inquiry has no session');
  }
  if (options.web !== true) {
    await recordSessionDeviceFields(db, api.environmentId, session.id, {
      osName: 'Android',
      osFullVersion: '14',
      browserName: null,
      browserFullVersion: null,
      deviceType: 'smartphone',
      deviceName: null,
      mobileSdkName: 'openverify-android',
      mobileSdkFullVersion: '0.1.0',
    });
  }
  expectStatus(
    await api.app.inject({
      url: '/api/v1/flow/session',
      headers: { ...bearer(sessionToken), 'openverify-flow-spec': '2' },
    }),
    200,
  );
  await recordInquirySessionConsent(db, api.environmentId, session.id, {
    acceptedAt: new Date(),
    textKeys: ['consent.biometric', 'consent.processing'],
    optionalTextKeys: [],
    locale: 'en',
    ip: null,
    userAgent: null,
  });
  if (options.governmentId !== false) {
    const id = await seedVerification(api, api.environmentId, inquiry.id, {
      type: 'government_id',
      extraction: { fields: td3ExtractionFields(), sources: MRZ_SOURCES },
    });
    await setVerificationStatus(db, api.environmentId, id.id, { to: 'submitted' });
    await setVerificationStatus(db, api.environmentId, id.id, { to: 'passed' });
  }
  let selfieVerificationId: string | null = null;
  if (options.selfie !== false) {
    const selfie = await seedVerification(api, api.environmentId, inquiry.id, {
      type: 'selfie',
      files: ['selfie-center'],
    });
    await setVerificationStatus(db, api.environmentId, selfie.id, { to: 'submitted' });
    await setVerificationStatus(db, api.environmentId, selfie.id, { to: 'passed' });
    selfieVerificationId = selfie.id;
  }
  const verification = await createVerification(db, api.environmentId, {
    id: newId('ver'),
    inquiryId: inquiry.id,
    type: 'government_id_nfc',
  });
  return {
    inquiryId: inquiry.id,
    sessionToken,
    verificationId: verification.id,
    selfieVerificationId,
  };
}

async function challengeOf(target: Opened): Promise<{ id: string; nonce: string }> {
  return expectStatus(
    await api.app.inject({
      method: 'POST',
      url: `/api/v1/flow/verifications/${target.verificationId}/chip-challenges`,
      headers: bearer(target.sessionToken),
      payload: {},
    }),
    201,
  ) as unknown as { id: string; nonce: string };
}

const take = (target: Opened, challengeId: string, scenario?: string) =>
  api.app.inject({
    method: 'POST',
    url: `/api/v1/flow/verifications/${target.verificationId}/sandbox-chip`,
    headers: bearer(target.sessionToken),
    payload: { 'challenge-id': challengeId, ...(scenario === undefined ? {} : { scenario }) },
  });

async function taken(target: Opened, scenario?: string) {
  const challenge = await challengeOf(target);
  const response = await take(target, challenge.id, scenario);
  expect(response.statusCode, response.body).toBe(200);
  const body = flowSandboxChipResponseSchema.parse(response.json());
  return { challenge, body, raw: response.body };
}

const fileOf = (body: FlowSandboxChipResponse, kind: string): Uint8Array => {
  const file = body.files.find((one) => one.kind === kind);
  if (file === undefined) {
    throw new Error(`the answer has no ${kind}`);
  }
  return new Uint8Array(Buffer.from(file.content, 'base64'));
};

/** The latest stored file of `kind` of a verification, decrypted; `null` when it has none. */
async function storedFile(verificationId: string, kind: string): Promise<Uint8Array | null> {
  const file = (await listVerificationFiles(api.database.db, api.environmentId, [verificationId]))
    .filter((one) => one.kind === kind)
    .at(-1);
  if (file === undefined) {
    return null;
  }
  const ciphertext = await api.storage.get(file.storageKey);
  if (ciphertext === null) {
    throw new Error(`the stored ${kind} has no object`);
  }
  return new Uint8Array(
    decryptBytes({ wrappedDek: file.wrappedDek, ciphertext }, api.database.keyring, {
      context: file.id,
    }),
  );
}

const storedDg2 = (verificationId: string) => storedFile(verificationId, 'chip-dg2');

/** The selfie centre photo the harness stored for `target`. */
async function storedBytes(target: Opened): Promise<Uint8Array> {
  const bytes =
    target.selfieVerificationId === null
      ? null
      : await storedFile(target.selfieVerificationId, 'selfie-center');
  if (bytes === null) {
    throw new Error('the selfie centre is gone');
  }
  return bytes;
}

const mrzOf = (body: FlowSandboxChipResponse) =>
  parseMrz(parseDg1(fileOf(body, 'chip-dg1')).mrzLines);

describe('the sandbox-chip route without the test anchor (C208.1)', () => {
  it('answers 409 sandbox_chip_anchor_missing and builds nothing', async () => {
    const target = await opened();
    const challenge = await challengeOf(target);

    const response = await take(target, challenge.id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 'sandbox_chip_anchor_missing',
      detail:
        'The sandbox trust store does not hold the current test anchor; run trust:sandbox-utopia.',
    });
    expect(await storedDg2(target.verificationId)).toBeNull();
    expect(
      (await getChipChallenge(api.database.db, api.environmentId, challenge.id))?.sandboxScenario,
    ).toBeNull();
  });
});

describe('the sandbox-chip route (C208.1)', () => {
  beforeAll(async () => {
    const { installSandboxTrustAnchor } = await import('../trust-anchors/sandbox.js');
    await installSandboxTrustAnchor(api.database.db, { now: api.clock.now() });
  });

  it('answers every file but DG2, which the server attaches from the stored selfie', async () => {
    const target = await opened();

    const { challenge, body, raw } = await taken(target);

    expect(body.files.map((file) => file.kind)).toEqual([
      'chip-sod',
      'chip-dg1',
      'chip-dg14',
      'chip-dg15',
      'chip-com',
    ]);
    expect(body['dg2-attached']).toBe(true);
    const selfie = await storedBytes(target);
    const dg2 = await storedDg2(target.verificationId);
    expect(dg2).not.toBeNull();
    const portrait = parseDg2(dg2 ?? new Uint8Array());
    expect(portrait.mimeType).toBe('image/jpeg');
    expect(Buffer.from(portrait.image).equals(Buffer.from(selfie))).toBe(true);
    // Decision 69, review P15: no image leaves the server.
    expect(raw).not.toContain(Buffer.from(selfie).toString('base64').slice(0, 16));
    expect(raw).not.toContain(
      Buffer.from(dg2 ?? new Uint8Array())
        .toString('base64')
        .slice(0, 24),
    );
    // The SOD the chip's signer signed lists DG2 with the attached file's hash.
    const sod = parseSod(fileOf(body, 'chip-sod'));
    expect(sod.listedDataGroups).toEqual([1, 2, 14, 15]);
    expect(
      (await getChipChallenge(api.database.db, api.environmentId, challenge.id))?.sandboxScenario,
    ).toBe('match');
  });

  it('holds the decided ID’s MRZ in DG1, issued by Utopia', async () => {
    const { body } = await taken(await opened());

    const mrz = mrzOf(body);

    expect(mrz).toMatchObject({
      documentCode: 'P',
      issuingState: 'UTO',
      documentNumber: 'UT1234567',
      birthDate: '900412',
      expirationDate: '310411',
      surname: 'EXAMPLE',
      givenNames: 'AVERY',
      nationality: 'UTO',
    });
  });

  it('holds a fixed synthetic holder without a decided ID, never expired', async () => {
    const { body } = await taken(await opened({ governmentId: false }));

    const mrz = mrzOf(body);

    expect(mrz).toMatchObject({ issuingState: 'UTO', surname: 'SPECIMEN', nationality: 'UTO' });
    const year = api.clock.now().getUTCFullYear() % 100;
    expect(Number(mrz.expirationDate.slice(0, 2))).toBe((year + 5) % 100);
  });

  it('signs the challenge’s nonce with the chip’s own key (Active Authentication)', async () => {
    const { challenge, body } = await taken(await opened());

    const response = body['active-authentication-response'];
    const key = createPublicKey({
      key: Buffer.from(parseDg15(fileOf(body, 'chip-dg15')).spki),
      format: 'der',
      type: 'spki',
    });

    expect(response).toBeDefined();
    expect(
      verify(
        'sha256',
        Buffer.from(challenge.nonce, 'hex'),
        { key, dsaEncoding: 'ieee-p1363' },
        Buffer.from(response ?? '', 'base64'),
      ),
    ).toBe(true);
  });

  it('signs through the prehashed signer of the test chips, with no signer of its own (KP10-40)', async () => {
    const target = await opened();
    const { challenge, body } = await taken(target);
    const { signActiveAuthentication, testKeyPair } = await import('@openverify/emrtd/testing');
    // The key `buildChip` gives the verification's chip, and its answer to the nonce itself.
    const key = testKeyPair(`openverify/sandbox-chip/${target.verificationId}/aa`, {
      kind: 'ec',
      curve: 'P-256',
    });
    const expected = signActiveAuthentication(
      key,
      new Uint8Array(Buffer.from(challenge.nonce, 'hex')),
    );

    expect(body['active-authentication-response']).toBe(Buffer.from(expected).toString('base64'));
    expect(Object.keys(await import('./sandbox-chip.js'))).not.toContain('signNonceDigest');
  });

  it('gives each verification its own Active Authentication key', async () => {
    const first = await taken(await opened());
    const second = await taken(await opened());
    const keyOf = (body: FlowSandboxChipResponse) =>
      createHash('sha256').update(fileOf(body, 'chip-dg15')).digest('hex');

    expect(keyOf(first.body)).not.toBe(keyOf(second.body));
  });

  it('no-active-authentication: a chip without DG14, DG15 or a response', async () => {
    const { challenge, body } = await taken(await opened(), 'no-active-authentication');

    expect(body.files.map((file) => file.kind)).toEqual(['chip-sod', 'chip-dg1', 'chip-com']);
    expect(body).not.toHaveProperty('active-authentication-response');
    expect(parseSod(fileOf(body, 'chip-sod')).listedDataGroups).toEqual([1, 2]);
    expect(
      (await getChipChallenge(api.database.db, api.environmentId, challenge.id))?.sandboxScenario,
    ).toBe('no-active-authentication');
  });

  it('mrz-mismatch: DG1 names another document number than the ID’s', async () => {
    const { body } = await taken(await opened(), 'mrz-mismatch');

    const mrz = mrzOf(body);

    expect(mrz.documentNumber).not.toBe('UT1234567');
    expect(mrz).toMatchObject({ birthDate: '900412', surname: 'EXAMPLE' });
  });

  it('tampered-dg1: a whole chip whose DG1 was changed after signing, recorded as such', async () => {
    const target = await opened();

    const { challenge, body } = await taken(target, 'tampered-dg1');

    // That the changed DG1 no longer hashes as the SOD says is the server's Passive
    // Authentication to prove (`dg_hash_mismatch`, the integration test).
    expect(body.files.map((file) => file.kind)).toContain('chip-dg1');
    expect(parseSod(fileOf(body, 'chip-sod')).listedDataGroups).toEqual([1, 2, 14, 15]);
    expect(
      (await getChipChallenge(api.database.db, api.environmentId, challenge.id))?.sandboxScenario,
    ).toBe('tampered-dg1');
  });

  it('face-mismatch: 422 sandbox_chip_scenario_unavailable where no fixture faces are configured', async () => {
    vi.stubEnv(SANDBOX_CHIP_FACES_ENV, '');
    const target = await opened();
    const challenge = await challengeOf(target);

    const response = await take(target, challenge.id, 'face-mismatch');

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'sandbox_chip_scenario_unavailable',
      detail: 'This sandbox chip scenario is not available on this server.',
    });
    expect(await storedDg2(target.verificationId)).toBeNull();
  });

  it('face-mismatch: 422 where the configured directory lacks the other person’s face', async () => {
    vi.stubEnv(SANDBOX_CHIP_FACES_ENV, path.join(facesDirectory, 'absent'));
    const target = await opened();

    const response = await take(target, (await challengeOf(target)).id, 'face-mismatch');

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: 'sandbox_chip_scenario_unavailable' });
  });

  it('face-mismatch: attaches the fixture face of another person, never the selfie', async () => {
    vi.stubEnv(SANDBOX_CHIP_FACES_ENV, facesDirectory);
    const target = await opened();

    const { body, raw } = await taken(target, 'face-mismatch');

    const portrait = parseDg2((await storedDg2(target.verificationId)) ?? new Uint8Array());
    expect(Buffer.from(portrait.image).equals(Buffer.from(OTHER_FACE))).toBe(true);
    expect(body.files.map((file) => file.kind)).not.toContain('chip-dg2');
    expect(raw).not.toContain(Buffer.from(OTHER_FACE).toString('base64').slice(0, 16));
  });

  it('needs a stored selfie centre for a chip that carries the person’s face (422)', async () => {
    const target = await opened({ selfie: false });

    const response = await take(target, (await challengeOf(target)).id);

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: 'sandbox_chip_scenario_unavailable' });
  });

  it('is taken only by an SDK client (409 for the web flow)', async () => {
    const target = await opened({ web: true });

    const response = await take(target, (await challengeOf(target)).id);

    expect(response.statusCode).toBe(409);
    expect(await storedDg2(target.verificationId)).toBeNull();
  });

  it('is taken only at the current nfc step (409)', async () => {
    const target = await opened({ flow: CHIP_LATER });
    // The challenge route has no position rule of its own, so the row is written directly.
    const response = await take(target, 'chc_01M5CK3190XEVBM5ZXA76E1JSM');

    expect(response.statusCode).toBe(409);
    expect(await storedDg2(target.verificationId)).toBeNull();
  });

  it('refuses a challenge that is unknown, another verification’s, superseded or expired (409 chip_challenge_invalid)', async () => {
    const target = await opened();
    const other = await opened();
    const superseded = await challengeOf(target);
    const current = await challengeOf(target);
    const foreign = await challengeOf(other);

    for (const id of ['chc_01M5CK3190XEVBM5ZXA76E1JSM', foreign.id, superseded.id]) {
      const response = await take(target, id);

      expect(response.statusCode, id).toBe(409);
      expect(response.json(), id).toMatchObject({ code: 'chip_challenge_invalid' });
    }
    expect(await storedDg2(target.verificationId)).toBeNull();

    api.clock.advance(301_000);
    try {
      const expired = await take(target, current.id);
      expect(expired.statusCode).toBe(409);
      expect(expired.json()).toMatchObject({ code: 'chip_challenge_invalid' });
    } finally {
      api.clock.advance(-301_000);
    }
  });

  it('keeps C52.1’s preconditions: another type 422, a submitted verification 409', async () => {
    const target = await opened();
    const challenge = await challengeOf(target);
    const selfie = await createVerification(api.database.db, api.environmentId, {
      id: newId('ver'),
      inquiryId: target.inquiryId,
      type: 'selfie',
    });

    expect((await take({ ...target, verificationId: selfie.id }, challenge.id)).statusCode).toBe(
      422,
    );
    await setVerificationStatus(api.database.db, api.environmentId, target.verificationId, {
      to: 'submitted',
    });
    expect((await take(target, challenge.id)).statusCode).toBe(409);
  });
});

describe('sandboxChipLabelOf (C208.1, C208.4)', () => {
  it('is null for a verification no sandbox chip was built for', async () => {
    const target = await opened();
    await challengeOf(target);

    expect(
      await sandboxChipLabelOf(api.database.db, {
        environmentId: api.environmentId,
        id: target.verificationId,
      }),
    ).toBeNull();
  });

  it('names the scenario of the chip built for the verification, and the verification serves it', async () => {
    const target = await opened();
    await taken(target, 'mrz-mismatch');

    expect(
      await sandboxChipLabelOf(api.database.db, {
        environmentId: api.environmentId,
        id: target.verificationId,
      }),
    ).toBe('mrz-mismatch');
    const served = expectStatus(
      await api.app.inject({
        url: `/api/v1/verifications/${target.verificationId}`,
        headers: bearer(api.token),
      }),
      200,
    );
    expect((served.data as { attributes: Record<string, unknown> }).attributes).toMatchObject({
      'sandbox-chip': 'mrz-mismatch',
    });
  });

  it('keeps the label once a later challenge replaced the one the chip was built for', async () => {
    const target = await opened();
    await taken(target, 'no-active-authentication');
    await challengeOf(target);

    expect(
      await sandboxChipLabelOf(api.database.db, {
        environmentId: api.environmentId,
        id: target.verificationId,
      }),
    ).toBe('no-active-authentication');
  });
});

describe('the API log and a sandbox chip’s files (C208.1)', () => {
  it('nulls files[].content of a logged answer and keeps the rest', () => {
    const base64 = (text: string) => Buffer.from(text).toString('base64');
    const signature = base64('synthetic-signature');
    const answer = {
      files: [
        { kind: 'chip-sod', content: base64('synthetic') },
        { kind: 'chip-dg1', content: base64('synthetic-mrz') },
      ],
      'dg2-attached': true,
      'active-authentication-response': signature,
    };

    expect(maskPersonalData(answer)).toEqual({
      files: [
        { kind: 'chip-sod', content: null },
        { kind: 'chip-dg1', content: null },
      ],
      'dg2-attached': true,
      'active-authentication-response': signature,
    });
  });
});
