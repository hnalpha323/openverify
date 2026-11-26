import { describe, expect, it } from 'vitest';
import { flowSessionResponseSchema } from './flow-api.js';
import {
  flowHandoffSchema,
  HANDOFF_STATES,
  createHandoffBodySchema,
  createHandoffResponseSchema,
  currentHandoffResponseSchema,
  declineHandoffBodySchema,
  handoffUrlFragment,
  isHandoffDone,
  parseHandoffFragment,
  previewHandoffResponseSchema,
  redeemHandoffBodySchema,
} from './handoffs.js';
import { buildInquirySessionResource } from './inquiry-sessions.js';
import { SUPPORTED_FLOW_STEP_TYPES } from './inquiry-templates.js';
import { PII_SIGNAL_ATTRIBUTES } from './signal-pii.js';
import {
  TEMPLATE_SETTINGS_DEFAULTS,
  resolveTemplateSettings,
  templateSettingsSchema,
  type TemplateSettings,
} from './template-settings.js';
import { AT, AT_ISO, IDS, LATER, LATEST, readFixture } from './test-support.js';
import { newHandoffToken } from './tokens.js';
import { STEP_VERIFICATION_TYPES } from './verification-types.js';

const TOKEN = newHandoffToken(() => new Uint8Array(32).fill(7));
const HANDOFF = 'hnd_01J00000000000000000000000';

describe('the handoff state (C96.3, F01, V05)', () => {
  it('names the states, and only redeemed, continued_here and skipped are done', () => {
    expect(HANDOFF_STATES).toEqual([
      'pending',
      'issued',
      'redeemed',
      'continued_here',
      'skipped',
      'rejected',
      'declined',
    ]);
    expect(HANDOFF_STATES.filter((state) => isHandoffDone(state))).toEqual([
      'redeemed',
      'continued_here',
      'skipped',
    ]);
  });

  it('is served on GET /flow/session with the phone context (F30)', () => {
    const fixture = readFixture('api/flow-session.json') as Record<string, unknown>;
    expect(
      flowSessionResponseSchema.safeParse({
        ...fixture,
        handoff: { 'step-id': 'handoff', state: 'issued' },
        'handoff-context': {
          'organization-display-name': 'Example Org',
          steps: ['consent', 'government_id', 'selfie'],
          'started-at': AT_ISO,
          'issuing-country-code': 'ZZ',
          attribution: 'IP geolocation by DB-IP',
        },
      }).success,
    ).toBe(true);
    expect(
      flowSessionResponseSchema.safeParse({
        ...fixture,
        handoff: { 'step-id': 'h', state: 'done' },
      }).success,
    ).toBe(false);
  });
});

