/**
 * C254.1 (Workflow 11B, ingestion-11b; Q10 pending, rule 19): the UN Security Council list's opt-in,
 * built and locked. An install switch, `OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED`, is `false` in
 * `config.ts`, `.env.example`, compose and every seed: while it is false every opt-in and every
 * withdrawal answers 409 `watchlist_source_locked`, nothing is stored or audited, and `un-sc` stays
 * "cannot be enabled in this release" exactly as Phase 6 left it (no environment may screen it, and
 * no reconcile enables it). When an install sets it true, an environment admin opts the environment
 * in only with an acknowledgement naming the terms link of `watchlists/sources.json` (`terms.url`)
 * and Phase 9's step-up; the acceptance is stored in the environment's settings
 * (`watchlist-un-opt-in`) and audited with the user and time; a withdrawal clears it. Every value is
 * synthetic.
 */
import { readFileSync } from 'node:fs';
import { WATCHLIST_OPT_IN_AUDIT_ACTIONS } from '@openverify/contracts';
import {
  createUser,
  createUserSession,
  getEnvironment,
  updateEnvironmentSettings,
  type EnvironmentSettings,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import type { AuditEntry, AuditLogger } from '../ports.js';
import { syntheticEnv } from '../test-support/env.js';
import { watchlistManifest } from './manifest.js';
import {
  acceptWatchlistOptIn,
  environmentMayScreenSource,
  optedInWatchlistSources,
  watchlistOptInOf,
  watchlistReconcileOptIn,
  withdrawWatchlistOptIn,
  type WatchlistOptInActing,
  type WatchlistOptInDeps,
} from './un-opt-in.js';

const NOW = new Date('2026-11-13T12:00:00.000Z');
const REPO = new URL('../../../../', import.meta.url);
const UN_TERMS =
  watchlistManifest().sources.find((source) => source.id === 'un-sc')?.terms.url ?? '';
const BODY = { acknowledgement: { 'terms-url': UN_TERMS, accepted: true as const } };

let database: TestDatabase;
let deps: WatchlistOptInDeps;
const audited: AuditEntry[] = [];
let acting: WatchlistOptInActing;
let otherEnvironmentId: string;
let staleSessionId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  const { organization, environment } = await createTestTenant(database.db);
  otherEnvironmentId = (await createTestTenant(database.db)).environment.id;
  const user = await createUser(database.db, {
    id: testId('usr'),
    organizationId: organization.id,
    email: 'operator@example.com',
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$synthetic$synthetic',
  });
  const session = await createUserSession(database.db, {
    id: testId('uss'),
    organizationId: organization.id,
    userId: user.id,
    environmentId: environment.id,
    tokenHash: 'a'.repeat(64),
    expiresAt: new Date(NOW.getTime() + 3_600_000),
    mfaSatisfied: true,
    mfaVerifiedAt: new Date(NOW.getTime() - 60_000),
  });
  staleSessionId = (
    await createUserSession(database.db, {
      id: testId('uss'),
      organizationId: organization.id,
      userId: user.id,
      environmentId: environment.id,
      tokenHash: 'b'.repeat(64),
      expiresAt: new Date(NOW.getTime() + 3_600_000),
      mfaSatisfied: true,
      mfaVerifiedAt: new Date(NOW.getTime() - 3_600_000),
    })
  ).id;
  const audit: AuditLogger = {
    record: (_db, entry) => {
      audited.push(entry);
      return Promise.resolve();
    },
  };
  deps = { db: database.db, audit, clock: { now: () => NOW } };
  acting = {
    ctx: { environmentId: environment.id, organizationId: organization.id },
    actor: { type: 'user', id: user.id },
    userId: user.id,
    sessionId: session.id,
  };
});

afterAll(async () => {
  await database.close();
});

const settingsOf = async (environmentId: string): Promise<EnvironmentSettings> =>
  (await getEnvironment(database.db, environmentId))?.settings ?? {};

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal');
}

describe('the switch, set false by an install (the lock)', () => {
  it("is true by default since Q10's grant (2026-11-21) in config.ts, .env.example and compose, and the e2e stack sets none", () => {
    expect(loadConfig(syntheticEnv()).watchlistUnOptInAllowed).toBe(true);
    const read = (path: string) => readFileSync(new URL(path, REPO), 'utf8');
    expect(read('.env.example')).toMatch(/^OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED=true$/m);
    expect(read('infra/docker-compose.yml')).toContain(
      'OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED: ${OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED:-true}',
    );
    expect(read('e2e/src/env.ts')).not.toContain('OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED');
  });

  it('refuses an opt-in with 409 watchlist_source_locked, storing and auditing nothing', async () => {
    const before = audited.length;
    const error = await caught(
      acceptWatchlistOptIn(deps, acting, { allowed: false, sourceId: 'un-sc' }, BODY),
    );
    expect(error).toMatchObject({ status: 409, code: 'watchlist_source_locked' });
    expect(watchlistOptInOf(await settingsOf(acting.ctx.environmentId))).toBeNull();
    expect(audited).toHaveLength(before);
  });

  it('refuses a withdrawal the same way', async () => {
    const error = await caught(
      withdrawWatchlistOptIn(deps, acting, { allowed: false, sourceId: 'un-sc' }),
    );
    expect(error).toMatchObject({ status: 409, code: 'watchlist_source_locked' });
  });

  it('keeps un-sc unscreenable and unsynced even where a setting holds an opt-in', async () => {
    const stored: EnvironmentSettings = {
      'watchlist-un-opt-in': {
        'source-id': 'un-sc',
        'terms-url': UN_TERMS,
        'accepted-at': NOW.toISOString(),
        'accepted-by': acting.userId,
      },
    };
    await updateEnvironmentSettings(database.db, otherEnvironmentId, stored);
    try {
      expect(environmentMayScreenSource('un-sc', stored, false)).toBe(false);
      expect(await optedInWatchlistSources(database.db, false)).toEqual([]);
      expect(await optedInWatchlistSources(database.db, true)).toEqual(['un-sc']);
    } finally {
      await updateEnvironmentSettings(database.db, otherEnvironmentId, {
        'watchlist-un-opt-in': null,
      });
    }
  });

  it('leaves every other source to the reconcile and the templates, as before', () => {
    for (const allowed of [false, true]) {
      expect(environmentMayScreenSource('ofac-sdn', {}, allowed)).toBe(true);
    }
  });
});

