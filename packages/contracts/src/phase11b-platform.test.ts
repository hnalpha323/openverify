/**
 * Phase 11, Workflow 11B Stage 1a, checkpoint (P) (C249.4, C250): `/ready`'s answers, the worker's
 * heartbeat, the migrate lock and `org:create`'s invitation. Read through the package root, so a name
 * that does not exist yet fails here at run time, never at compile time.
 */
import { createHash } from 'node:crypto';
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

describe('GET /ready (C250.1)', () => {
  it('holds one golden per answer, in a folder Android does not read', () => {
    expect(listFixtures('api/platform')).toEqual(['not-ready.json', 'ready.json']);
  });

  it('answers 200 ready, nothing else', () => {
    const ready = schema('readyResponseSchema');
    expect(ready.parse(readFixture('api/platform/ready.json'))).toEqual({ status: 'ready' });
    expect(ready.safeParse({ status: 'ready', version: '1' }).success).toBe(false);
  });

  it('answers 503 not_ready with each store ok or unavailable and no error text', () => {
    const notReady = schema('notReadyResponseSchema');
    const raw = readFixture('api/platform/not-ready.json');
    expect(notReady.parse(raw)).toEqual(raw);
    expect(
      notReady.safeParse({
        status: 'not_ready',
        checks: { postgres: 'ok', valkey: 'ECONNREFUSED 192.0.2.5:6379' },
      }).success,
    ).toBe(false);
    expect(notReady.safeParse({ status: 'not_ready', checks: { postgres: 'ok' } }).success).toBe(
      false,
    );
    expect(pick('READINESS_CHECKS')).toEqual(['postgres', 'valkey']);
    expect(pick('READINESS_CHECK_TIMEOUT_MS')).toBe(1000);
  });
});

describe('the worker heartbeat (C250.2)', () => {
  it('is written every 10 s and stale after 30 s, to a file by default under /tmp', () => {
    expect(pick('WORKER_HEARTBEAT')).toEqual({
      intervalMs: 10_000,
      maxAgeMs: 30_000,
      defaultFile: '/tmp/openverify-worker-heartbeat',
    });
  });
});

describe('the migrate lock (C249.4)', () => {
  it('waits 600 s by default and then exits 75 with migrate_lock_timeout', () => {
    expect(pick('MIGRATE_LOCK')).toEqual({
      label: 'openverify:migrate',
      key: '1480802125763551134',
      timeoutSecondsDefault: 600,
      timeoutSecondsMax: 3600,
      exitCode: 75,
      code: 'migrate_lock_timeout',
    });
  });

  it('derives the advisory key from the label: the first 8 bytes of its SHA-256, signed', () => {
    const digest = createHash('sha256').update('openverify:migrate').digest();
    expect((pick('MIGRATE_LOCK') as { key?: string } | undefined)?.key).toBe(
      digest.readBigInt64BE(0).toString(),
    );
  });
});

describe('org:create (C250.5)', () => {
  it('sends a single-use invitation of 24 hours, and names its flags', () => {
    expect(pick('ORG_CREATE')).toEqual({
      invitationTtlSeconds: 86_400,
      flags: ['--name', '--admin-email', '--slug', '--print-invitation'],
    });
  });
});
