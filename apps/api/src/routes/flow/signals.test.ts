/**
 * Workflow 7A Stage 3 (`api-signals`; C90.9, C94.2, C94.4, C94.6, P14, P23, V13, V15): the
 * collection tiers and `POST /api/v1/flow/signals`.
 *
 * - `GET /flow/session` reports `signals: null` until the session consented, then the tiers that
 *   apply: session integrity under the notice key with the setting on; device recognition under
 *   its ticked optional key (`consent`) or its notice key (`exempt`). The session records them in
 *   `signals-collected`.
 * - `POST /flow/signals` refuses a body with 409 `consent_required` until the session may collect,
 *   refuses `sandbox-outcome` in production (422 `sandbox_only_value`), keeps only what a tier
 *   allows (recognition dropped without its tier), seals the request's header facts with the
 *   integrity member, ignores a repeated sequence, counts the 201st body, links a device when
 *   recognition recorded an identifier, and gives an SDK session its device type.
 *
 * Every body, user agent and identifier is synthetic.
 */
import { deviceListDocumentSchema, type FlowSignals } from '@openverify/contracts';
import {
  defaultInquiryTemplateAttributes,
  type DefaultInquiryTemplateAttributes,
} from '@openverify/contracts';
import { updateEnvironmentSettings, type EnvironmentSettings } from '@openverify/db';
import { openSessionSignalBodies, seedSessionSignalBody } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  type TestTenant,
} from '../../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const NOTICE = 'notice.session-integrity';
const RECOGNITION_NOTICE = 'notice.device-recognition';
const RECOGNITION_CONSENT = 'consent.device-recognition';

/** The default template with its consent step's keys replaced. */
function templateWith(textKeys: string[], optionalTextKeys: string[] = []) {
  const attributes: DefaultInquiryTemplateAttributes = defaultInquiryTemplateAttributes();
  attributes.flow.steps = attributes.flow.steps.map((step) =>
    step.type === 'consent'
      ? {
          ...step,
          textKeys,
          ...(optionalTextKeys.length === 0 ? {} : { optionalTextKeys }),
        }
      : step,
  );
  return attributes;
}

interface Opened {
  inquiryId: string;
  sessionToken: string;
  sessionId: string;
}

async function openSession(
  options: {
    tenant?: Pick<TestTenant, 'token' | 'environmentId'>;
    textKeys?: string[];
    optionalTextKeys?: string[];
    userAgent?: string;
  } = {},
): Promise<Opened> {
  const token = options.tenant?.token ?? api.token;
  const templateId = await createTemplate(
    api,
    token,
    templateWith(
      options.textKeys ?? ['consent.processing', NOTICE],
      options.optionalTextKeys ?? [],
    ),
  );
  const inquiryId = await createInquiry(api, { token, templateId });
  const sessionToken = await resumeInquiry(api, inquiryId, token);
  await flowSession(sessionToken, options.userAgent);
  const sessions = expectStatus(
    await api.app.inject({
      method: 'GET',
      url: `/api/v1/inquiry-sessions?filter[inquiry-id]=${inquiryId}`,
      headers: bearer(token),
    }),
    200,
  ) as unknown as { data: { id: string }[] };
  return { inquiryId, sessionToken, sessionId: sessions.data[0]?.id ?? '' };
}

async function flowSession(sessionToken: string, userAgent?: string) {
  const document = expectStatus(
    await api.app.inject({
      method: 'GET',
      url: '/api/v1/flow/session',
      headers: {
        ...bearer(sessionToken),
        ...(userAgent === undefined ? {} : { 'user-agent': userAgent }),
      },
    }),
    200,
  ) as unknown as {
    signals: { integrity: boolean; recognition: boolean; 'next-sequence'?: number } | null;
  };
  return document.signals;
}

async function consent(
  sessionToken: string,
  textKeys: string[] = ['consent.processing', NOTICE],
  optionalTextKeys: string[] = [],
) {
  expectStatus(
    await api.app.inject({
      method: 'POST',
      url: '/api/v1/flow/consent',
      headers: bearer(sessionToken),
      payload: {
        accepted: true,
        'text-keys': textKeys,
        ...(optionalTextKeys.length === 0 ? {} : { 'optional-text-keys': optionalTextKeys }),
        locale: 'en',
      },
    }),
    201,
  );
}

