/**
 * C16 and C248.4 (Workflow 11B, `sso-oidc`; Stage 1a amendment 11) on PGlite: the C16 pass deletes
 * the single-use SSO sign-in attempts a day after their expiry, in batches, and keeps the younger
 * ones; the report counts them (`deletedSsoLoginStates`, a count, never data). Synthetic values.
 */
import { createHash } from 'node:crypto';
import { createSsoProvider, insertSsoLoginState, ssoLoginStates } from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runRetention } from '../../services/retention.js';
import { createInMemoryFileStorage } from '../../storage/index.js';
import { createRecordingRedactionService, fixedClock } from '../../test-support/fakes.js';

const NOW = new Date('2026-11-13T12:00:00Z');
const HOUR = 3_600_000;

let database: TestDatabase;
beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);
afterAll(async () => {
  await database.close();
});

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

describe('the C16 pass and the SSO sign-in attempts (C248.4, amendment 11)', () => {
  it('deletes the attempts a day past their expiry, in batches, and keeps the younger ones', async () => {
    const db = database.db;
    const { organization } = await createTestTenant(db);
    const providerId = testId('ssop');
    await createSsoProvider(db, {
      id: providerId,
      organizationId: organization.id,
      displayName: 'Workforce',
      issuer: 'https://idp.example.com/oauth2/default',
      clientId: 'synthetic-client-id',
      clientSecret: 'synthetic-client-secret-canary',
      allowedEmailDomains: ['example.com'],
      tenantPinClaim: null,
      tenantPinValue: null,
      requiredAmr: [],
      requiredAcr: [],
      jitProvisioning: false,
      defaultRoleIds: [],
      enforced: false,
      at: NOW,
    });
    const attempt = async (name: string, expiredHoursAgo: number) => {
      const expiresAt = new Date(NOW.getTime() - expiredHoursAgo * HOUR);
      await insertSsoLoginState(db, {
        bindingSha256: digest(name),
        organizationId: organization.id,
        providerId,
        purpose: 'sign-in',
        sessionId: null,
        stateSha256: digest(`${name}-state`),
        nonce: 'synthetic-nonce',
        codeVerifier: 'synthetic-code-verifier',
        returnTo: null,
        createdAt: new Date(expiresAt.getTime() - 600_000),
        expiresAt,
      });
    };
    for (const name of ['stale-1', 'stale-2', 'stale-3']) {
      await attempt(name, 25);
    }
    await attempt('young', 23);
    await attempt('live', -0.1);

    const clock = fixedClock(NOW);
    const report = await runRetention({
      db,
      storage: createInMemoryFileStorage(),
      redaction: createRecordingRedactionService(clock),
      clock,
      batchSize: 2,
    });

    expect(report.deletedSsoLoginStates).toBe(3);
    const left = await db.select({ key: ssoLoginStates.bindingSha256 }).from(ssoLoginStates);
    expect(left.map((row) => row.key).sort()).toEqual([digest('live'), digest('young')].sort());
  });
});
