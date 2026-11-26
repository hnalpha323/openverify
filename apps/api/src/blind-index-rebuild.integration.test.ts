/**
 * C249.3 (decision 14, B7-E1; Phase 11, Workflow 11B, platform-ops; orchestrator item 15:
 * `blind-index:rebuild` runs as the runtime role), against a real Postgres 17 migrated by its
 * owner: the whole rebuild (extractions, OTP destinations, wallet addresses, chip reads, devices,
 * list keys, transaction and case field keys, audit addresses, the graph and the report indexes)
 * completes as the runtime role from `createRuntimeRole` (what `db:grant-runtime` grants), with no
 * `WARNING`, and re-indexes what it finds under the new key; a device that meets its twin under
 * the new key is merged into it and deleted (`rebuildDeviceIndexes`, C127.9). Every value is synthetic: fictional
 * Utopia holders.
 */
import { randomBytes } from 'node:crypto';
import { newId } from '@openverify/contracts';
import { emptyExtractedFields } from '@openverify/core';
import {
  blindIndexKeyId,
  createDatabase,
  createGovernmentIdExtraction,
  createInquirySession,
  createKeyring,
  createVerification,
  deviceIdentifierInputs,
  extractionIndexOf,
  getDevice,
  getGovernmentIdExtraction,
  hashSessionToken,
  identifierKey,
  linkSessionDevice,
  markInquirySessionStarted,
  runMigrations,
  setDefaultKeyring,
  storeSessionSignalBody,
  type Database,
} from '@openverify/db';
import {
  createIntegrationPool,
  createRuntimeRole,
  createTestInquiry,
  createTestTenant,
  ifSet,
  startIntegrationPostgres,
  TEST_RUNTIME_ROLE,
  testId,
} from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runBlindIndexRebuild } from '../scripts/blind-index-rebuild.js';

const OLD_KEY = new Uint8Array(32).fill(1);
const NEW_KEY = new Uint8Array(32).fill(2);

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
/** Every `WARNING` the runtime role's connections receive (C249.3: none). */
const warnings: string[] = [];

beforeAll(async () => {
  setDefaultKeyring(createKeyring(randomBytes(32)));
  container = await startIntegrationPostgres();
  const owner = createIntegrationPool(container.getConnectionUri(), { max: 2 });
  try {
    await runMigrations(createDatabase(owner));
  } finally {
    await owner.end();
  }
  pool = createIntegrationPool(await createRuntimeRole(container.getConnectionUri()), { max: 4 });
  pool.on('connect', (client) => {
    client.on('notice', (notice) => {
      if (notice.severity === 'WARNING') {
        warnings.push(notice.message ?? '');
      }
    });
  });
  db = createDatabase(pool);
}, 180_000);

afterAll(async () => {
  await ifSet(pool)?.end();
  await container?.stop();
  setDefaultKeyring(undefined);
});

const fields = {
  ...emptyExtractedFields(),
  'name-last': 'VALEMONT-SYNTHETIC',
  'identification-number': 'X12K45P78',
  'issuing-authority-code': 'UTO',
};

describe('blind-index:rebuild as the runtime role (C249.3)', () => {
  it('re-indexes under the new key as a non-owner role, with no WARNING', async () => {
    const { environment } = await createTestTenant(db);
    const { inquiry } = await createTestInquiry(db, environment.id);
    const verificationId = newId('ver');
    await createVerification(db, environment.id, {
      id: verificationId,
      inquiryId: inquiry.id,
      type: 'government_id',
    });
    await createGovernmentIdExtraction(db, environment.id, {
      verificationId,
      fields,
      fieldSources: {},
      identificationNumberIndex: extractionIndexOf(OLD_KEY, {
        environmentId: environment.id,
        fields,
        classGroup: 'national_id',
      }),
      frontPhash: null,
      idClassGroup: 'national_id',
    });
    const lines: string[] = [];

    const result = await runBlindIndexRebuild({
      db,
      key: NEW_KEY,
      args: { batchSize: 1 },
      out: (line) => lines.push(line),
    });

    expect(result.updated).toBe(1);
    expect(
      (await getGovernmentIdExtraction(db, environment.id, verificationId))
        ?.identificationNumberIndex,
    ).toBe(
      extractionIndexOf(NEW_KEY, {
        environmentId: environment.id,
        fields,
        classGroup: 'national_id',
      }),
    );
    expect(lines.length).toBeGreaterThan(5);
    const who = await pool.query<{ name: string; owner: boolean }>(
      `select current_user as name,
              pg_has_role(current_user, (select pg_get_userbyid(datdba) from pg_database
                                          where datname = current_database()), 'member') as owner`,
    );
    expect(who.rows[0]).toEqual({ name: TEST_RUNTIME_ROLE, owner: false });
    expect(warnings).toEqual([]);
  });

  it('merges a device into its twin under the new key and deletes it, as the runtime role', async () => {
    const at = new Date('2027-02-01T10:00:00.000Z');
    const { environment } = await createTestTenant(db);
    const env = environment.id;
    const { inquiry } = await createTestInquiry(db, env);
    const sessions: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const session = await createInquirySession(db, env, {
        id: testId('iqse'),
        inquiryId: inquiry.id,
        tokenHash: hashSessionToken(`ovs_${testId('iqse')}`),
        expiresAt: new Date(at.getTime() + 3_600_000),
      });
      sessions.push(session.id);
    }
    const [first = '', second = ''] = sessions;
    const recognition = {
      screen: {
        'width-bucket': 1920,
        'height-bucket': 1080,
        'color-depth': 24,
        'pixel-ratio-bucket': 1,
      },
      'hardware-concurrency': 8,
      'device-memory': 8,
      'max-touch-points': 0,
      'canvas-digest': 'a'.repeat(64),
      'canvas-noise': false,
      'webgl-vendor': 'Example Vendor',
      'webgl-renderer': 'Example Renderer',
    };
    await markInquirySessionStarted(db, env, first, { at });
    await storeSessionSignalBody(db, env, {
      inquirySessionId: first,
      sequence: 0,
      screen: 'start',
      platform: 'web',
      collectorVersion: 1,
      components: { recognition },
      behaviour: { 'paste-count': 0 },
      at,
    });
    const inputs = deviceIdentifierInputs('web', { recognition });
    const keyed = (key: Uint8Array, kind: 'browser-fingerprint' | 'device-class') =>
      identifierKey(key, {
        environmentId: env,
        kind,
        input: (kind === 'device-class' ? inputs?.deviceClass : inputs?.browserFingerprint) ?? '',
      });
    const write = (sessionId: string, key: Uint8Array) => ({
      deviceId: testId('dev'),
      inquirySessionId: sessionId,
      platform: 'web' as const,
      collectorVersion: 1,
      browserFingerprint: keyed(key, 'browser-fingerprint'),
      deviceFingerprint: null,
      deviceClass: keyed(key, 'device-class'),
      fingerprintRandomised: false,
      keyId: blindIndexKeyId(key),
      at,
    });
    const rekeyed = await linkSessionDevice(db, env, write(first, OLD_KEY));
    const twin = await linkSessionDevice(db, env, write(second, NEW_KEY));

    await runBlindIndexRebuild({ db, key: NEW_KEY, args: { batchSize: 10 }, out: () => undefined });

    expect(await getDevice(db, env, rekeyed.id)).toBeNull();
    expect(await getDevice(db, env, twin.id)).toMatchObject({ keyId: blindIndexKeyId(NEW_KEY) });
    expect(warnings).toEqual([]);
  });
});
