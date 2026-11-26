/**
 * C151.10 (Workflow 9B, api-flow-expiry; 9A Stage 3 amendment 21, contracts B44): the per-inquiry
 * expiry windows through the API. `POST /inquiries`' `meta` sets the creation window (`expires-at`)
 * and stores the other three for that inquiry only; the inquiry serves them (`null` when its
 * version decides); the start, a resume (`POST /inquiries/:id/resume`) and a one-time link
 * redemption apply them, before the version's settings. Every value is synthetic.
 */
import {
  defaultInquiryTemplateAttributes,
  flowRedeemOneTimeLinkResponseSchema,
  generateOneTimeLinkDocumentSchema,
  inquiryDocumentSchema,
  parseOneTimeLinkFragment,
  resumeInquiryDocumentSchema,
  type TemplateSettings,
} from '@openverify/contracts';
import { getInquiry } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openInquiry } from '../services/flow-preconditions.js';
import { startInquiry } from '../services/inquiries.js';
import { createInquiryTestApi, type InquiryTestApi } from '../services/inquiries.test-support.js';
import { bearer, createTemplate, expectStatus } from '../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const OWN_WINDOWS = {
  'expiration-after-create-interval-seconds': 3_600,
  'expiration-after-start-interval-seconds': 7_200,
  'expiration-after-resume-interval-seconds': 172_800,
  'one-time-link-expiration-seconds': 900,
} as const;

const NO_WINDOWS = {
  'expiration-after-start-interval-seconds': null,
  'expiration-after-resume-interval-seconds': null,
  'one-time-link-expiration-seconds': null,
} as const;

function templateWith(settings: TemplateSettings): Promise<string> {
  return createTemplate(api, api.token, { ...defaultInquiryTemplateAttributes(), settings });
}

function postInquiry(templateId: string, meta?: Record<string, unknown>) {
  return api.app.inject({
    method: 'POST',
    url: '/api/v1/inquiries',
    headers: bearer(api.token),
    payload: {
      data: { type: 'inquiry', attributes: { 'inquiry-template-id': templateId } },
      ...(meta === undefined ? {} : { meta }),
    },
  });
}

async function created(templateId: string, meta?: Record<string, unknown>) {
  return inquiryDocumentSchema.parse(expectStatus(await postInquiry(templateId, meta), 201)).data;
}

async function stored(inquiryId: string) {
  const row = await getInquiry(api.database.db, api.environmentId, inquiryId);
  if (row === null) throw new Error('no inquiry');
  return row;
}

async function resume(inquiryId: string) {
  const response = await api.app.inject({
    method: 'POST',
    url: `/api/v1/inquiries/${inquiryId}/resume`,
    headers: bearer(api.token),
  });
  return resumeInquiryDocumentSchema.parse(expectStatus(response, 200));
}

async function linkFor(inquiryId: string) {
  const response = await api.app.inject({
    method: 'POST',
    url: `/api/v1/inquiries/${inquiryId}/generate-one-time-link`,
    headers: bearer(api.token),
  });
  const document = generateOneTimeLinkDocumentSchema.parse(expectStatus(response, 200));
  const credentials = parseOneTimeLinkFragment(new URL(document.meta['one-time-link']).hash);
  if (credentials === null) throw new Error('the one-time link carries no credentials');
  return credentials;
}

function redeem(credentials: { inquiryId: string; oneTimeToken: string }) {
  return api.app.inject({
    method: 'POST',
    url: '/api/v1/flow/one-time-links/redeem',
    payload: {
      'inquiry-id': credentials.inquiryId,
      'one-time-token': credentials.oneTimeToken,
    },
    remoteAddress: '203.0.113.41',
  });
}