async function setCollection(
  environmentId: string,
  setting: NonNullable<EnvironmentSettings['signal-collection']>,
) {
  await updateEnvironmentSettings(api.database.db, environmentId, {
    'signal-collection': setting,
  });
}

const INTEGRITY = {
  webdriver: false,
  'driver-globals': [],
  'ua-headless-marker': false,
  'zero-window-with-focus': false,
  'plugins-inconsistent': false,
  'mime-inconsistent': false,
  'native-function-tampered': false,
  'untrusted-event-count': 0,
  'client-hints': {
    brands: [{ brand: 'Chromium', version: '130' }],
    mobile: false,
    platform: 'Windows',
  },
  timezone: 'Etc/UTC',
  languages: ['en-GB', 'en'],
} satisfies FlowSignals['integrity'];

const BEHAVIOUR = {
  'paste-count': 0,
  'drop-count': 0,
  'autofill-count': 1,
  'correction-count': 2,
  'focus-loss-count': 0,
  'hidden-count': 0,
  'input-event-count': 14,
  'dwell-seconds': 12.5,
  'hidden-seconds': 0,
  'first-input-bucket': '1-5s',
  'typing-cadence': 'variable',
  'pointer-types': ['mouse'],
  'pointer-before-click': 'true',
} satisfies FlowSignals['behaviour'];

const RECOGNITION = {
  screen: {
    'width-bucket': 1920,
    'height-bucket': 1080,
    'color-depth': 24,
    'pixel-ratio-bucket': 1,
  },
  'hardware-concurrency': 8,
  'device-memory': 8,
  'max-touch-points': 0,
  'canvas-digest': 'c'.repeat(64),
  'canvas-noise': false,
  'webgl-vendor': 'Example Vendor',
  'webgl-renderer': 'Example Renderer',
} satisfies FlowSignals['recognition'];

const webBody = (sequence: number, extra: Partial<FlowSignals> = {}): FlowSignals => ({
  platform: 'web',
  'collector-version': 1,
  screen: 'consent',
  sequence,
  integrity: INTEGRITY,
  behaviour: BEHAVIOUR,
  ...extra,
});

const post = (sessionToken: string, body: unknown, headers: Record<string, string> = {}) =>
  api.app.inject({
    method: 'POST',
    url: '/api/v1/flow/signals',
    headers: { ...bearer(sessionToken), ...headers },
    payload: body as Record<string, unknown>,
  });

async function stored(environmentId: string, sessionId: string) {
  return openSessionSignalBodies(api.database.db, environmentId, sessionId);
}

async function sessionAttributes(sessionId: string, token = api.token) {
  const document = expectStatus(
    await api.app.inject({
      method: 'GET',
      url: `/api/v1/inquiry-sessions/${sessionId}`,
      headers: bearer(token),
    }),
    200,
  );
  return document.data.attributes;
}

