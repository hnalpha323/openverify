import { isId } from '@openverify/contracts';
import { PERMISSIONS } from '@openverify/core';
import { accounts as accountRows, type Db } from '@openverify/db';
import { createTestDatabase, createTestTenant } from '@openverify/db/testing';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { DnsResolverError } from '../dns/index.js';
import { NotFoundError } from '../errors.js';
import type { AuditEntry, ServiceContext } from '../ports.js';
import {
  createAllowAllRateLimiter,
  createCapturingMailer,
  createDenyRateLimiter,
  createFakeAccountsService,
  createFakeDnsResolver,
  createInMemoryKeyValueCache,
  createRefusingOutboundHttp,
  createRecordingDbAccountsService,
  createRecordingAuditLogger,
  createRecordingRedactionService,
  fixedClock,
  phase5TestDependencies,
  T0,
} from './fakes.js';
import { apiKeyPrincipal, createTestUserSessions, userPrincipal } from './principals.js';

const tx = {} as Db;
const ctx: ServiceContext = {
  organizationId: 'org_01M5CJXHG0000000000000000A',
  environmentId: 'env_01M5CJXHG0000000000000000A',
};
const otherCtx: ServiceContext = { ...ctx, environmentId: 'env_01M5CJXHG0000000000000000B' };
const API_RULE = { name: 'api', limit: 3, windowSeconds: 60 } as const;

describe('createRecordingAuditLogger', () => {
  const entry = (action: string): AuditEntry => ({
    environmentId: ctx.environmentId,
    organizationId: ctx.organizationId,
    actor: { type: 'user', id: 'usr_01M5CJXHG0000000000000000A' },
    action,
    resourceType: 'inquiry',
    resourceId: 'inq_01M5CJXHG0000000000000000A',
  });

  it('records entries in order and finds them by action', async () => {
    const audit = createRecordingAuditLogger();

    await audit.record(tx, entry('inquiry.approved'));
    await audit.record(tx, entry('inquiry.declined'));

    expect(audit.entries.map((recorded) => recorded.action)).toEqual([
      'inquiry.approved',
      'inquiry.declined',
    ]);
    expect(audit.withAction('inquiry.declined')).toEqual([entry('inquiry.declined')]);
  });

  it('can fail the next call once', async () => {
    const audit = createRecordingAuditLogger();
    audit.failNext(new Error('synthetic failure'));

    await expect(audit.record(tx, entry('inquiry.approved'))).rejects.toThrow('synthetic failure');
    await audit.record(tx, entry('inquiry.approved'));
    expect(audit.entries).toHaveLength(1);
  });
});

describe('createAllowAllRateLimiter', () => {
  it('allows every request and counts down per key and policy, never below zero', async () => {
    const limiter = createAllowAllRateLimiter(fixedClock());

    const decisions = [];
    for (let index = 0; index < 4; index += 1) {
      decisions.push(await limiter.consume('key-a', API_RULE));
    }
    const other = await limiter.consume('key-b', API_RULE);

    expect(decisions.map((decision) => decision.allowed)).toEqual([true, true, true, true]);
    expect(decisions.map((decision) => decision.remaining)).toEqual([2, 1, 0, 0]);
    expect(other.remaining).toBe(2);
    expect(decisions[0]).toMatchObject({
      limit: 3,
      retryAfterSeconds: 0,
      resetAt: new Date(T0.getTime() + 60_000),
    });
    expect(limiter.calls).toHaveLength(5);
    expect(limiter.calls[4]).toEqual({ key: 'key-b', policy: API_RULE });
  });
});

describe('createDenyRateLimiter', () => {
  it('refuses every request with the retry delay', async () => {
    const limiter = createDenyRateLimiter(42);

    expect(await limiter.consume('key-a', API_RULE)).toEqual({
      allowed: false,
      limit: 3,
      remaining: 0,
      resetAt: new Date(T0.getTime() + 42_000),
      retryAfterSeconds: 42,
    });
    expect(limiter.calls).toEqual([{ key: 'key-a', policy: API_RULE }]);
  });
});

