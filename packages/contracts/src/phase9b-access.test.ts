/**
 * C167.2, C167.3, C168 (Workflow 9B Stage 1a, (U)): roles per environment, what an operator may
 * grant, invitations resent, reactivation, the console MFA reset with its step-up, sessions, the
 * users list's MFA and sign-in columns, and the audit explorer's filters. Read through the package
 * root, so the index line is held too.
 */
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import * as contracts from './index.js';
import { readFixture } from './test-support.js';

const pick = (name: string): unknown => (contracts as Readonly<Record<string, unknown>>)[name];
const schema = (name: string): z.ZodType => {
  const found = pick(name);
  expect(found, name).toBeDefined();
  return found as z.ZodType;
};
const parses = (name: string, value: unknown) => schema(name).safeParse(value).success;
const SANDBOX = 'env_01M5CN00000000000000009B40';
const ROLE = 'role_01M5CN00000000000000009B41';

describe('role assignments per environment (C167.2, C167.3)', () => {
  it('assigns a role in some environments, or in every current and future one with null', () => {
    expect(
      parses('setUserRolesBodySchema', {
        assignments: [
          { 'role-id': ROLE, 'environment-ids': [SANDBOX] },
          { 'role-id': 'role_01M5CN00000000000000009B42', 'environment-ids': null },
        ],
      }),
    ).toBe(true);
    expect(parses('setUserRolesBodySchema', { assignments: [] })).toBe(false);
    expect(
      parses('setUserRolesBodySchema', {
        assignments: [{ 'role-id': ROLE, 'environment-ids': [] }],
      }),
    ).toBe(false);
    expect(
      parses('setUserRolesBodySchema', {
        assignments: [
          { 'role-id': ROLE, 'environment-ids': [SANDBOX] },
          { 'role-id': ROLE, 'environment-ids': null },
        ],
      }),
    ).toBe(false);
  });

  it('answers the assignments, and what the caller may grant in each environment', () => {
    const assignments = readFixture('api/user-role-assignments.json');
    expect(schema('userRoleAssignmentsDocumentSchema').parse(assignments)).toEqual(assignments);
    const grantable = readFixture('api/grantable.json');
    expect(schema('grantableDocumentSchema').parse(grantable)).toEqual(grantable);
    expect(pick('GRANT_REFUSAL_REASONS')).toEqual([
      'not-held',
      'organization-level',
      'admin-organization-wide',
    ]);
  });
});

describe('invitations, reactivation, the MFA reset and the step-up (C168.1, C168.3)', () => {
  it('resends an invitation and reactivates a user with no body, answering the invitation or the user', () => {
    expect(parses('resendInvitationBodySchema', {})).toBe(true);
    expect(parses('resendInvitationBodySchema', { email: 'x@example.com' })).toBe(false);
    expect(parses('reactivateUserBodySchema', {})).toBe(true);
    expect(parses('resetUserMfaBodySchema', {})).toBe(true);
  });

  it('verifies a second factor again on the current session, a TOTP code or a passkey', () => {
    expect(parses('stepUpBodySchema', { 'totp-code': '123456' })).toBe(true);
    expect(parses('stepUpBodySchema', { 'totp-code': '12345' })).toBe(false);
    expect(parses('stepUpBodySchema', { 'recovery-code': 'abcd-efgh-ijkl' })).toBe(false);
    expect(pick('STEP_UP_WINDOW_SECONDS')).toBe(600);
    const answer = readFixture('api/step-up.json');
    expect(schema('stepUpResponseSchema').parse(answer)).toEqual(answer);
  });
});

describe('my sessions (C168.4)', () => {
  it('lists the caller own sessions with a device summary, the current one marked', () => {
    const sessions = readFixture('api/user-sessions.json');
    expect(schema('userSessionListDocumentSchema').parse(sessions)).toEqual(sessions);
    const current = (sessions as { data: { attributes: { current: boolean } }[] }).data.filter(
      (session) => session.attributes.current,
    );
    expect(current).toHaveLength(1);
    const revoked = readFixture('api/user-sessions-revoked.json');
    expect(schema('revokeOtherSessionsResponseSchema').parse(revoked)).toEqual(revoked);
  });
});

describe('the users list columns (C168.5)', () => {
  it('serves factor kinds and counts and the last sign-in, never a secret', () => {
    const user = readFixture('api/user-mfa-status.json');
    expect(schema('userDocumentSchema').parse(user)).toEqual(user);
    expect(user).toMatchObject({
      data: {
        attributes: {
          'mfa-factors': [{ kind: 'totp', count: 1 }],
          'last-sign-in-at': '2026-10-29T08:00:00.000Z',
        },
      },
    });
  });
});

describe('the audit explorer filters (C168.6)', () => {
  const query = (value: Record<string, unknown>) => parses('listUserAuditLogsQuerySchema', value);

  it('filters by an action prefix, a time range and an exact IP address', () => {
    expect(query({ 'filter[action-prefix]': 'inquiry.' })).toBe(true);
    expect(query({ 'filter[action-prefix]': 'Inquiry' })).toBe(false);
    expect(
      query({ 'filter[from]': '2026-10-01T00:00:00Z', 'filter[to]': '2026-10-29T00:00:00Z' }),
    ).toBe(true);
    expect(
      query({ 'filter[from]': '2026-10-29T00:00:00Z', 'filter[to]': '2026-10-01T00:00:00Z' }),
    ).toBe(false);
    expect(query({ 'filter[ip]': '192.0.2.1' })).toBe(true);
    expect(query({ 'filter[ip]': '2001:db8::1' })).toBe(true);
    expect(query({ 'filter[ip]': '192.0.2.0/24' })).toBe(false);
  });

  it('names the audit IP index label, an HMAC under the blind-index subkey', () => {
    expect(pick('AUDIT_IP_INDEX_LABEL')).toBe('openverify/audit-ip/v1');
  });
});