describe('the switch, set true by an install (Q10 confirmed only; never in this release)', () => {
  it('answers 404 for a source that takes no opt-in', async () => {
    const error = await caught(
      acceptWatchlistOptIn(deps, acting, { allowed: true, sourceId: 'ofac-sdn' }, BODY),
    );
    expect(error).toMatchObject({ status: 404 });
  });

  it('refuses an acknowledgement of other terms, at its pointer', async () => {
    const error = await caught(
      acceptWatchlistOptIn(
        deps,
        acting,
        { allowed: true, sourceId: 'un-sc' },
        { acknowledgement: { 'terms-url': 'https://example.com/terms', accepted: true } },
      ),
    );
    expect(error).toMatchObject({
      status: 422,
      errors: [expect.objectContaining({ pointer: '/acknowledgement/terms-url' })],
    });
    expect(watchlistOptInOf(await settingsOf(acting.ctx.environmentId))).toBeNull();
  });

  it('needs Phase 9’s step-up', async () => {
    const error = await caught(
      acceptWatchlistOptIn(
        deps,
        { ...acting, sessionId: staleSessionId },
        { allowed: true, sourceId: 'un-sc' },
        BODY,
      ),
    );
    expect(error).toMatchObject({ status: 403, code: 'step_up_required' });
  });

  it('records the acceptance with the user and time, audited, and the environment may screen un-sc', async () => {
    const before = audited.length;
    const optIn = await acceptWatchlistOptIn(
      deps,
      acting,
      { allowed: true, sourceId: 'un-sc' },
      BODY,
    );

    expect(optIn).toEqual({
      'source-id': 'un-sc',
      'terms-url': UN_TERMS,
      'accepted-at': NOW.toISOString(),
      'accepted-by': acting.userId,
    });
    const settings = await settingsOf(acting.ctx.environmentId);
    expect(watchlistOptInOf(settings)).toEqual(optIn);
    expect(environmentMayScreenSource('un-sc', settings, true)).toBe(true);
    expect(environmentMayScreenSource('un-sc', settings, false)).toBe(false);
    expect(environmentMayScreenSource('un-sc', {}, true)).toBe(false);
    expect(audited.slice(before)).toEqual([
      expect.objectContaining({
        environmentId: acting.ctx.environmentId,
        actor: acting.actor,
        action: WATCHLIST_OPT_IN_AUDIT_ACTIONS.accepted,
        resourceType: 'watchlist-source',
        resourceId: 'un-sc',
        metadata: { 'source-id': 'un-sc', 'terms-url': UN_TERMS },
      }),
    ]);
    expect(await optedInWatchlistSources(database.db, true)).toEqual(['un-sc']);
  });

  it('withdraws it, audited, after which the environment may not screen un-sc', async () => {
    const before = audited.length;
    await withdrawWatchlistOptIn(deps, acting, { allowed: true, sourceId: 'un-sc' });

    const settings = await settingsOf(acting.ctx.environmentId);
    expect(watchlistOptInOf(settings)).toBeNull();
    expect(environmentMayScreenSource('un-sc', settings, true)).toBe(false);
    expect(audited.slice(before)).toEqual([
      expect.objectContaining({
        action: WATCHLIST_OPT_IN_AUDIT_ACTIONS.withdrawn,
        resourceType: 'watchlist-source',
        resourceId: 'un-sc',
      }),
    ]);
    expect(await optedInWatchlistSources(database.db, true)).toEqual([]);
  });

  it('never reads a malformed stored value as an opt-in', () => {
    expect(
      watchlistOptInOf({
        'watchlist-un-opt-in': {
          'source-id': 'un-sc',
          'terms-url': 'not a url',
          'accepted-at': 'yesterday',
          'accepted-by': 'someone',
        },
      }),
    ).toBeNull();
  });
});

describe("the reconcile callers' opt-in member (Q10 granted 2026-11-21; KP11-31)", () => {
  it('is nothing while the install does not allow the opt-in, whatever a setting holds', async () => {
    await updateEnvironmentSettings(database.db, otherEnvironmentId, {
      'watchlist-un-opt-in': {
        'source-id': 'un-sc',
        'terms-url': UN_TERMS,
        'accepted-at': NOW.toISOString(),
        'accepted-by': acting.userId,
      },
    });
    try {
      expect(await watchlistReconcileOptIn(database.db, false)).toEqual({});
      expect(await watchlistReconcileOptIn(database.db, true)).toEqual({ optInSources: ['un-sc'] });
    } finally {
      await updateEnvironmentSettings(database.db, otherEnvironmentId, {
        'watchlist-un-opt-in': null,
      });
    }
  });

  it('names no source while the install allows it but no environment opted in', async () => {
    expect(await watchlistReconcileOptIn(database.db, true)).toEqual({ optInSources: [] });
  });
});
