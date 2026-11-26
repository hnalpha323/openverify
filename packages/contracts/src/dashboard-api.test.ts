import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_SETTINGS_DEFAULTS,
  OTP_SETTINGS_DEFAULTS,
  FILE_CONTENT_CACHE_CONTROL,
  FILE_VIEWED_AUDIT_ACTION,
  MIN_PASSWORD_LENGTH,
  dashboardAcceptInvitationBodySchema,
  dashboardInquiryDocumentSchema,
  dashboardInquiryListDocumentSchema,
  dashboardInvitationResponseSchema,
  dashboardInviteUserBodySchema,
  dashboardListInquiriesQuerySchema,
  dashboardLoginBodySchema,
  dashboardMeDocumentSchema,
  dashboardMfaChallengeResponseSchema,
  dashboardMfaLoginBodySchema,
  dashboardSessionResponseSchema,
  dashboardSettingsSchema,
  dashboardSwitchEnvironmentBodySchema,
  dashboardSwitchEnvironmentResponseSchema,
  dashboardUpdateSettingsBodySchema,
  dashboardWebauthnLoginOptionsBodySchema,
  dashboardWebauthnLoginOptionsResponseSchema,
  dashboardWebauthnLoginVerifyBodySchema,
} from './dashboard-api.js';
import { buildFileResource } from './files.js';
import { buildInquiryResource } from './inquiries.js';
import { AT, AT_ISO, IDS, LATER, LATER_ISO, TOKENS } from './test-support.js';
import { buildVerificationResource } from './verifications.js';

const user = {
  type: 'user',
  id: IDS.user,
  attributes: { email: 'operator@example.test', 'created-at': AT_ISO, 'updated-at': AT_ISO },
};

describe('POST /api/v1/dashboard/sessions (C4)', () => {
  it('takes an email and password', () => {
    const body = { email: 'operator@example.test', password: 'correct horse battery staple' };
    expect(dashboardLoginBodySchema.parse(body)).toEqual(body);
    expect(dashboardLoginBodySchema.safeParse({ ...body, email: 'operator' }).success).toBe(false);
    expect(dashboardLoginBodySchema.safeParse({ ...body, password: '' }).success).toBe(false);
    // Bounded so a huge password cannot tie up Argon2id.
    expect(
      dashboardLoginBodySchema.safeParse({ ...body, password: 'x'.repeat(1025) }).success,
    ).toBe(false);
  });

  it('returns the user session token, its expiry and the user', () => {
    const response = { token: `ovu_${'A'.repeat(43)}`, 'expires-at': AT_ISO, user };
    expect(dashboardSessionResponseSchema.parse(response)).toEqual(response);
    expect(
      dashboardSessionResponseSchema.safeParse({ ...response, token: `ovs_${'A'.repeat(43)}` })
        .success,
    ).toBe(false);
  });
});

describe('dashboard reads (C4)', () => {
  const inquiry = buildInquiryResource({
    id: IDS.inquiry,
    status: 'completed',
    referenceId: 'ref-test-001',
    fields: {},
    inquiryTemplateId: IDS.template,
    verifications: [{ id: IDS.selfie, type: 'selfie' }],
    createdAt: AT,
    updatedAt: LATER,
  });
  const verification = buildVerificationResource({
    id: IDS.selfie,
    type: 'selfie',
    status: 'passed',
    inquiryId: IDS.inquiry,
    fileIds: [IDS.selfieCenter],
    checks: [],
    createdAt: AT,
    updatedAt: LATER,
  });
  const file = buildFileResource({
    id: IDS.selfieCenter,
    kind: 'selfie-center',
    mimeType: 'image/jpeg',
    byteSize: 2048,
    createdAt: AT,
    verification: { id: IDS.selfie, type: 'selfie' },
  });

  it('return the current user', () => {
    expect(dashboardMeDocumentSchema.safeParse({ data: user }).success).toBe(true);
  });

  it('list inquiries with the server API filters', () => {
    expect(
      dashboardInquiryListDocumentSchema.safeParse({ data: [inquiry], links: { next: null } })
        .success,
    ).toBe(true);
    expect(dashboardListInquiriesQuerySchema.parse({ 'filter[status]': 'failed' })).toEqual({
      'filter[status]': 'failed',
    });
  });

  it('show an inquiry with its verifications, checks and file metadata', () => {
    const document = { data: inquiry, included: [verification, file] };
    expect(dashboardInquiryDocumentSchema.parse(document)).toEqual(document);
    expect(
      dashboardInquiryDocumentSchema.safeParse({ data: inquiry, included: [inquiry] }).success,
    ).toBe(false);
  });

  it('serve file content privately and audit every view', () => {
    expect(FILE_CONTENT_CACHE_CONTROL).toBe('private, no-store');
    expect(FILE_VIEWED_AUDIT_ACTION).toBe('file.viewed');
  });
});