describe('the handoff routes (C96.3)', () => {
  it('issues by QR with no destination, and by email or SMS with one', () => {
    expect(createHandoffBodySchema.safeParse({ method: 'qr' }).success).toBe(true);
    expect(
      createHandoffBodySchema.safeParse({ method: 'email', destination: 'person@example.org' })
        .success,
    ).toBe(true);
    expect(createHandoffBodySchema.safeParse({ method: 'email' }).success).toBe(false);
    expect(
      createHandoffBodySchema.safeParse({ method: 'qr', destination: 'person@example.org' })
        .success,
    ).toBe(false);
  });

  it('answers the QR fragment, and no token for a sent link', () => {
    const fragment = handoffUrlFragment(IDS.inquiry, TOKEN);
    expect(fragment).toBe(`#inquiry-id=${IDS.inquiry}&handoff-token=${TOKEN}`);
    expect(parseHandoffFragment(fragment)).toEqual({ inquiryId: IDS.inquiry, handoffToken: TOKEN });
    expect(parseHandoffFragment(`#inquiry-id=${IDS.inquiry}&session-token=x`)).toBeNull();
    expect(() => handoffUrlFragment(IDS.inquiry, 'ovo_x')).toThrow(TypeError);
    expect(
      createHandoffResponseSchema.safeParse({
        id: HANDOFF,
        method: 'qr',
        'expires-at': AT_ISO,
        'url-fragment': fragment,
      }).success,
    ).toBe(true);
    expect(
      createHandoffResponseSchema.safeParse({
        id: HANDOFF,
        method: 'email',
        'expires-at': AT_ISO,
        'url-fragment': fragment,
      }).success,
    ).toBe(false);
  });

  it('answers the confirmation code the desktop shows, six digits, only when one is asked (C96.5)', () => {
    const fragment = handoffUrlFragment(IDS.inquiry, TOKEN);
    const answer = { id: HANDOFF, method: 'qr', 'expires-at': AT_ISO, 'url-fragment': fragment };
    expect(
      createHandoffResponseSchema.safeParse({ ...answer, 'confirmation-code': '042917' }).success,
    ).toBe(true);
    expect(
      createHandoffResponseSchema.safeParse({
        id: HANDOFF,
        method: 'email',
        'expires-at': AT_ISO,
        'confirmation-code': '042917',
      }).success,
    ).toBe(true);
    expect(
      createHandoffResponseSchema.safeParse({ ...answer, 'confirmation-code': '42917' }).success,
    ).toBe(false);
  });

  it('takes the token on the phone routes, and a six-digit code where asked', () => {
    const body = { 'inquiry-id': IDS.inquiry, 'handoff-token': TOKEN };
    expect(declineHandoffBodySchema.safeParse(body).success).toBe(true);
    expect(
      redeemHandoffBodySchema.safeParse({ ...body, 'confirmation-code': '123456' }).success,
    ).toBe(true);
    expect(
      redeemHandoffBodySchema.safeParse({ ...body, 'confirmation-code': '12345' }).success,
    ).toBe(false);
    expect(redeemHandoffBodySchema.safeParse({ ...body, 'handoff-token': 'ovo_x' }).success).toBe(
      false,
    );
  });

  it('previews only the organisation and the method for an unconfirmed destination (V16)', () => {
    expect(
      previewHandoffResponseSchema.safeParse({
        'organization-display-name': 'Example Org',
        method: 'sms',
        'confirmation-code-required': true,
        context: null,
      }).success,
    ).toBe(true);
  });

  it('names the phone only after redemption', () => {
    expect(
      currentHandoffResponseSchema.safeParse({
        status: 'redeemed',
        'redeemed-at': AT_ISO,
        'os-name': 'Android',
        'browser-name': 'Chrome',
      }).success,
    ).toBe(true);
    expect(
      currentHandoffResponseSchema.safeParse({
        status: 'issued',
        'redeemed-at': null,
        'os-name': 'Android',
        'browser-name': null,
      }).success,
    ).toBe(false);
  });

  it('marks the destination PII (C107.5)', () => {
    expect(PII_SIGNAL_ATTRIBUTES).toContain('destination');
  });
});

describe('the handoff session fields (C91.1, C96.4)', () => {
  it('serves the method, the issuing session and the distance facts of a redeemed session', () => {
    const session = buildInquirySessionResource({
      id: IDS.inquirySession,
      inquiryId: IDS.inquiry,
      status: 'active',
      createdAt: AT,
      startedAt: LATER,
      expiresAt: LATEST,
      ipAddress: null,
      userAgent: null,
      handoff: {
        method: 'qr',
        fromSessionId: 'iqse_01J00000000000000000000000',
        redeemedAt: AT,
        rejectedAt: AT,
        distanceMeters: null,
        countryChanged: false,
        asnChanged: null,
      },
    });
    expect(session.attributes).toMatchObject({
      'device-handoff-method': 'qr',
      'handoff-from-session-id': 'iqse_01J00000000000000000000000',
      'handoff-redeemed-at': AT_ISO,
      'handoff-rejected-at': AT_ISO,
      'handoff-distance-meters': null,
      'handoff-country-changed': false,
    });
  });
});

describe('the handoff member of a flow session (K7A-5)', () => {
  it('says the issuing session is handed off, and leaves it out otherwise', () => {
    const member = { 'step-id': 'handoff', state: 'redeemed' };

    expect(flowHandoffSchema.parse(member)).toEqual(member);
    expect(flowHandoffSchema.parse({ ...member, 'handed-off': true })).toEqual({
      ...member,
      'handed-off': true,
    });
  });
});

describe('the step and the settings (C96.1, C91.5)', () => {
  it('lets a template use the step, which creates no verification (F01)', () => {
    expect(SUPPORTED_FLOW_STEP_TYPES).toContain('device_handoff');
    expect(
      (STEP_VERIFICATION_TYPES as Readonly<Record<string, unknown>>).device_handoff,
    ).toBeNull();
  });

  it('caps the sessions of an inquiry at 25 by default, between 1 and 100 (C91.5)', () => {
    expect(TEMPLATE_SETTINGS_DEFAULTS).toMatchObject({
      'max-sessions': 25,
      'expire-inquiry-on-session-limit': false,
    });
    expect(
      resolveTemplateSettings(JSON.parse('{"max-sessions":3}') as TemplateSettings),
    ).toMatchObject({
      'max-sessions': 3,
    });
    expect(templateSettingsSchema.safeParse({ 'max-sessions': 0 }).success).toBe(false);
    expect(templateSettingsSchema.safeParse({ 'max-sessions': 101 }).success).toBe(false);
    expect(
      templateSettingsSchema.safeParse({ 'expire-inquiry-on-session-limit': true }).success,
    ).toBe(true);
  });
});
