import { describe, expect, it } from 'vitest';
import {
  HANDOFF_LINK_TTL_SECONDS,
  HANDOFF_QR_TTL_SECONDS,
  HANDOFF_TOKEN_PREFIX,
  INVITATION_TOKEN_TTL_SECONDS,
  MFA_MAX_FAILED_ATTEMPTS,
  MFA_TOKEN_TTL_SECONDS,
  ONE_TIME_LINK_DEFAULT_TTL_SECONDS,
  ONE_TIME_LINK_MAX_TTL_SECONDS,
  ONE_TIME_LINK_MIN_TTL_SECONDS,
  SESSION_TOKEN_TTL_SECONDS,
  USER_SESSION_TOKEN_TTL_SECONDS,
  handoffTokenSchema,
  invitationTokenSchema,
  mfaTokenSchema,
  newHandoffToken,
  newInvitationToken,
  newMfaToken,
  newOneTimeLinkToken,
  newSessionToken,
  newUserSessionToken,
  newWebhookSecret,
  oneTimeLinkTokenSchema,
  sessionTokenSchema,
  toBase64Url,
  userSessionTokenSchema,
  webhookSecretLast4,
  webhookSecretSchema,
} from './tokens.js';

const fill = (value: number) => (length: number) => new Uint8Array(length).fill(value);

describe('toBase64Url', () => {
  // Expected values from RFC 4648 §10, converted to the URL-safe alphabet without padding.
  it.each([
    ['', ''],
    ['f', 'Zg'],
    ['fo', 'Zm8'],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg'],
    ['fooba', 'Zm9vYmE'],
    ['foobar', 'Zm9vYmFy'],
  ])('encodes %j as %j', (input, expected) => {
    expect(toBase64Url(new TextEncoder().encode(input))).toBe(expected);
  });

  it('uses the URL-safe alphabet', () => {
    expect(toBase64Url(Uint8Array.from([0xfb, 0xff, 0xbf]))).toBe('-_-_');
  });
});

describe('session tokens (flow and Android)', () => {
  it('have the ovs_ prefix and 43 base64url characters (256 bits)', () => {
    const token = newSessionToken();
    expect(token).toMatch(/^ovs_[A-Za-z0-9_-]{43}$/);
    expect(sessionTokenSchema.parse(token)).toBe(token);
    expect(newSessionToken()).not.toBe(token);
  });

  it('accept an injected randomness source', () => {
    expect(newSessionToken(fill(0))).toBe(`ovs_${'A'.repeat(43)}`);
  });

  it.each([
    ['the user-session prefix', `ovu_${'A'.repeat(43)}`],
    ['42 characters', `ovs_${'A'.repeat(42)}`],
    ['44 characters', `ovs_${'A'.repeat(44)}`],
    ['standard base64 characters', `ovs_${'A'.repeat(42)}+`],
    ['padding', `ovs_${'A'.repeat(42)}=`],
  ])('reject %s', (_name, value) => {
    expect(sessionTokenSchema.safeParse(value).success).toBe(false);
  });

  it('live 24 hours', () => {
    expect(SESSION_TOKEN_TTL_SECONDS).toBe(24 * 60 * 60);
  });
});

describe('user session tokens (dashboard)', () => {
  it('have the ovu_ prefix and 43 base64url characters', () => {
    const token = newUserSessionToken();
    expect(userSessionTokenSchema.parse(token)).toBe(token);
    expect(userSessionTokenSchema.safeParse(newSessionToken()).success).toBe(false);
    expect(newUserSessionToken(fill(255))).toBe(`ovu_${'_'.repeat(42)}8`);
  });

  it('live 12 hours', () => {
    expect(USER_SESSION_TOKEN_TTL_SECONDS).toBe(12 * 60 * 60);
  });
});

describe('webhook secrets', () => {
  it('have the wbhsec_ prefix and 43 base64url characters', () => {
    const secret = newWebhookSecret();
    expect(secret).toMatch(/^wbhsec_[A-Za-z0-9_-]{43}$/);
    expect(webhookSecretSchema.parse(secret)).toBe(secret);
    expect(newWebhookSecret(fill(0))).toBe(`wbhsec_${'A'.repeat(43)}`);
  });

  it('expose only their last four characters after creation', () => {
    expect(webhookSecretLast4('wbhsec_test_ONLY_not_a_real_secret_000000000000001')).toBe('0001');
  });

  it('refuse to shorten a value that is not a webhook secret', () => {
    expect(() => webhookSecretLast4('abc')).toThrow(TypeError);
  });
});

describe.each([
  ['one-time link tokens', 'ovo_', newOneTimeLinkToken, oneTimeLinkTokenSchema],
  ['MFA challenge tokens', 'ovm_', newMfaToken, mfaTokenSchema],
  ['invitation tokens', 'ovi_', newInvitationToken, invitationTokenSchema],
  // C96.2 (Phase 7): the device handoff token, bound to its issuing session.
  ['handoff tokens', 'ovh_', newHandoffToken, handoffTokenSchema],
] as const)('%s (C9)', (_name, prefix, generate, schema) => {
  it(`have the ${prefix} prefix and 43 base64url characters`, () => {
    const token = generate();
    expect(token).toMatch(new RegExp(`^${prefix}[A-Za-z0-9_-]{43}$`));
    expect(schema.parse(token)).toBe(token);
    expect(generate()).not.toBe(token);
    expect(generate(fill(0))).toBe(`${prefix}${'A'.repeat(43)}`);
  });

  it('reject every other token kind and malformed bodies', () => {
    for (const other of [
      newSessionToken(),
      newUserSessionToken(),
      newOneTimeLinkToken(),
      newMfaToken(),
      newInvitationToken(),
      newHandoffToken(),
    ].filter((token) => !token.startsWith(prefix))) {
      expect(schema.safeParse(other).success).toBe(false);
    }
    expect(schema.safeParse(`${prefix}${'A'.repeat(42)}`).success).toBe(false);
    expect(schema.safeParse(`${prefix}${'A'.repeat(42)}=`).success).toBe(false);
  });
});

describe('token lifetimes (C9)', () => {
  it('match the contract', () => {
    expect(ONE_TIME_LINK_DEFAULT_TTL_SECONDS).toBe(24 * 60 * 60);
    expect(ONE_TIME_LINK_MIN_TTL_SECONDS).toBe(300);
    expect(ONE_TIME_LINK_MAX_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
    expect(MFA_TOKEN_TTL_SECONDS).toBe(5 * 60);
    expect(MFA_MAX_FAILED_ATTEMPTS).toBe(5);
    expect(INVITATION_TOKEN_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
  });

  it('give handoff tokens short lifetimes, ours, for phishing (C96.1, H27)', () => {
    expect(HANDOFF_TOKEN_PREFIX).toBe('ovh_');
    expect(HANDOFF_QR_TTL_SECONDS).toEqual({ min: 120, max: 900, default: 300 });
    expect(HANDOFF_LINK_TTL_SECONDS).toEqual({ min: 300, max: 3600, default: 900 });
  });
});

describe('randomness', () => {
  it('rejects a source that returns the wrong number of bytes', () => {
    expect(() => newSessionToken(() => new Uint8Array(31))).toThrow(TypeError);
  });
});