describe('MFA login (C15)', () => {
  it('answers 202 with an MFA challenge token and the factors to choose from', () => {
    const challenge = {
      'mfa-token': TOKENS.mfa,
      factors: [
        { id: IDS.totpFactor, type: 'totp' },
        { id: IDS.mfaFactor, type: 'webauthn' },
      ],
    };
    expect(dashboardMfaChallengeResponseSchema.parse(challenge)).toEqual(challenge);
    expect(
      dashboardMfaChallengeResponseSchema.safeParse({ ...challenge, 'mfa-token': TOKENS.session })
        .success,
    ).toBe(false);
  });

  it('completes with exactly one of a TOTP code or a recovery code', () => {
    expect(
      dashboardMfaLoginBodySchema.parse({ 'mfa-token': TOKENS.mfa, 'totp-code': '123456' }),
    ).toEqual({ 'mfa-token': TOKENS.mfa, 'totp-code': '123456' });
    expect(
      dashboardMfaLoginBodySchema.parse({
        'mfa-token': TOKENS.mfa,
        'recovery-code': 'abcd efgh jkmn',
      }),
    ).toEqual({ 'mfa-token': TOKENS.mfa, 'recovery-code': 'abcd efgh jkmn' });
    for (const body of [
      { 'mfa-token': TOKENS.mfa },
      { 'mfa-token': TOKENS.mfa, 'totp-code': '123456', 'recovery-code': 'ABCD-EFGH-JKMN' },
      { 'totp-code': '123456' },
    ]) {
      expect(dashboardMfaLoginBodySchema.safeParse(body).success).toBe(false);
    }
  });

  it('completes with a WebAuthn assertion', () => {
    expect(dashboardWebauthnLoginOptionsBodySchema.parse({ 'mfa-token': TOKENS.mfa })).toEqual({
      'mfa-token': TOKENS.mfa,
    });
    const options = { options: { challenge: 'Y2hhbGxlbmdl', userVerification: 'preferred' } };
    expect(dashboardWebauthnLoginOptionsResponseSchema.parse(options)).toEqual(options);
    const credential = {
      id: 'Y3JlZC0x',
      rawId: 'Y3JlZC0x',
      type: 'public-key',
      response: {
        clientDataJSON: 'e30',
        authenticatorData: 'AAAA',
        signature: 'MEUC',
      },
      clientExtensionResults: {},
    };
    expect(
      dashboardWebauthnLoginVerifyBodySchema.parse({ 'mfa-token': TOKENS.mfa, credential }),
    ).toEqual({ 'mfa-token': TOKENS.mfa, credential });
  });
});