describe('POST /inquiries with meta.expiration-after-* (C151.10)', () => {
  it('sets expires-at from the creation window and stores and serves the other three', async () => {
    const templateId = await templateWith({ 'inquiry-expiration-seconds': 600 });

    const inquiry = await created(templateId, OWN_WINDOWS);

    expect(inquiry.attributes).toMatchObject({
      'expires-at': new Date(api.clock.now().getTime() + HOUR).toISOString(),
      'expiration-after-start-interval-seconds': 7_200,
      'expiration-after-resume-interval-seconds': 172_800,
      'one-time-link-expiration-seconds': 900,
    });
    expect(await stored(inquiry.id)).toMatchObject({
      expiresAt: new Date(api.clock.now().getTime() + HOUR),
      expirationAfterStartSeconds: 7_200,
      expirationAfterResumeSeconds: 172_800,
      oneTimeLinkExpirationSeconds: 900,
    });
    const read = await api.app.inject({
      url: `/api/v1/inquiries/${inquiry.id}`,
      headers: bearer(api.token),
    });
    expect(inquiryDocumentSchema.parse(expectStatus(read, 200)).data.attributes).toMatchObject({
      'expiration-after-start-interval-seconds': 7_200,
      'expiration-after-resume-interval-seconds': 172_800,
      'one-time-link-expiration-seconds': 900,
    });
    const event = api.events
      .named('inquiry.created')
      .find((entry) => (entry.payload as { data: { id: string } }).data.id === inquiry.id);
    expect((event?.payload as { data: { attributes: unknown } }).data.attributes).toMatchObject({
      'expiration-after-resume-interval-seconds': 172_800,
    });
  });

  it('serves null for each window the inquiry left to its version, and a sibling keeps the version’s', async () => {
    const templateId = await templateWith({ 'inquiry-expiration-seconds': 600 });
    await created(templateId, OWN_WINDOWS);

    const sibling = await created(templateId);

    expect(sibling.attributes).toMatchObject({
      'expires-at': new Date(api.clock.now().getTime() + 600_000).toISOString(),
      ...NO_WINDOWS,
    });
    const partial = await created(templateId, { 'one-time-link-expiration-seconds': 300 });
    expect(partial.attributes).toMatchObject({
      'expires-at': new Date(api.clock.now().getTime() + 600_000).toISOString(),
      'expiration-after-start-interval-seconds': null,
      'expiration-after-resume-interval-seconds': null,
      'one-time-link-expiration-seconds': 300,
    });
  });

  it('takes C11’s bounds, 300 to 2,592,000 seconds, and refuses a window outside them or an unknown key', async () => {
    const templateId = await templateWith({});
    const bounded = await created(templateId, {
      'expiration-after-create-interval-seconds': 2_592_000,
      'expiration-after-start-interval-seconds': 300,
      'expiration-after-resume-interval-seconds': 2_592_000,
      'one-time-link-expiration-seconds': 300,
    });
    expect(bounded.attributes['expires-at']).toBe(
      new Date(api.clock.now().getTime() + 30 * DAY).toISOString(),
    );

    for (const meta of [
      { 'expiration-after-start-interval-seconds': 299 },
      { 'expiration-after-resume-interval-seconds': 2_592_001 },
      { 'one-time-link-expiration-seconds': 0 },
      { 'expiration-after-create-interval-seconds': 1.5 },
      { 'expiration-after-resume-interval-seconds': null },
      { 'expires-in-seconds': 600 },
    ]) {
      const response = await postInquiry(templateId, meta);
      expect(response.statusCode, JSON.stringify(meta)).toBe(400);
    }
  });
});

describe('the inquiry’s own windows at the start and on a resume (C151.10)', () => {
  it('a resume moves the expiry to now plus the inquiry’s after-resume window, served in its answer', async () => {
    const templateId = await templateWith({ 'inquiry-expiration-after-resume-seconds': 3_600 });
    const inquiry = await created(templateId, {
      'expiration-after-resume-interval-seconds': 172_800,
    });
    api.clock.advance(10 * MINUTE);

    const resumed = await resume(inquiry.id);

    const expected = new Date(api.clock.now().getTime() + 2 * DAY);
    expect(resumed.data.attributes['expires-at']).toBe(expected.toISOString());
    expect((await stored(inquiry.id)).expiresAt).toEqual(expected);
  });

  it('a resume without an own window takes the version’s, and never shortens the expiry', async () => {
    const templateId = await templateWith({
      'inquiry-expiration-seconds': 600,
      'inquiry-expiration-after-resume-seconds': 3_600,
    });
    const inquiry = await created(templateId);
    api.clock.advance(5 * MINUTE);

    const resumed = await resume(inquiry.id);
    const expected = new Date(api.clock.now().getTime() + HOUR);
    expect(resumed.data.attributes['expires-at']).toBe(expected.toISOString());

    const later = await created(
      await templateWith({ 'inquiry-expiration-after-resume-seconds': 3_600 }),
    );
    const before = (await stored(later.id)).expiresAt;
    await resume(later.id);
    expect((await stored(later.id)).expiresAt).toEqual(before);
  });

  it('a refused resume moves nothing', async () => {
    const templateId = await templateWith({ 'inquiry-expiration-seconds': 600 });
    const inquiry = await created(templateId, {
      'expiration-after-resume-interval-seconds': 172_800,
    });
    await api.app.inject({
      method: 'POST',
      url: `/api/v1/inquiries/${inquiry.id}/expire`,
      headers: bearer(api.token),
    });
    const before = (await stored(inquiry.id)).expiresAt;

    const response = await api.app.inject({
      method: 'POST',
      url: `/api/v1/inquiries/${inquiry.id}/resume`,
      headers: bearer(api.token),
    });

    expect(response.statusCode).toBe(409);
    expect((await stored(inquiry.id)).expiresAt).toEqual(before);
  });

  it('the start moves the expiry to started-at plus the inquiry’s after-start window', async () => {
    const templateId = await templateWith({ 'inquiry-expiration-after-start-seconds': 1_800 });
    const inquiry = await created(templateId, {
      'expiration-after-start-interval-seconds': 7_200,
    });
    const token = (await resume(inquiry.id)).meta['session-token'];
    api.clock.advance(MINUTE);

    expectStatus(
      await api.app.inject({ url: '/api/v1/flow/session', headers: bearer(token) }),
      200,
    );

    const row = await stored(inquiry.id);
    expect(row.status).toBe('pending');
    expect(row.expiresAt).toEqual(new Date((row.startedAt ?? new Date(0)).getTime() + 2 * HOUR));
  });
});