describe('createCapturingMailer', () => {
  it('captures messages instead of sending them', async () => {
    const mailer = createCapturingMailer();
    const message = {
      to: { address: 'invitee@example.test' },
      subject: 'Invitation',
      text: 'Join us.',
    };

    await mailer.send(message);
    mailer.failNext(new Error('smtp down'));

    await expect(mailer.send(message)).rejects.toThrow('smtp down');
    expect(mailer.messages).toEqual([message]);
  });
});

describe('createFakeAccountsService', () => {
  it('uses the given account id', async () => {
    const accounts = createFakeAccountsService();

    expect(
      await accounts.resolveForInquiry(tx, ctx, { accountId: 'acc_01M5CJXHG0000000000000000A' }),
    ).toBe('acc_01M5CJXHG0000000000000000A');
  });

  it('finds or creates one account per reference id and environment', async () => {
    const accounts = createFakeAccountsService();

    const first = await accounts.resolveForInquiry(tx, ctx, { referenceId: 'ref-1' });
    const again = await accounts.resolveForInquiry(tx, ctx, { referenceId: 'ref-1' });
    const elsewhere = await accounts.resolveForInquiry(tx, otherCtx, { referenceId: 'ref-1' });

    expect(isId('acc', first)).toBe(true);
    expect(again).toBe(first);
    expect(elsewhere).not.toBe(first);
  });

  it('creates a new account otherwise and records every call', async () => {
    const accounts = createFakeAccountsService();

    const first = await accounts.resolveForInquiry(tx, ctx, {});
    const second = await accounts.resolveForInquiry(tx, ctx, {});

    expect(first).not.toBe(second);
    expect(accounts.calls).toEqual([
      { ctx, input: {} },
      { ctx, input: {} },
    ]);
  });
});

