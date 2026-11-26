/**
 * Workflow 10B (`api-integrity`; C224.4): the Android SDK's integrity request fixtures, written by
 * `device-integrity-android`'s MockEngine tests and listed in
 * `contracts/fixtures/flow-requests/android/index.json`, are what the server takes:
 * - each parses with its contract schema (`flowSignalsSchema`, `flowIntegrityChallengeBodySchema`,
 *   `flowIntegrityTokenBodySchema`);
 * - the challenge body draws a challenge from the built route, and the token body, bound to that
 *   challenge, is taken (202); the fixture's own challenge id, unknown here, is 409;
 * - the `android-integrity` member reaches the three device signals and the debugger rules.
 * Every value is synthetic.
 */
import { readFileSync } from 'node:fs';
import { computeInquirySignals, type SignalBodyInput } from '@openverify/checks';
import {
  defaultInquiryTemplateAttributes,
  flowIntegrityChallengeBodySchema,
  flowIntegrityChallengeSchema,
  flowIntegrityTokenBodySchema,
  flowSignalsSchema,
} from '@openverify/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProviderBindings } from '../../ports.js';
import { createDeviceIntegrityProvider } from '../../services/device-integrity/index.js';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import {
  bearer,
  createInquiry,
  createTemplate,
  expectStatus,
  resumeInquiry,
} from '../../test-support/harness.js';

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../../contracts/fixtures/flow-requests/android/${name}`, import.meta.url),
      'utf8',
    ),
  );

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi({
    providers: {
      sandbox: { deviceIntegrity: createDeviceIntegrityProvider('sandbox') },
      production: {},
    } satisfies ProviderBindings,
  });
});

afterAll(async () => {
  await api.close();
});

const NOTICE_KEYS = ['consent.processing', 'notice.session-integrity', 'notice.play-integrity'];

async function consentedSession(): Promise<string> {
  const attributes = defaultInquiryTemplateAttributes();
  attributes.flow.steps = attributes.flow.steps.map((step) =>
    step.type === 'consent' ? { ...step, textKeys: NOTICE_KEYS } : step,
  );
  const templateId = await createTemplate(api, api.token, attributes);
  const sessionToken = await resumeInquiry(api, await createInquiry(api, { templateId }));
  expectStatus(
    await api.app.inject({
      method: 'POST',
      url: '/api/v1/flow/consent',
      headers: bearer(sessionToken),
      payload: { accepted: true, 'text-keys': NOTICE_KEYS, locale: 'en' },
    }),
    201,
  );
  return sessionToken;
}

describe('the Android integrity request fixtures (C224.4)', () => {
  it('parse with their contract schemas', () => {
    expect(
      flowIntegrityChallengeBodySchema.safeParse(fixture('integrity-challenge.json')).success,
    ).toBe(true);
    expect(flowIntegrityTokenBodySchema.safeParse(fixture('integrity-token.json')).success).toBe(
      true,
    );
    expect(flowSignalsSchema.safeParse(fixture('signals-android-integrity.json')).success).toBe(
      true,
    );
  });

  it('draw a challenge and post a token through the built routes', async () => {
    const sessionToken = await consentedSession();
    const challenge = flowIntegrityChallengeSchema.parse(
      expectStatus(
        await api.app.inject({
          method: 'POST',
          url: '/api/v1/flow/integrity-challenges',
          headers: bearer(sessionToken),
          payload: fixture('integrity-challenge.json') as Record<string, unknown>,
        }),
        201,
      ),
    );
    const body = fixture('integrity-token.json') as Record<string, unknown>;

    const unknown = await api.app.inject({
      method: 'POST',
      url: '/api/v1/flow/integrity-tokens',
      headers: bearer(sessionToken),
      payload: body,
    });
    expect(unknown.statusCode).toBe(409);
    const taken = await api.app.inject({
      method: 'POST',
      url: '/api/v1/flow/integrity-tokens',
      headers: bearer(sessionToken),
      payload: { ...body, 'challenge-id': challenge.id },
    });
    expect(taken.statusCode).toBe(202);
  });

  it('reach the device signals and the debugger rules', () => {
    const signals = flowSignalsSchema.parse(fixture('signals-android-integrity.json'));
    const body: SignalBodyInput = {
      screen: signals.screen,
      screenType: 'consent',
      sequence: signals.sequence,
      platform: signals.platform,
      androidIntegrity: signals['android-integrity'] ?? null,
    };
    const at = new Date('2026-11-09T12:00:00.000Z');
    const result = computeInquirySignals({
      environment: 'sandbox',
      collect: 'default',
      computedAt: at,
      governmentIdCountry: null,
      sessions: [
        {
          id: 'iqse_a',
          createdAt: at,
          consented: true,
          signalsCollected: ['session-integrity'],
          userAgent: null,
          network: null,
          bodies: [body],
          handoffFromSessionId: null,
        },
      ],
    });
    const detail = (name: string) => result.details[name as keyof typeof result.details];

    expect(detail('inquiry/device_emulated')).toMatchObject({
      'null-reason': null,
      reasons: ['build_hardware_goldfish_or_ranchu', 'build_product_sdk', 'build_model_emulator'],
    });
    expect(detail('inquiry/device_rooted')).toMatchObject({ 'null-reason': 'no_indicator_found' });
    expect(detail('inquiry/device_hooked')).toMatchObject({ reasons: ['frida_thread_name'] });
    expect(detail('inquiry/bot_score')).toMatchObject({
      reasons: ['no_artefact_found', 'android_app_debuggable'],
    });
  });
});