describe('GET /flow/session: the collection tiers (C94.6, P14)', () => {
  it('reports null before consent, then session integrity under its notice, recorded on the session', async () => {
    const opened = await openSession();
    expect(await flowSession(opened.sessionToken)).toBeNull();
    expect((await sessionAttributes(opened.sessionId))['signals-collected']).toEqual([]);
    await consent(opened.sessionToken);
    expect(await flowSession(opened.sessionToken)).toEqual({
      integrity: true,
      recognition: false,
      'next-sequence': 0,
    });
    expect((await sessionAttributes(opened.sessionId))['signals-collected']).toEqual([
      'session-integrity',
    ]);
  });

  it('collects nothing under a consent step without the notice key, or with the tier off', async () => {
    const plain = await openSession({ textKeys: ['consent.processing'] });
    await consent(plain.sessionToken, ['consent.processing']);
    expect(await flowSession(plain.sessionToken)).toEqual({
      integrity: false,
      recognition: false,
      'next-sequence': 0,
    });
    expect((await sessionAttributes(plain.sessionId))['signals-collected']).toEqual([]);

    const tenant = await api.newTenant();
    await setCollection(tenant.environmentId, {
      'session-integrity': 'off',
      'device-recognition': 'off',
      'device-recognition-basis': null,
    });
    const off = await openSession({ tenant });
    await consent(off.sessionToken);
    expect(await flowSession(off.sessionToken)).toEqual({
      integrity: false,
      recognition: false,
      'next-sequence': 0,
    });
  });

  it('adds device recognition only under its ticked optional key in consent mode', async () => {
    const tenant = await api.newTenant();
    await setCollection(tenant.environmentId, {
      'session-integrity': 'on',
      'device-recognition': 'consent',
      'device-recognition-basis': null,
    });
    const ticked = await openSession({ tenant, optionalTextKeys: [RECOGNITION_CONSENT] });
    await consent(ticked.sessionToken, undefined, [RECOGNITION_CONSENT]);
    expect(await flowSession(ticked.sessionToken)).toEqual({
      integrity: true,
      recognition: true,
      'next-sequence': 0,
    });
    expect(
      [
        ...((await sessionAttributes(ticked.sessionId, tenant.token))[
          'signals-collected'
        ] as string[]),
      ].sort(),
    ).toEqual(['device-recognition', 'session-integrity']);

    const declined = await openSession({ tenant, optionalTextKeys: [RECOGNITION_CONSENT] });
    await consent(declined.sessionToken);
    expect(await flowSession(declined.sessionToken)).toEqual({
      integrity: true,
      recognition: false,
      'next-sequence': 0,
    });
  });

  it('adds device recognition under its notice key in exempt mode', async () => {
    const tenant = await api.newTenant();
    // Made before the switch, which publish would refuse after it (consent_text_missing): at run
    // time a consent without the notice still collects no recognition.
    const unnoticed = await openSession({ tenant });
    await setCollection(tenant.environmentId, {
      'session-integrity': 'on',
      'device-recognition': 'exempt',
      'device-recognition-basis': 'Synthetic recorded basis',
    });
    const keys = ['consent.processing', NOTICE, RECOGNITION_NOTICE];
    const exempt = await openSession({ tenant, textKeys: keys });
    await consent(exempt.sessionToken, keys);
    expect(await flowSession(exempt.sessionToken)).toEqual({
      integrity: true,
      recognition: true,
      'next-sequence': 0,
    });
    await consent(unnoticed.sessionToken);
    expect(await flowSession(unnoticed.sessionToken)).toEqual({
      integrity: true,
      recognition: false,
      'next-sequence': 0,
    });
  });
});