describe('environment switch and session context (C15)', () => {
  it('switches the session to another environment', () => {
    const body = { 'environment-id': IDS.productionEnvironment };
    expect(dashboardSwitchEnvironmentBodySchema.parse(body)).toEqual(body);
    expect(
      dashboardSwitchEnvironmentBodySchema.safeParse({ 'environment-id': IDS.user }).success,
    ).toBe(false);
    const response = { environment: { id: IDS.productionEnvironment, kind: 'production' } };
    expect(dashboardSwitchEnvironmentResponseSchema.parse(response)).toEqual(response);
  });

  it('describes the current environment, permissions and MFA state with /me', () => {
    const document = {
      data: user,
      meta: {
        environment: { id: IDS.environment, kind: 'sandbox' },
        permissions: ['inquiries:read', 'pii:view'],
        'mfa-satisfied': true,
      },
    };
    expect(dashboardMeDocumentSchema.parse(document)).toEqual(document);
    expect(
      dashboardMeDocumentSchema.safeParse({
        ...document,
        meta: { ...document.meta, permissions: ['root'] },
      }).success,
    ).toBe(false);
  });

  it('lists the organization’s environments with /me, for the switcher (Workflow 2C)', () => {
    const environments = [
      { id: IDS.environment, kind: 'sandbox' },
      { id: IDS.productionEnvironment, kind: 'production' },
    ];
    const document = {
      data: user,
      meta: {
        environment: { id: IDS.environment, kind: 'sandbox' },
        environments,
        permissions: ['inquiries:read'],
        'mfa-satisfied': true,
      },
    };
    expect(dashboardMeDocumentSchema.parse(document)).toEqual(document);
    for (const invalid of [[], [{ id: IDS.user, kind: 'sandbox' }], [{ id: IDS.environment }]]) {
      expect(
        dashboardMeDocumentSchema.safeParse({
          ...document,
          meta: { ...document.meta, environments: invalid },
        }).success,
      ).toBe(false);
    }
  });
});

describe('users and invitations (C15)', () => {
  it('invites a user by email with roles', () => {
    const body = { email: 'new.operator@example.test', 'role-ids': [IDS.role] };
    expect(dashboardInviteUserBodySchema.parse(body)).toEqual(body);
    expect(dashboardInviteUserBodySchema.safeParse({ ...body, 'role-ids': [] }).success).toBe(
      false,
    );
    const response = { ...body, 'expires-at': LATER_ISO };
    expect(dashboardInvitationResponseSchema.parse(response)).toEqual(response);
    expect(
      dashboardInvitationResponseSchema.safeParse({ ...response, token: TOKENS.invitation })
        .success,
    ).toBe(false);
  });

  it('accepts an invitation with a token, a new password and a name', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    const body = {
      token: TOKENS.invitation,
      password: 'correct horse battery staple',
      name: 'New Operator',
    };
    expect(dashboardAcceptInvitationBodySchema.parse(body)).toEqual(body);
    for (const change of [
      { password: 'short' },
      { password: 'x'.repeat(1025) },
      { token: TOKENS.mfa },
      { name: '' },
      { name: 'Bad\nName' },
    ]) {
      expect(dashboardAcceptInvitationBodySchema.safeParse({ ...body, ...change }).success).toBe(
        false,
      );
    }
  });
});

