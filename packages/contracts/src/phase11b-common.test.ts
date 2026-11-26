/**
 * Phase 11, Workflow 11B Stage 1a, the common checkpoint (C245-C254): the account-export id, every
 * 11B problem code with one golden problem each, the access export's scope, the `account-export`
 * policy and the fail-closed list, the console-session and login-limiter constants, and the three
 * environment settings. Everything is read through the package root, so the export lines are held
 * too, and a name that does not exist yet fails here at run time, never at compile time.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as contracts from './index.js';
import { listFixtures, readFixture } from './test-support.js';

const pick = (name: string): unknown => (contracts as Readonly<Record<string, unknown>>)[name];
const schema = (name: string): z.ZodType => {
  const found = pick(name);
  if (!(found instanceof z.ZodType)) {
    throw new TypeError(`${name} is not exported as a schema`);
  }
  return found;
};

const TITLES: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  410: 'Gone',
  422: 'Unprocessable Content',
  503: 'Service Unavailable',
};

const fileOf = (code: string) => `${code.replaceAll('_', '-')}.json`;

describe('the account-export id (C253.1)', () => {
  it('holds aexp, ours, beside the earlier prefixes', () => {
    expect(contracts.ID_PREFIXES).toMatchObject({ accountExport: 'aexp' });
    const id = 'aexp_01M5CN0000000000000011B100';
    expect(contracts.isId('aexp', id)).toBe(true);
    expect(contracts.isId('exp', id)).toBe(false);
    expect(contracts.anyIdSchema.safeParse(id).success).toBe(true);
  });
});

/** Each folder, the frozen map that names its codes, and the status each answers. */
const FAMILIES = [
  [
    'sessions',
    'CONSOLE_SESSION_PROBLEM_STATUSES',
    // C245.2: a console session past a limit; C246.2: login while the limiter's store is down.
    { session_expired: 401, login_unavailable: 503 },
  ],
  [
    'sso',
    'SSO_PROBLEM_STATUSES',
    // C248.7 and C248.8 (Stage 1a amendment 10): generic toward the browser, codes for the BFF.
    {
      sso_not_configured: 404,
      sso_state_invalid: 400,
      sso_email_unverified: 403,
      sso_user_unknown: 403,
      sso_password_disabled: 403,
      organization_slug_taken: 409,
    },
  ],
  [
    'account-exports',
    'ACCOUNT_EXPORT_PROBLEM_STATUSES',
    // C253.5, C253.2, C253.7.
    {
      account_export_pending: 409,
      account_export_too_large: 422,
      account_export_item_redacted: 410,
      account_export_unavailable: 503,
    },
  ],
  [
    'watchlists-opt-in',
    'WATCHLIST_OPT_IN_PROBLEM_STATUSES',
    // C254.1: the UN opt-in while the install switch is off.
    { watchlist_source_locked: 409 },
  ],
] as const;

/** A code with more than one golden: one per reason. */
const VARIANTS: Readonly<Record<string, readonly string[]>> = {
  session_expired: ['session-expired-idle.json', 'session-expired-absolute.json'],
};

describe.each(FAMILIES)('problems/%s/ (Workflow 11B common)', (folder, name, expected) => {
  it('freezes the codes with their statuses', () => {
    const frozen = pick(name);
    expect(frozen).toEqual(expected);
    expect(Object.isFrozen(frozen)).toBe(true);
  });

  it('holds one golden problem per code (one per reason where it has reasons)', () => {
    expect(listFixtures(`problems/${folder}`)).toEqual(
      Object.keys(expected)
        .flatMap((code) => VARIANTS[code] ?? [fileOf(code)])
        .sort(),
    );
  });

  it.each(
    Object.entries(expected).flatMap(([code, status]) =>
      (VARIANTS[code] ?? [fileOf(code)]).map((file) => [file, code, status] as const),
    ),
  )('%s carries its code and status, and no value', (file, code, status) => {
    const raw = readFixture(`problems/${folder}/${file}`);
    const problem = contracts.problemSchema.parse(raw);
    expect(problem).toEqual(raw);
    expect(problem).toMatchObject({ type: 'about:blank', title: TITLES[status], status, code });
    expect(z.encode(contracts.problemSchema, problem)).toEqual(raw);
    // Rule 11: no address, no email, no long number, no token.
    expect(problem.detail).not.toMatch(/[0-9]{4}|@|ov[a-z]*_/);
  });
});