describe('createRecordingDbAccountsService', () => {
  it('resolves accounts on the account rows in the C13 order and records every call', async () => {
    const database = await createTestDatabase();
    try {
      const { organization, environment } = await createTestTenant(database.db);
      const own: ServiceContext = {
        organizationId: organization.id,
        environmentId: environment.id,
      };
      const accounts = createRecordingDbAccountsService();

      const created = await accounts.resolveForInquiry(database.db, own, {});
      const byReference = await accounts.resolveForInquiry(database.db, own, {
        referenceId: 'ref-1',
      });
      const again = await accounts.resolveForInquiry(database.db, own, { referenceId: 'ref-1' });
      const given = await accounts.resolveForInquiry(database.db, own, { accountId: created });

      expect(isId('acc', created)).toBe(true);
      expect(byReference).not.toBe(created);
      expect(again).toBe(byReference);
      expect(given).toBe(created);
      const rows = await database.db.select({ id: accountRows.id }).from(accountRows);
      expect(rows.map((row) => row.id).sort()).toEqual([created, byReference].sort());
      expect(accounts.calls).toEqual([
        { ctx: own, input: {} },
        { ctx: own, input: { referenceId: 'ref-1' } },
        { ctx: own, input: { referenceId: 'ref-1' } },
        { ctx: own, input: { accountId: created } },
      ]);
    } finally {
      await database.close();
    }
  });

  it('answers 404 for an account id that is not in the environment', async () => {
    const database = await createTestDatabase();
    try {
      const { organization, environment } = await createTestTenant(database.db);
      const accounts = createRecordingDbAccountsService();

      await expect(
        accounts.resolveForInquiry(
          database.db,
          { organizationId: organization.id, environmentId: environment.id },
          { accountId: 'acc_01M5CJXHG0000000000000000A' },
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    } finally {
      await database.close();
    }
  });
});

describe('createRecordingRedactionService', () => {
  it('records redactions and reports a repeated one as already redacted', async () => {
    const clock = fixedClock();
    const redaction = createRecordingRedactionService(clock);
    const actor = { type: 'user', id: 'usr_01M5CJXHG0000000000000000A' } as const;

    const first = await redaction.redactInquiry(ctx, 'inq_1', actor);
    clock.advance(1_000);
    const repeated = await redaction.redactInquiry(ctx, 'inq_1', null);
    const account = await redaction.redactAccount(ctx, 'acc_1', actor);

    expect(first).toEqual({ redactedAt: T0, alreadyRedacted: false });
    expect(repeated).toEqual({ redactedAt: T0, alreadyRedacted: true });
    expect(account.alreadyRedacted).toBe(false);
    expect(redaction.redactions).toEqual([
      { target: 'inquiry', ctx, id: 'inq_1', actor },
      { target: 'inquiry', ctx, id: 'inq_1', actor: null },
      { target: 'account', ctx, id: 'acc_1', actor },
    ]);
  });
});

describe('principal builders', () => {
  it('build a user principal with every permission and satisfied MFA by default', () => {
    const principal = userPrincipal({ organizationId: 'org_1', environmentId: 'env_1' });

    expect(principal).toMatchObject({
      kind: 'user',
      organizationId: 'org_1',
      environmentId: 'env_1',
      environmentKind: 'sandbox',
      mfaSatisfied: true,
    });
    expect(principal.permissions).toEqual(new Set(PERMISSIONS));
    expect(isId('usr', principal.userId)).toBe(true);
    expect(isId('uss', principal.userSessionId)).toBe(true);
  });

  it('build a user principal with the chosen permissions, environment kind and MFA state', () => {
    const principal = userPrincipal({
      organizationId: 'org_1',
      environmentId: 'env_1',
      environmentKind: 'production',
      permissions: ['inquiries:read'],
      mfaSatisfied: false,
      userId: 'usr_fixed',
    });

    expect(principal).toMatchObject({
      environmentKind: 'production',
      mfaSatisfied: false,
      userId: 'usr_fixed',
    });
    expect(principal.permissions).toEqual(new Set(['inquiries:read']));
  });

  it('build an API key principal', () => {
    const principal = apiKeyPrincipal({
      organizationId: 'org_1',
      environmentId: 'env_1',
      permissions: ['events:read'],
    });

    expect(principal).toMatchObject({ kind: 'api-key', environmentKind: 'sandbox' });
    expect(principal.permissions).toEqual(new Set(['events:read']));
    expect(isId('key', principal.apiKeyId)).toBe(true);
  });
});

describe('createTestUserSessions', () => {
  it('issues ovu_ tokens that resolve to their principal until revoked', async () => {
    const sessions = createTestUserSessions();
    const principal = userPrincipal({ organizationId: 'org_1', environmentId: 'env_1' });

    const token = sessions.issue(principal);

    expect(token).toMatch(/^ovu_[A-Za-z0-9_-]{43}$/);
    expect(await sessions.resolve(token, {} as FastifyRequest)).toBe(principal);
    sessions.revoke(token);
    expect(await sessions.resolve(token, {} as FastifyRequest)).toBeNull();
    expect(await sessions.resolve(`ovu_${'A'.repeat(43)}`, {} as FastifyRequest)).toBeNull();
  });
});

describe('createInMemoryKeyValueCache (C54.3)', () => {
  it('reads what it stored until the TTL passes on the test clock', async () => {
    const clock = fixedClock();
    const cache = createInMemoryKeyValueCache(clock);

    await cache.set('openverify:cache:a', 'one', 60);
    await expect(cache.get('openverify:cache:a')).resolves.toBe('one');
    expect(cache.keys()).toEqual(['openverify:cache:a']);
    clock.advance(60_000);

    await expect(cache.get('openverify:cache:a')).resolves.toBeNull();
    expect(cache.keys()).toEqual([]);
  });

  it('keeps capped lists newest first with their TTL, and deletes keys', async () => {
    const clock = fixedClock();
    const cache = createInMemoryKeyValueCache(clock);

    for (const value of ['a', 'b', 'c']) {
      await cache.pushCapped('openverify:sandbox-sms:env_x', value, 2, 900);
    }

    await expect(cache.listRange('openverify:sandbox-sms:env_x', 5)).resolves.toEqual(['c', 'b']);
    await cache.delete('openverify:sandbox-sms:env_x');
    await expect(cache.listRange('openverify:sandbox-sms:env_x', 5)).resolves.toEqual([]);
    await cache.pushCapped('openverify:sandbox-sms:env_y', 'z', 2, 900);
    clock.advance(900_000);
    await expect(cache.listRange('openverify:sandbox-sms:env_y', 5)).resolves.toEqual([]);
  });

  it('holds at most the limit of leases, which lapse on the test clock or are given back (K8-8)', async () => {
    const clock = fixedClock();
    const cache = createInMemoryKeyValueCache(clock);
    const key = 'openverify:workflow-https-slot:x';

    await expect(cache.acquireLease(key, 'a', 2, 60)).resolves.toBe(true);
    await expect(cache.acquireLease(key, 'b', 2, 60)).resolves.toBe(true);
    await expect(cache.acquireLease(key, 'c', 2, 60)).resolves.toBe(false);
    await cache.releaseLease(key, 'a');
    await expect(cache.acquireLease(key, 'c', 2, 60)).resolves.toBe(true);
    clock.advance(60_000);
    await expect(cache.acquireLease(key, 'd', 1, 60)).resolves.toBe(true);
    await expect(cache.acquireLease(key, 'e', 1, 60)).resolves.toBe(false);
    await expect(cache.acquireLease(key, 'f', 0, 60)).rejects.toBeInstanceOf(RangeError);
  });

  it('keeps the real cache rules and rejects once when told, as Valkey down would', async () => {
    const cache = createInMemoryKeyValueCache();

    await expect(cache.get('person@example.test')).rejects.toBeInstanceOf(RangeError);
    await expect(cache.set('openverify:cache:a', 'x', 0)).rejects.toBeInstanceOf(RangeError);
    cache.failNext(new Error('synthetic outage'));
    await expect(cache.get('openverify:cache:a')).rejects.toThrow('synthetic outage');
    await expect(cache.get('openverify:cache:a')).resolves.toBeNull();
  });
});

describe('createFakeDnsResolver (C54.3)', () => {
  it('answers from its zones only and records each query', async () => {
    const resolver = createFakeDnsResolver({
      'example.test': { mx: [{ exchange: 'mx.example.test', priority: 10 }], a: ['192.0.2.1'] },
      'down.example.test': new DnsResolverError('timeout'),
    });

    await expect(resolver.resolveMx('example.test')).resolves.toEqual([
      { exchange: 'mx.example.test', priority: 10 },
    ]);
    await expect(resolver.resolve4('example.test')).resolves.toEqual(['192.0.2.1']);
    await expect(resolver.resolve6('example.test')).rejects.toMatchObject({ code: 'no_data' });
    await expect(resolver.resolve4('missing.example.test')).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(resolver.resolveMx('down.example.test')).rejects.toMatchObject({
      code: 'timeout',
    });
    expect(resolver.queries).toEqual([
      { type: 'mx', hostname: 'example.test' },
      { type: 'a', hostname: 'example.test' },
      { type: 'aaaa', hostname: 'example.test' },
      { type: 'a', hostname: 'missing.example.test' },
      { type: 'mx', hostname: 'down.example.test' },
    ]);
  });
});

describe('createRefusingOutboundHttp (C54.6)', () => {
  it('refuses every request as blocked and records it, so no test reaches the network', async () => {
    const outbound = createRefusingOutboundHttp();
    const client = outbound.client({ name: 'twilio', contentTypes: ['application/json'] });
    const request = { method: 'POST' as const, url: 'https://api.example.test/messages' };

    await expect(client.request(request)).rejects.toMatchObject({
      name: 'OutboundHttpError',
      code: 'blocked',
      retryable: false,
    });
    expect(outbound.requests).toEqual([{ client: 'twilio', request }]);
    await expect(outbound.close()).resolves.toBeUndefined();
  });
});

// Workflow 5C review K9: as `.env.example` binds it, the sandbox SMS sender is bound for sandbox
// environments, so a template with a phone step publishes without a per-test override.
describe('phase5TestDependencies (C54.3)', () => {
  it('binds the sandbox SMS sender for sandbox environments and nothing for production', () => {
    const { providers } = phase5TestDependencies();

    expect(providers.sandbox.sms).toMatchObject({ id: 'sandbox', sandbox: true });
    expect(providers.production).toEqual({});
  });

  it('keeps the sandbox sender’s codes in its own cache, for the sandbox sink', async () => {
    const dependencies = phase5TestDependencies(fixedClock());
    const sender = dependencies.providers.sandbox.sms;
    if (sender?.sandbox !== true) {
      throw new Error('no sandbox sender bound');
    }

    await sender.send(
      { to: '+15550100014', body: 'Synthetic: 123456 is your verification code.' },
      { environmentId: 'env_synthetic', destinationIndex: 'a'.repeat(64), code: '123456' },
    );

    expect(dependencies.cache.keys()).toEqual(['openverify:sandbox-sms:env_synthetic']);
  });
});
