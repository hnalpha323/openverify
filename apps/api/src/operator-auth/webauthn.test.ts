import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  WEBAUTHN_CHALLENGE_TTL_SECONDS,
  WebauthnNotConfiguredError,
  challengeHash,
  clientDataChallenge,
} from './webauthn.js';

const encode = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

describe('WebAuthn helpers (C15)', () => {
  it('keeps challenges for 5 minutes', () => {
    expect(WEBAUTHN_CHALLENGE_TTL_SECONDS).toBe(300);
  });

  it('stores challenges as SHA-256 hex, never in the clear', () => {
    expect(challengeHash('c2ludGhldGlj')).toBe(
      createHash('sha256').update('c2ludGhldGlj', 'utf8').digest('hex'),
    );
  });

  it('reads the challenge a browser signed from clientDataJSON', () => {
    expect(clientDataChallenge(encode({ type: 'webauthn.get', challenge: 'abc_-123' }))).toBe(
      'abc_-123',
    );
  });

  it('answers null for clientDataJSON that is not JSON or has no string challenge', () => {
    expect(clientDataChallenge(Buffer.from('not json').toString('base64url'))).toBeNull();
    expect(clientDataChallenge(encode({ challenge: 42 }))).toBeNull();
    expect(clientDataChallenge(encode(['challenge']))).toBeNull();
    expect(clientDataChallenge(encode(null))).toBeNull();
  });

  it('names the variables to set when WebAuthn is not configured, as a 503', () => {
    const error = new WebauthnNotConfiguredError();

    expect(error.status).toBe(503);
    expect(error.message).toContain('OPENVERIFY_WEBAUTHN_RP_ID');
    expect(error.message).toContain('OPENVERIFY_DASHBOARD_PUBLIC_URL');
  });
});
