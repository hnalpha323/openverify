/**
 * C52.1 contract: every flow API mutation of a verification, as `/openapi.json` lists them, runs
 * the preconditions first: another inquiry's verification is 404, a redacted inquiry 410, a
 * finished one 409, and without consent 409 where the route needs it. A new route under
 * `/api/v1/flow/verifications/{id}/` fails this test until it is listed here with a valid body.
 */
import { newId, type SupportedVerificationType } from '@openverify/contracts';
import { createVerification, redactInquiryRecords, transitionInquiryStatus } from '@openverify/db';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createInquiry,
  createTemplate,
  createTestApi,
  expectStatus,
  IMAGES,
  multipart,
  resumeInquiry,
  type TestApi,
} from '../../test-support/harness.js';
import { phase5TemplateAttributes } from '../../test-support/phase5-templates.js';

const PREFIX = '/api/v1/flow/verifications/{id}/';

interface Mutation {
  /** The type of verification the route acts on. */
  type: SupportedVerificationType;
  /** Whether it needs consent first. */
  consent: boolean;
  /** A body that passes validation, so the preconditions are what answers. */
  body(): Promise<Pick<InjectOptions, 'payload' | 'headers'>>;
}

const json = (payload: Record<string, unknown>) => () => Promise.resolve({ payload });

const MUTATIONS: Readonly<Record<string, Mutation>> = {
  files: {
    type: 'government_id',
    consent: true,
    body: async () => {
      const form = await multipart({ kind: 'front', file: { bytes: IMAGES.jpeg } });
      return { payload: form.payload, headers: form.headers };
    },
  },
  submit: { type: 'government_id', consent: false, body: json({}) },
  selfies: { type: 'selfie', consent: true, body: json({ method: 'camera' }) },
  inputs: { type: 'database', consent: true, body: json({}) },
  otp: { type: 'phone_number', consent: true, body: json({ 'phone-number': '+15555550100' }) },
  'otp/confirm': { type: 'phone_number', consent: true, body: json({ code: '123456' }) },
  'crypto-challenges': {
    type: 'crypto_wallet',
    consent: true,
    body: json({ 'chain-id': 'eip155:1', 'wallet-address': `0x${'1'.repeat(40)}` }),
  },
  'chip-challenges': { type: 'government_id_nfc', consent: true, body: json({}) },
  // Workflow 10C (C207.9, C208.1): frozen at 501 behind the same preconditions.
  'client-unable': {
    type: 'government_id_nfc',
    consent: true,
    body: json({ reason: 'nfc_unavailable' }),
  },
  'sandbox-chip': {
    type: 'government_id_nfc',
    consent: true,
    body: json({ 'challenge-id': 'chc_01M5CK3190XEVBM5ZXA76E1JSM' }),
  },
};

let api: TestApi;
let templateId: string;
let listed: string[];

beforeAll(async () => {
  // C55.10: the template's phone step publishes only with an SMS sender bound.
  api = await createTestApi();
  templateId = await createTemplate(api, api.token, phase5TemplateAttributes());
  const document = (await api.app.inject({ url: '/openapi.json' })).json<{
    paths: Record<string, Record<string, unknown>>;
  }>();
  listed = Object.entries(document.paths)
    .filter(([path, operations]) => path.startsWith(PREFIX) && 'post' in operations)
    .map(([path]) => path.slice(PREFIX.length))
    .sort();
});

afterAll(async () => {
  await api.close();
});

const CONSENT_BODY = {
  accepted: true,
  'text-keys': ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
  locale: 'en',
};

/** A started inquiry of the Phase 5 template, its session and a verification of `type`. */
async function target(type: SupportedVerificationType, options: { consent: boolean }) {
  const inquiryId = await createInquiry(api, { templateId });
  const token = await resumeInquiry(api, inquiryId);
  expectStatus(await api.app.inject({ url: '/api/v1/flow/session', headers: bearer(token) }), 200);
  if (options.consent) {
    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: '/api/v1/flow/consent',
        headers: bearer(token),
        payload: CONSENT_BODY,
      }),
      201,
    );
  }
  const verification = await createVerification(api.database.db, api.environmentId, {
    id: newId('ver'),
    inquiryId,
    type,
  });
  return { inquiryId, token, verificationId: verification.id };
}

async function call(route: string, token: string, verificationId: string) {
  const mutation = MUTATIONS[route];
  if (mutation === undefined) {
    throw new Error(`no mutation ${route}`);
  }
  const { payload, headers } = await mutation.body();
  return api.app.inject({
    method: 'POST',
    url: `/api/v1/flow/verifications/${verificationId}/${route}`,
    headers: { ...bearer(token), ...headers },
    ...(payload === undefined ? {} : { payload }),
  });
}

describe('flow verification mutations (C52.1)', () => {
  it('lists every one /openapi.json documents', () => {
    expect(listed).toEqual(Object.keys(MUTATIONS).sort());
  });

  describe.each(Object.entries(MUTATIONS))('POST .../%s', (route, mutation) => {
    it("answers 404 for another inquiry's verification", async () => {
      const mine = await target(mutation.type, { consent: true });
      const other = await target(mutation.type, { consent: true });

      expect((await call(route, mine.token, other.verificationId)).statusCode).toBe(404);
    });

    it('answers 409 once the inquiry is finished', async () => {
      const { inquiryId, token, verificationId } = await target(mutation.type, { consent: true });
      await transitionInquiryStatus(api.database.db, api.environmentId, inquiryId, {
        from: 'pending',
        to: 'completed',
      });

      expect((await call(route, token, verificationId)).statusCode).toBe(409);
    });

    it('answers 410 once the inquiry is redacted', async () => {
      const { inquiryId, token, verificationId } = await target(mutation.type, { consent: true });
      await redactInquiryRecords(api.database.db, api.environmentId, inquiryId);

      expect((await call(route, token, verificationId)).statusCode).toBe(410);
    });
  });

  describe.each(Object.entries(MUTATIONS).filter(([, mutation]) => mutation.consent))(
    'POST .../%s',
    (route, mutation) => {
      it('answers 409 without consent', async () => {
        const { token, verificationId } = await target(mutation.type, { consent: false });

        expect((await call(route, token, verificationId)).statusCode).toBe(409);
      });
    },
  );
});
