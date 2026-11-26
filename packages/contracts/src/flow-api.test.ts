import { describe, expect, it } from 'vitest';
import {
  createFlowVerificationBodySchema,
  flowConditionContext,
  flowRedeemOneTimeLinkBodySchema,
  flowRedeemOneTimeLinkResponseSchema,
  flowConsentBodySchema,
  flowConsentResponseSchema,
  flowFileUploadFieldsSchema,
  flowSessionResponseSchema,
  localeSchema,
} from './flow-api.js';
import { defaultInquiryTemplateAttributes } from './inquiry-templates.js';
import { AT_ISO, IDS, TOKENS } from './test-support.js';

const session = {
  inquiry: { id: IDS.inquiry, status: 'pending' },
  flow: defaultInquiryTemplateAttributes().flow,
  verifications: [
    {
      type: 'verification/government-id',
      id: IDS.governmentIdFailed,
      attributes: {
        status: 'failed',
        'retry-hints': [{ name: 'id_blur_detection', reasons: ['image_blurry'] }],
        'created-at': AT_ISO,
        'updated-at': AT_ISO,
      },
    },
  ],
  consent: { 'accepted-at': AT_ISO },
};

describe('GET /api/v1/flow/session response (C3)', () => {
  it('returns the inquiry, flow, verifications and consent', () => {
    expect(flowSessionResponseSchema.parse(session)).toEqual(session);
  });

  it('has a null consent before the user accepts', () => {
    expect(flowSessionResponseSchema.safeParse({ ...session, consent: null }).success).toBe(true);
  });

  it('never exposes checks or the template configuration', () => {
    const withChecks = structuredClone(session) as Record<string, unknown> & typeof session;
    (withChecks.verifications[0]?.attributes as Record<string, unknown>).checks = [];
    expect(flowSessionResponseSchema.safeParse(withChecks).success).toBe(false);
    const withConfig = {
      ...session,
      'verification-config': defaultInquiryTemplateAttributes()['verification-config'],
    };
    expect(flowSessionResponseSchema.safeParse(withConfig).success).toBe(false);
  });

  it('rejects an invalid flow', () => {
    expect(flowSessionResponseSchema.safeParse({ ...session, flow: { steps: [] } }).success).toBe(
      false,
    );
  });

  it('gives transition conditions the inquiry status', () => {
    expect(flowConditionContext(flowSessionResponseSchema.parse(session))).toEqual({
      inquiry: { status: 'pending' },
    });
  });
});

describe('POST /api/v1/flow/consent', () => {
  const body = {
    accepted: true,
    'text-keys': ['consent.biometric', 'consent.processing'],
    locale: 'en',
  };

  it('records explicit acceptance of the shown texts', () => {
    expect(flowConsentBodySchema.parse(body)).toEqual(body);
    expect(flowConsentResponseSchema.parse({ consent: { 'accepted-at': AT_ISO } })).toEqual({
      consent: { 'accepted-at': AT_ISO },
    });
  });

  it.each([
    ['a refusal', { accepted: false }],
    ['no text keys', { 'text-keys': [] }],
    ['a malformed key', { 'text-keys': ['consent biometric'] }],
    ['a malformed locale', { locale: 'English' }],
    ['extra members', { ip: '203.0.113.7' }],
  ])('rejects %s', (_name, change) => {
    expect(flowConsentBodySchema.safeParse({ ...body, ...change }).success).toBe(false);
  });

  it.each(['en', 'es', 'en-US', 'es-419', 'zh-Hant-TW'])('accepts the locale %s', (locale) => {
    expect(localeSchema.safeParse(locale).success).toBe(true);
  });
});

describe('POST /api/v1/flow/verifications', () => {
  it('creates a government ID verification with an optional country and class', () => {
    const body = { type: 'government-id', country: 'US', 'id-class': 'drivers_license' };
    expect(createFlowVerificationBodySchema.parse(body)).toEqual(body);
    expect(createFlowVerificationBodySchema.parse({ type: 'government-id' })).toEqual({
      type: 'government-id',
    });
  });

  it('creates a selfie verification', () => {
    expect(createFlowVerificationBodySchema.parse({ type: 'selfie' })).toEqual({ type: 'selfie' });
  });

  it.each([
    ['the domain type name', { type: 'government_id' }],
    // C50.1: `business` was split into database-business and business-website.
    ['an unsupported type', { type: 'business' }],
    ['a country on a selfie', { type: 'selfie', country: 'US' }],
    ['a lowercase country', { type: 'government-id', country: 'us' }],
    ['an unknown ID class', { type: 'government-id', 'id-class': 'library_card' }],
  ])('rejects %s', (_name, body) => {
    expect(createFlowVerificationBodySchema.safeParse(body).success).toBe(false);
  });
});

describe('POST /api/v1/flow/verifications/:id/files fields', () => {
  it('names the file kind', () => {
    expect(flowFileUploadFieldsSchema.parse({ kind: 'selfie-center' })).toEqual({
      kind: 'selfie-center',
    });
    expect(flowFileUploadFieldsSchema.safeParse({ kind: 'center' }).success).toBe(false);
  });
});

describe('Phase 2 flow session (C19)', () => {
  it('tells the flow whether the environment is sandbox or production', () => {
    for (const kind of ['sandbox', 'production']) {
      const value = { ...session, environment: { kind } };
      expect(flowSessionResponseSchema.parse(value)).toEqual(value);
    }
    expect(
      flowSessionResponseSchema.safeParse({ ...session, environment: { kind: 'staging' } }).success,
    ).toBe(false);
    expect(
      flowSessionResponseSchema.safeParse({
        ...session,
        environment: { kind: 'sandbox', id: IDS.environment },
      }).success,
    ).toBe(false);
  });
});

describe('POST /api/v1/flow/one-time-links/redeem (C10)', () => {
  it('trades the inquiry id and one-time token for a session token', () => {
    const body = { 'inquiry-id': IDS.inquiry, 'one-time-token': TOKENS.oneTimeLink };
    expect(flowRedeemOneTimeLinkBodySchema.parse(body)).toEqual(body);
    const response = { 'session-token': TOKENS.session, 'expires-at': AT_ISO };
    expect(flowRedeemOneTimeLinkResponseSchema.parse(response)).toEqual(response);
  });

  it.each([
    ['a session token instead of a one-time token', { 'one-time-token': TOKENS.session }],
    ['a malformed inquiry id', { 'inquiry-id': 'inq_1' }],
    ['extra members', { 'session-token': TOKENS.session }],
  ])('rejects %s', (_name, change) => {
    const body = { 'inquiry-id': IDS.inquiry, 'one-time-token': TOKENS.oneTimeLink, ...change };
    expect(flowRedeemOneTimeLinkBodySchema.safeParse(body).success).toBe(false);
  });
});