describe('a start outside the engine applies the after-start window too (FE2, K9-28)', () => {
  it('openInquiry, which a flow write calls first, moves the expiry to started-at plus the window', async () => {
    const templateId = await templateWith({});
    const inquiry = await created(templateId, {
      'expiration-after-start-interval-seconds': 7_200,
    });
    await resume(inquiry.id);
    api.clock.advance(MINUTE);

    await openInquiry(api.deps, {
      id: 'iqse_synthetic',
      environmentId: api.environmentId,
      inquiryId: inquiry.id,
    });

    const row = await stored(inquiry.id);
    expect(row.status).toBe('pending');
    expect(row.expiresAt).toEqual(new Date((row.startedAt ?? new Date(0)).getTime() + 2 * HOUR));
  });

  it('startInquiry, which getFlowSession falls back to for a flow it cannot walk, takes the version’s window', async () => {
    const templateId = await templateWith({ 'inquiry-expiration-after-start-seconds': 1_800 });
    const inquiry = await created(templateId);
    api.clock.advance(MINUTE);

    await startInquiry(api.deps, await stored(inquiry.id));

    const row = await stored(inquiry.id);
    expect(row.status).toBe('pending');
    expect(row.expiresAt).toEqual(new Date((row.startedAt ?? new Date(0)).getTime() + 30 * MINUTE));
  });

  it('never revives an inquiry already past its expiry, and changes nothing without a window', async () => {
    const templateId = await templateWith({ 'inquiry-expiration-after-start-seconds': null });
    const inquiry = await created(templateId);
    const before = (await stored(inquiry.id)).expiresAt;

    await startInquiry(api.deps, await stored(inquiry.id));

    expect((await stored(inquiry.id)).expiresAt).toEqual(before);
  });
});

describe('a one-time link redemption applies the after-resume window (C151.10)', () => {
  it('moves the expiry to now plus the inquiry’s own window when the link is redeemed', async () => {
    const templateId = await templateWith({});
    const inquiry = await created(templateId, {
      'expiration-after-resume-interval-seconds': 172_800,
    });
    const credentials = await linkFor(inquiry.id);
    api.clock.advance(10 * MINUTE);

    flowRedeemOneTimeLinkResponseSchema.parse(expectStatus(await redeem(credentials), 200));

    expect((await stored(inquiry.id)).expiresAt).toEqual(
      new Date(api.clock.now().getTime() + 2 * DAY),
    );
  });

  it('takes the version’s window without an own one, and a refused redemption moves nothing', async () => {
    const templateId = await templateWith({
      'inquiry-expiration-seconds': 600,
      'inquiry-expiration-after-resume-seconds': 3_600,
    });
    const inquiry = await created(templateId);
    const credentials = await linkFor(inquiry.id);
    api.clock.advance(MINUTE);

    expectStatus(await redeem(credentials), 200);
    const extended = new Date(api.clock.now().getTime() + HOUR);
    expect((await stored(inquiry.id)).expiresAt).toEqual(extended);

    api.clock.advance(10 * MINUTE);
    expect((await redeem(credentials)).statusCode).toBe(401);
    expect((await stored(inquiry.id)).expiresAt).toEqual(extended);
  });
});

describe('a one-time link takes the inquiry’s own lifetime at creation (C151.10)', () => {
  async function generate(inquiryId: string, meta?: Record<string, unknown>) {
    const response = await api.app.inject({
      method: 'POST',
      url: `/api/v1/inquiries/${inquiryId}/generate-one-time-link`,
      headers: bearer(api.token),
      ...(meta === undefined ? {} : { payload: { meta } }),
    });
    return generateOneTimeLinkDocumentSchema.parse(expectStatus(response, 200)).meta;
  }

  it('lives for the inquiry’s window without expires-in-seconds, and the request’s with it', async () => {
    const templateId = await templateWith({ 'one-time-link-expiration-seconds': 3_600 });
    const inquiry = await created(templateId, { 'one-time-link-expiration-seconds': 900 });

    const own = await generate(inquiry.id);
    expect(own['expires-at']).toBe(new Date(api.clock.now().getTime() + 900_000).toISOString());

    const requested = await generate(inquiry.id, { 'expires-in-seconds': 600 });
    expect(requested['expires-at']).toBe(
      new Date(api.clock.now().getTime() + 600_000).toISOString(),
    );
  });

  it('takes the version’s lifetime for an inquiry without its own', async () => {
    const templateId = await templateWith({ 'one-time-link-expiration-seconds': 1_200 });
    const inquiry = await created(templateId);

    expect((await generate(inquiry.id))['expires-at']).toBe(
      new Date(api.clock.now().getTime() + 1_200_000).toISOString(),
    );
  });
});