describe('settings (C15, C16)', () => {
  it('default to no required MFA and the C16 retention windows', () => {
    expect(DASHBOARD_SETTINGS_DEFAULTS).toEqual({
      'require-mfa': false,
      'inquiry-retention-days': null,
      'api-log-retention-days': 30,
      'webhook-delivery-retention-days': 30,
      'event-retention-days': 90,
      // C42.4, C42.6 (Phase 4).
      'face-template-retention-days': 365,
      'face-search-max-templates': 50_000,
      // C73.6 (Phase 6): reports are kept as long as inquiries by default.
      'report-retention-days': null,
      // C90.8, C91.7 (Workflow 7A): integrity on, recognition off, signals shown, the windows.
      'signal-collection': {
        'session-integrity': 'on',
        'device-recognition': 'off',
        'device-recognition-basis': null,
      },
      'expose-signals': true,
      'signal-component-retention-days': 30,
      'ip-retention-days': null,
      'device-retention-days': 365,
      // C107.7 (Workflow 7A (H)).
      'organization-display-name': null,
      'biometric-lists-basis': null,
      'transaction-retention-days': null,
      'graph-indexing': true,
      'graph-weak-kinds': false,
      'graph-components': false,
      'graph-query-retention-days': 30,
      // C143.7 (Workflow 8A).
      'workflow-run-retention-days': 30,
      'workflow-run-history-retention-days': 365,
      'workflow-in-flight-cap': 50,
      'workflow-http-ports': [],
      'workflow-http-hosts': null,
      'workflow-http-private-cidrs': [],
      'workflow-email-recipients': [],
      'workflow-sms-recipients': [],
      'workflow-sms-countries': null,
      'workflow-link-hosts': [],
      'case-retention-days': null,
      // C158.1, C158.4 (Workflow 9A Stage 1b (F)): served since (F).
      'allowed-embed-origins': [],
      'allowed-redirect-origins': null,
      'default-theme-set-id': null,
      // C174.6 (Workflow 9B): the platform settings.
      'analytics-time-zone': 'UTC',
      'analytics-suppression-threshold': 11,
      'analytics-retention-months': 13,
      'analytics-settle-days': 30,
      'analytics-assignee-retention-months': 13,
      'api-key-age-warning-days': 90,
      'mail-sender-name': null,
      'audit-log-retention-days': null,
      // C232.1, C241.3 (Workflow 11A): a token may live the public maximum; no consent proof kept.
      'share-token-max-seconds': 1_814_400,
      'consent-proof-retention-days': 0,
      // C231.10 (Workflow 11A; decision 71): no connection is received until an admin opts in.
      'connect-inbound': false,
      // C251.2, C253.4, C254.2 (Workflow 11B): no lowered cap, a week's export, a daily full check.
      'queue-in-flight-caps': {},
      'account-export-ttl-days': 7,
      'watchlist-full-check-hours': 24,
      // C248.8 (Workflow 11B (A)): no sign-in name until an admin sets one.
      'organization-slug': null,
    });
    expect(dashboardSettingsSchema.parse(DASHBOARD_SETTINGS_DEFAULTS)).toEqual(
      DASHBOARD_SETTINGS_DEFAULTS,
    );
  });

  it('serve the OTP SMS budget and, read-only, when it last tripped (C55.7, V08)', () => {
    expect(OTP_SETTINGS_DEFAULTS).toEqual({
      'otp-sms-max-per-hour': 200,
      'otp-sms-budget-tripped-at': null,
    });
    const served = { ...DASHBOARD_SETTINGS_DEFAULTS, ...OTP_SETTINGS_DEFAULTS };
    expect(dashboardSettingsSchema.parse(served)).toEqual(served);
    expect(
      dashboardSettingsSchema.safeParse({
        ...served,
        'otp-sms-budget-tripped-at': '2026-10-20T12:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(dashboardUpdateSettingsBodySchema.parse({ 'otp-sms-max-per-hour': 1 })).toEqual({
      'otp-sms-max-per-hour': 1,
    });
    for (const body of [
      { 'otp-sms-max-per-hour': 0 },
      { 'otp-sms-max-per-hour': 1_000_001 },
      { 'otp-sms-max-per-hour': 2.5 },
      { 'otp-sms-budget-tripped-at': null },
    ]) {
      expect(dashboardUpdateSettingsBodySchema.safeParse(body).success, JSON.stringify(body)).toBe(
        false,
      );
    }
  });

  it('update one or more settings within range', () => {
    expect(dashboardUpdateSettingsBodySchema.parse({ 'require-mfa': true })).toEqual({
      'require-mfa': true,
    });
    expect(dashboardUpdateSettingsBodySchema.parse({ 'connect-inbound': true })).toEqual({
      'connect-inbound': true,
    });
    expect(dashboardUpdateSettingsBodySchema.parse({ 'inquiry-retention-days': null })).toEqual({
      'inquiry-retention-days': null,
    });
    for (const body of [
      {},
      { 'event-retention-days': 0 },
      { 'api-log-retention-days': 3651 },
      { 'api-log-retention-days': null },
      { 'require-mfa': 'yes' },
      { 'connect-inbound': null },
      { 'connect-inbound': 'on' },
    ]) {
      expect(dashboardUpdateSettingsBodySchema.safeParse(body).success).toBe(false);
    }
  });
});