describe('POST /flow/signals (C94.2)', () => {
  it('refuses a body before consent with 409 consent_required, storing nothing', async () => {
    const opened = await openSession();
    const response = await post(opened.sessionToken, webBody(0));
    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('consent_required');
    expect(await stored(api.environmentId, opened.sessionId)).toEqual([]);
  });

  it('refuses a body when no tier applies, with 409 consent_required', async () => {
    const opened = await openSession({ textKeys: ['consent.processing'] });
    await consent(opened.sessionToken, ['consent.processing']);
    const response = await post(opened.sessionToken, webBody(0));
    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('consent_required');
  });

  it('stores the integrity member with the request’s header facts and the behaviour, sealed; a repeat is ignored', async () => {
    const opened = await openSession();
    await consent(opened.sessionToken);
    const headers = {
      'accept-language': 'en-GB,en;q=0.8,*;q=0.1',
      'sec-ch-ua': '"Chromium";v="130", "Not?A_Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    };
    const response = await post(opened.sessionToken, webBody(4), headers);
    expect(response.statusCode).toBe(202);
    expect(response.body).toBe('null');
    expectStatus(
      await post(
        opened.sessionToken,
        webBody(4, { behaviour: { ...BEHAVIOUR, 'paste-count': 9 } }),
      ),
      202,
    );
    const bodies = await stored(api.environmentId, opened.sessionId);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.behaviour).toEqual(BEHAVIOUR);
    expect(bodies[0]?.components).toEqual({
      integrity: INTEGRITY,
      request: {
        acceptLanguages: ['en-GB', 'en'],
        clientHints: {
          brands: [
            { brand: 'Chromium', version: '130' },
            { brand: 'Not?A_Brand', version: '99' },
          ],
          mobile: false,
          platform: 'Windows',
        },
      },
    });
  });

  it('drops recognition sent without its tier, and creates no device', async () => {
    const opened = await openSession();
    await consent(opened.sessionToken);
    expectStatus(await post(opened.sessionToken, webBody(0, { recognition: RECOGNITION })), 202);
    const [only] = await stored(api.environmentId, opened.sessionId);
    expect(only?.components).not.toHaveProperty('recognition');
    const devices = deviceListDocumentSchema.parse(
      expectStatus(
        await api.app.inject({
          method: 'GET',
          url: `/api/v1/devices?filter[inquiry-session-id]=${opened.sessionId}`,
          headers: bearer(api.token),
        }),
        200,
      ),
    );
    expect(devices.data).toEqual([]);
  });

  it('under device recognition, stores the components and links both sessions of one browser to one device', async () => {
    const tenant = await api.newTenant();
    await setCollection(tenant.environmentId, {
      'session-integrity': 'on',
      'device-recognition': 'consent',
      'device-recognition-basis': null,
    });
    const deviceOf = async (sessionId: string) =>
      deviceListDocumentSchema.parse(
        expectStatus(
          await api.app.inject({
            method: 'GET',
            url: `/api/v1/devices?filter[inquiry-session-id]=${sessionId}`,
            headers: bearer(tenant.token),
          }),
          200,
        ),
      ).data;
    const sessions: Opened[] = [];
    for (let index = 0; index < 2; index += 1) {
      const opened = await openSession({ tenant, optionalTextKeys: [RECOGNITION_CONSENT] });
      await consent(opened.sessionToken, undefined, [RECOGNITION_CONSENT]);
      expectStatus(await post(opened.sessionToken, webBody(0, { recognition: RECOGNITION })), 202);
      sessions.push(opened);
    }
    const [first, second] = sessions;
    const [firstDevice] = await deviceOf(first?.sessionId ?? '');
    const [secondDevice] = await deviceOf(second?.sessionId ?? '');
    expect(firstDevice?.id).toBeDefined();
    expect(secondDevice?.id).toBe(firstDevice?.id);
    expect(secondDevice?.attributes).toMatchObject({
      platform: 'web',
      'session-count': 2,
      'fingerprint-randomised': false,
    });
    expect(secondDevice?.attributes['browser-fingerprint']).toMatch(/^[0-9a-f]{64}$/);
    const [body] = await stored(tenant.environmentId, first?.sessionId ?? '');
    expect(body?.components).toMatchObject({ recognition: RECOGNITION });
  });

  it('keeps only recognition when session integrity is off, with no behaviour', async () => {
    const tenant = await api.newTenant();
    await setCollection(tenant.environmentId, {
      'session-integrity': 'off',
      'device-recognition': 'consent',
      'device-recognition-basis': null,
    });
    const opened = await openSession({ tenant, optionalTextKeys: [RECOGNITION_CONSENT] });
    await consent(opened.sessionToken, undefined, [RECOGNITION_CONSENT]);
    expectStatus(await post(opened.sessionToken, webBody(0, { recognition: RECOGNITION })), 202);
    const [body] = await stored(tenant.environmentId, opened.sessionId);
    expect(body?.behaviour).toBeNull();
    expect(body?.components).toEqual({ recognition: RECOGNITION });
  });

  it('takes sandbox-outcome only in a sandbox environment (422 sandbox_only_value in production)', async () => {
    const sandbox = await openSession();
    await consent(sandbox.sessionToken);
    expectStatus(await post(sandbox.sessionToken, webBody(0, { 'sandbox-outcome': 'bot' })), 202);
    expect((await stored(api.environmentId, sandbox.sessionId))[0]?.components).toMatchObject({
      'sandbox-outcome': 'bot',
    });

    const tenant = await api.newTenant({ kind: 'production' });
    const production = await openSession({ tenant });
    await consent(production.sessionToken);
    const refused = await post(production.sessionToken, webBody(0, { 'sandbox-outcome': 'human' }));
    expect(refused.statusCode).toBe(422);
    expect(refused.json<{ code: string }>().code).toBe('sandbox_only_value');
    expect(await stored(tenant.environmentId, production.sessionId)).toEqual([]);
  });

  it('reports the next sequence on GET /flow/session: past the highest stored, and past the counted bodies (K7A-7)', async () => {
    const { sessionToken, sessionId } = await openSession();
    await consent(sessionToken);

    expect(await flowSession(sessionToken)).toMatchObject({ 'next-sequence': 0 });
    expectStatus(await post(sessionToken, webBody(7)), 202);
    expectStatus(await post(sessionToken, webBody(2)), 202);
    expect(await flowSession(sessionToken)).toMatchObject({ 'next-sequence': 8 });
    await api.database.client.query(
      'update inquiry_sessions set signal_bodies_dropped = 3 where id = $1',
      [sessionId],
    );
    expect(await flowSession(sessionToken)).toMatchObject({ 'next-sequence': 11 });
  });

  it('counts the 201st body without storing it (P23)', async () => {
    const opened = await openSession();
    await consent(opened.sessionToken);
    for (let sequence = 0; sequence < 200; sequence += 1) {
      await seedSessionSignalBody(api.database.db, api.environmentId, {
        inquirySessionId: opened.sessionId,
        sequence,
      });
    }
    expectStatus(await post(opened.sessionToken, webBody(500)), 202);
    expect(await stored(api.environmentId, opened.sessionId)).toHaveLength(200);
    const { rows } = await api.database.client.query<{ dropped: number }>(
      'select signal_bodies_dropped as dropped from inquiry_sessions where id = $1',
      [opened.sessionId],
    );
    expect(rows[0]?.dropped).toBe(1);
  });

  it('refuses a handoff session that has not recorded its own consent (V03, P01)', async () => {
    const desktop = await openSession();
    await consent(desktop.sessionToken);
    const phoneToken = await resumeInquiry(api, desktop.inquiryId);
    await flowSession(phoneToken);
    const { rows } = await api.database.client.query<{ id: string }>(
      `update inquiry_sessions
          set handoff_from_session_id = $1, device_handoff_method = 'qr', handoff_redeemed_at = now()
        where inquiry_id = $2 and id <> $1 returning id`,
      [desktop.sessionId, desktop.inquiryId],
    );
    const response = await post(phoneToken, webBody(0));
    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('consent_required');
    expect(await stored(api.environmentId, rows[0]?.id ?? '')).toEqual([]);
    // C96.3 (F13): while the phone's session is active the desktop is locked, so it sends nothing
    // either; it collects again on its own consent once the phone's session ends.
    const locked = await post(desktop.sessionToken, webBody(0));
    expect(locked.statusCode).toBe(409);
    expect(locked.json<{ code: string }>().code).toBe('session_handed_off');
  });

  it('gives an SDK session its device type from its first Android body', async () => {
    const opened = await openSession({ userAgent: 'OpenVerify-Android/1.4.2' });
    await consent(opened.sessionToken);
    const android = (sequence: number, deviceClass: 'smartphone' | 'tablet'): FlowSignals => ({
      platform: 'android',
      'collector-version': 1,
      screen: 'consent',
      sequence,
      'android-integrity': { 'debugger-connected': false, 'app-debuggable': false },
      'android-recognition': { 'android-id': '0f1e2d3c4b5a6978' },
      'device-class': deviceClass,
    });
    expectStatus(await post(opened.sessionToken, android(0, 'tablet')), 202);
    expectStatus(await post(opened.sessionToken, android(1, 'smartphone')), 202);
    expect(await sessionAttributes(opened.sessionId)).toMatchObject({
      'mobile-sdk-name': 'openverify-android',
      'device-type': 'tablet',
    });
    const bodies = await stored(api.environmentId, opened.sessionId);
    // Recognition is off by default: the ANDROID_ID is dropped.
    expect(bodies[0]?.components).toEqual({
      'android-integrity': { 'debugger-connected': false, 'app-debuggable': false },
      'device-class': 'tablet',
    });
    expect(bodies[0]?.behaviour).toBeNull();
  });
});
