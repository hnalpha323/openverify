import { describe, expect, it } from 'vitest';
import {
  MFA_FACTOR_KINDS,
  TOTP_DIGITS,
  TOTP_PERIOD_SECONDS,
  TOTP_WINDOW_STEPS,
  buildMfaFactorResource,
  confirmTotpBodySchema,
  confirmTotpResponseSchema,
  enrollTotpBodySchema,
  enrollTotpResponseSchema,
  mfaFactorDocumentSchema,
  mfaFactorListDocumentSchema,
  mfaFactorResourceSchema,
  recoveryCodesResponseSchema,
  totpCodeSchema,
  webauthnAuthenticationResponseSchema,
  webauthnCreationOptionsSchema,
  webauthnRegistrationOptionsBodySchema,
  webauthnRegistrationOptionsResponseSchema,
  webauthnRegistrationResponseSchema,
  webauthnRegistrationVerifyBodySchema,
  webauthnRequestOptionsSchema,
} from './mfa.js';
import { newRecoveryCodes } from './recovery-codes.js';
import { AT, AT_ISO, IDS, LATER, LATER_ISO } from './test-support.js';

const factor = {
  type: 'mfa-factor',
  id: IDS.totpFactor,
  attributes: {
    kind: 'totp',
    name: 'Phone',
    status: 'active',
    'created-at': AT_ISO,
    'confirmed-at': LATER_ISO,
    'last-used-at': null,
  },
};

const creationOptions = {
  challenge: 'c3ludGhldGljLWNoYWxsZW5nZQ',
  rp: { name: 'OpenVerify', id: 'localhost' },
  user: { id: 'dXNyXzAx', name: 'operator@example.test', displayName: 'Sam Sample' },
  pubKeyCredParams: [
    { type: 'public-key', alg: -7 },
    { type: 'public-key', alg: -257 },
  ],
  timeout: 300_000,
  excludeCredentials: [{ id: 'Y3JlZC0x', type: 'public-key', transports: ['usb'] }],
  authenticatorSelection: { userVerification: 'preferred', residentKey: 'preferred' },
  attestation: 'none',
  extensions: { credProps: true },
};

const requestOptions = {
  challenge: 'c3ludGhldGljLWNoYWxsZW5nZQ',
  timeout: 300_000,
  rpId: 'localhost',
  allowCredentials: [{ id: 'Y3JlZC0x', type: 'public-key' }],
  userVerification: 'preferred',
};

const registration = {
  id: 'Y3JlZC0x',
  rawId: 'Y3JlZC0x',
  type: 'public-key',
  response: {
    clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0',
    attestationObject: 'o2NmbXRkbm9uZQ',
    transports: ['usb'],
  },
  clientExtensionResults: {},
  authenticatorAttachment: 'cross-platform',
};

const authentication = {
  id: 'Y3JlZC0x',
  rawId: 'Y3JlZC0x',
  type: 'public-key',
  response: {
    clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0',
    authenticatorData: 'A'.repeat(50),
    signature: 'MEUCIQDsynthetic',
    userHandle: 'dXNyXzAx',
  },
  clientExtensionResults: {},
};

describe('mfa-factor resource (C15)', () => {
  it('is a TOTP or WebAuthn factor, pending until confirmed', () => {
    expect(MFA_FACTOR_KINDS).toEqual(['totp', 'webauthn']);
    expect(mfaFactorResourceSchema.parse(factor)).toEqual(factor);
    expect(mfaFactorDocumentSchema.safeParse({ data: factor }).success).toBe(true);
    expect(
      mfaFactorListDocumentSchema.safeParse({ data: [factor], links: { next: null } }).success,
    ).toBe(true);
  });

  it('never carries the TOTP secret or a credential key', () => {
    for (const leak of [{ secret: 'JBSWY3DPEHPK3PXP' }, { 'public-key': 'pQECAyYg' }]) {
      const value = { ...factor, attributes: { ...factor.attributes, ...leak } };
      expect(mfaFactorResourceSchema.safeParse(value).success).toBe(false);
    }
  });

  it('is confirmed exactly when it is active', () => {
    const pending = { ...factor.attributes, status: 'pending', 'confirmed-at': null };
    expect(mfaFactorResourceSchema.safeParse({ ...factor, attributes: pending }).success).toBe(
      true,
    );
    expect(
      mfaFactorResourceSchema.safeParse({
        ...factor,
        attributes: { ...factor.attributes, 'confirmed-at': null },
      }).success,
    ).toBe(false);
  });

  it('is built from a factor record', () => {
    expect(
      buildMfaFactorResource({
        id: IDS.totpFactor,
        kind: 'totp',
        name: 'Phone',
        status: 'active',
        createdAt: AT,
        confirmedAt: LATER,
        lastUsedAt: null,
      }),
    ).toEqual(factor);
    expect(
      buildMfaFactorResource({
        id: IDS.mfaFactor,
        kind: 'webauthn',
        name: null,
        status: 'active',
        createdAt: AT,
        confirmedAt: AT,
        lastUsedAt: LATER,
      }).attributes['last-used-at'],
    ).toBe(LATER_ISO);
  });
});