describe('the problems carry what each code needs, and nothing else', () => {
  it('gives session_expired its reason, idle or absolute (C245.2)', () => {
    expect(pick('SESSION_EXPIRED_REASONS')).toEqual(['idle', 'absolute']);
    const expired = schema('sessionExpiredProblemSchema');
    const idle = readFixture('problems/sessions/session-expired-idle.json');
    const absolute = readFixture('problems/sessions/session-expired-absolute.json');
    expect(expired.parse(idle)).toMatchObject({ code: 'session_expired', reason: 'idle' });
    expect(expired.parse(absolute)).toMatchObject({ code: 'session_expired', reason: 'absolute' });
    expect(
      expired.safeParse({ ...(idle as Record<string, unknown>), reason: 'inquiry_expired' })
        .success,
    ).toBe(false);
    expect(contracts.problemSchema.safeParse(idle).success).toBe(true);
  });

  it('keeps the flow session_expired without a reason (C10), so both families parse', () => {
    expect(contracts.FLOW_SESSION_INACTIVE_CODES).toContain('session_expired');
  });

  it('gives account_export_too_large the item count and the limit (C253.5)', () => {
    const raw = readFixture('problems/account-exports/account-export-too-large.json');
    const parsed = schema('accountExportTooLargeProblemSchema').parse(raw);
    expect(parsed).toMatchObject({ 'item-count': 5001, 'item-limit': 5000 });
    expect(pick('ACCOUNT_EXPORT_LIMITS')).toMatchObject({ items: 5000 });
  });

  it('answers 503 for both fail-closed refusals without naming the store', () => {
    for (const file of [
      'problems/sessions/login-unavailable.json',
      'problems/account-exports/account-export-unavailable.json',
    ]) {
      const { detail } = contracts.problemSchema.parse(readFixture(file));
      expect(detail).not.toMatch(/valkey|redis/i);
    }
  });
});

describe("the access export's scope (C253.1; Stage 1a amendment 20)", () => {
  // The default name `accounts:access-export` breaks the scope grammar (a one-word action,
  // packages/core/src/permissions.test.ts), so the scope keeps Phase 9's `:export` action family.
  it('is a new API scope, apart from Phase 9 accounts:export, admin only and environment-level', async () => {
    const core = await import('@openverify/core');
    const scopes = core.API_SCOPES as readonly string[];
    expect(scopes).toContain('account-access:export');
    expect(scopes).toContain('accounts:export');
    expect(core.BUILTIN_ROLES.admin.permissions as readonly string[]).toContain(
      'account-access:export',
    );
    for (const key of ['developer', 'reviewer', 'viewer'] as const) {
      expect(core.BUILTIN_ROLES[key].permissions as readonly string[]).not.toContain(
        'account-access:export',
      );
    }
    expect(core.permissionLevel('account-access:export')).toBe('environment');
  });
});

describe('the account-export policy and the fail-closed list (C253.7, C233.5)', () => {
  it('holds account-export in the three maps: 10 an hour', () => {
    expect(contracts.RATE_LIMIT_POLICIES as readonly string[]).toContain('account-export');
    expect(
      (contracts.RATE_LIMIT_DEFAULTS as Readonly<Record<string, number>>)['account-export'],
    ).toBe(10);
    expect(
      (contracts.RATE_LIMIT_POLICY_WINDOWS as Readonly<Record<string, number>>)['account-export'],
    ).toBe(3600);
  });

  it('names the two policies that fail closed, each a policy', () => {
    const failClosed = pick('RATE_LIMIT_FAIL_CLOSED_POLICIES') as readonly string[] | undefined;
    expect(failClosed).toEqual(['connect-peek', 'account-export']);
    for (const policy of failClosed ?? []) {
      expect(contracts.RATE_LIMIT_POLICIES as readonly string[]).toContain(policy);
    }
    expect(Object.isFrozen(failClosed)).toBe(true);
  });
});