describe('TOTP (C15)', () => {
  it('uses RFC 6238 with SHA-1, 6 digits, 30 s steps and one step of drift', () => {
    expect([TOTP_DIGITS, TOTP_PERIOD_SECONDS, TOTP_WINDOW_STEPS]).toEqual([6, 30, 1]);
    expect(totpCodeSchema.safeParse('012345').success).toBe(true);
    for (const code of ['12345', '1234567', '12345a', ' 123456']) {
      expect(totpCodeSchema.safeParse(code).success).toBe(false);
    }
  });

  it('enrols with an optional name and returns the secret and otpauth URI once', () => {
    expect(enrollTotpBodySchema.parse({})).toEqual({});
    expect(enrollTotpBodySchema.parse({ name: 'Phone' })).toEqual({ name: 'Phone' });
    const pending = {
      ...factor,
      attributes: { ...factor.attributes, status: 'pending', 'confirmed-at': null },
    };
    const response = {
      data: pending,
      meta: {
        'otpauth-uri':
          'otpauth://totp/OpenVerify:operator%40example.test?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=OpenVerify',
        secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
      },
    };
    expect(enrollTotpResponseSchema.parse(response)).toEqual(response);
    expect(
      enrollTotpResponseSchema.safeParse({
        ...response,
        meta: { ...response.meta, secret: 'not base32!' },
      }).success,
    ).toBe(false);
    expect(
      enrollTotpResponseSchema.safeParse({
        ...response,
        meta: { ...response.meta, 'otpauth-uri': 'https://example.test' },
      }).success,
    ).toBe(false);
  });

  it('confirms with a valid code, optionally returning first recovery codes', () => {
    const body = { 'factor-id': IDS.totpFactor, 'totp-code': '123456' };
    expect(confirmTotpBodySchema.parse(body)).toEqual(body);
    expect(confirmTotpBodySchema.safeParse({ ...body, 'factor-id': IDS.user }).success).toBe(false);
    expect(confirmTotpResponseSchema.parse({ data: factor })).toEqual({ data: factor });
    const codes = newRecoveryCodes();
    expect(
      confirmTotpResponseSchema.parse({ data: factor, meta: { 'recovery-codes': codes } }),
    ).toEqual({ data: factor, meta: { 'recovery-codes': codes } });
  });
});

describe('recovery codes response (C15)', () => {
  it('returns 10 codes once', () => {
    const codes = newRecoveryCodes();
    expect(recoveryCodesResponseSchema.parse({ 'recovery-codes': codes })).toEqual({
      'recovery-codes': codes,
    });
  });
});

describe('WebAuthn (C15)', () => {
  it('enrols with creation options and a registration credential', () => {
    expect(webauthnRegistrationOptionsBodySchema.parse({ name: 'Security key' })).toEqual({
      name: 'Security key',
    });
    expect(webauthnCreationOptionsSchema.parse(creationOptions)).toEqual(creationOptions);
    expect(webauthnRegistrationOptionsResponseSchema.parse({ options: creationOptions })).toEqual({
      options: creationOptions,
    });
    expect(webauthnRegistrationResponseSchema.parse(registration)).toEqual(registration);
    expect(
      webauthnRegistrationVerifyBodySchema.parse({ credential: registration, name: 'Key' }),
    ).toEqual({ credential: registration, name: 'Key' });
  });

  it('logs in with request options and an assertion', () => {
    expect(webauthnRequestOptionsSchema.parse(requestOptions)).toEqual(requestOptions);
    expect(webauthnAuthenticationResponseSchema.parse(authentication)).toEqual(authentication);
  });

  it.each([
    ['a challenge that is not base64url', { ...requestOptions, challenge: 'not base64url!' }],
    ['no challenge', { ...requestOptions, challenge: undefined }],
  ])('rejects request options with %s', (_name, value) => {
    expect(webauthnRequestOptionsSchema.safeParse(value).success).toBe(false);
  });

  it('rejects a credential of another type or without its response', () => {
    expect(
      webauthnAuthenticationResponseSchema.safeParse({ ...authentication, type: 'password' })
        .success,
    ).toBe(false);
    expect(
      webauthnRegistrationResponseSchema.safeParse({ ...registration, response: {} }).success,
    ).toBe(false);
  });
});