describe('console sessions and the login limiter (C245.1, C246.1)', () => {
  it('bounds the idle and absolute limits, 30 minutes and 12 hours by default', () => {
    expect(pick('CONSOLE_SESSION_TIMEOUTS')).toEqual({
      idleSeconds: { min: 300, max: 86_400, default: 1800 },
      absoluteSeconds: { min: 3600, max: 86_400, default: 43_200 },
    });
    expect(contracts.USER_SESSION_TOKEN_TTL_SECONDS).toBe(43_200);
  });

  it('moves last-seen at most once a minute (C245.1)', () => {
    expect(pick('SESSION_LAST_SEEN_WRITE_SECONDS')).toBe(60);
  });

  it('freezes the login windows: two fixed 15-minute windows, 50 per address and 10 per email', () => {
    expect(pick('LOGIN_LIMITS')).toEqual({ windowSeconds: 900, perAddress: 50, perEmail: 10 });
    expect(pick('LOGIN_LIMIT_KEY_LABEL')).toBe('openverify/login-limit/v1');
    expect(pick('LOGIN_UNAVAILABLE_RETRY_AFTER_SECONDS')).toBe(30);
  });

  it('names the two Valkey keys by an HMAC, never by an address or an email (P32)', () => {
    const keys = pick('loginLimitKeys') as
      | ((input: { addressHmac: string; emailHmac: string }) => readonly [string, string])
      | undefined;
    const hex = 'a'.repeat(64);
    const named = keys?.({ addressHmac: hex, emailHmac: 'b'.repeat(64) });
    expect(named).toEqual([
      `openverify:login-limit:v1:a:${'a'.repeat(64)}`,
      `openverify:login-limit:v1:e:${'b'.repeat(64)}`,
    ]);
    expect(() => keys?.({ addressHmac: '198.51.100.7', emailHmac: hex })).toThrow();
    expect(() => keys?.({ addressHmac: hex, emailHmac: 'synthetic@example.com' })).toThrow();
  });

  it('keeps the login limiter out of the route policies (review F19)', () => {
    expect(contracts.RATE_LIMIT_POLICIES as readonly string[]).not.toContain('login');
  });
});

const CAPPED = [
  'process-verification',
  'report-run',
  'connect-redeem',
  'account-export',
  'list-screen',
  'list-import',
  'list-item-embed',
  'graph-index',
  'graph-query',
  'inquiry-signals',
  'list-rescreen',
  'integrity-decode',
  'case-rendition',
  'case-attachment-scan',
  'case-bulk',
];

describe('the three environment settings (C251.2, C253.4, C254.2)', () => {
  it('bounds a queue cap to 1-1,000 under an install ceiling of 50 by default', () => {
    expect(pick('QUEUE_IN_FLIGHT_CAP')).toEqual({
      min: 1,
      max: 1000,
      default: 50,
      ceilingDefault: 50,
    });
  });

  it('keys queue-in-flight-caps by the capped queues, workflow-step left to its own setting', () => {
    expect(pick('QUEUE_IN_FLIGHT_CAP_QUEUES')).toEqual(CAPPED);
    expect(CAPPED).not.toContain('workflow-step');
  });

  it('bounds account-export-ttl-days 1-30 (7) and watchlist-full-check-hours 1-168 (24)', () => {
    expect(pick('ACCOUNT_EXPORT_TTL_DAYS')).toEqual({ min: 1, max: 30, default: 7 });
    expect(pick('WATCHLIST_FULL_CHECK_HOURS')).toEqual({ min: 1, max: 168, default: 24 });
  });

  it('serves each with its default', () => {
    expect(contracts.DASHBOARD_SETTINGS_DEFAULTS).toMatchObject({
      'queue-in-flight-caps': {},
      'account-export-ttl-days': 7,
      'watchlist-full-check-hours': 24,
    });
  });

  it('takes a cap per capped queue, each 1-1,000, and refuses any other key', () => {
    const body = contracts.dashboardUpdateSettingsBodySchema;
    expect(body.safeParse({ 'queue-in-flight-caps': { 'report-run': 1 } }).success).toBe(true);
    expect(body.safeParse({ 'queue-in-flight-caps': { 'case-bulk': 1000 } }).success).toBe(true);
    expect(body.safeParse({ 'queue-in-flight-caps': { 'report-run': 0 } }).success).toBe(false);
    expect(body.safeParse({ 'queue-in-flight-caps': { 'report-run': 1001 } }).success).toBe(false);
    expect(body.safeParse({ 'queue-in-flight-caps': { 'workflow-step': 5 } }).success).toBe(false);
    expect(body.safeParse({ 'queue-in-flight-caps': { export: 5 } }).success).toBe(false);
  });

  it.each([
    ['account-export-ttl-days', 1, 30, 0, 31],
    ['watchlist-full-check-hours', 1, 168, 0, 169],
  ] as const)('takes %s between %d and %d in an update', (key, min, max, below, above) => {
    const body = contracts.dashboardUpdateSettingsBodySchema;
    expect(body.safeParse({ [key]: min }).success).toBe(true);
    expect(body.safeParse({ [key]: max }).success).toBe(true);
    expect(body.safeParse({ [key]: below }).success).toBe(false);
    expect(body.safeParse({ [key]: above }).success).toBe(false);
  });

  it('keeps Phase 8 workflow-in-flight-cap 1-10,000 so stored values parse (amendment 17)', () => {
    const body = contracts.dashboardUpdateSettingsBodySchema;
    expect(body.safeParse({ 'workflow-in-flight-cap': 10_000 }).success).toBe(true);
  });
});
