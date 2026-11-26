/**
 * C62.7: the worker's `trust-anchor-refresh` runs the sync over every enabled manifest source,
 * logging each outcome by code and count only; it needs the outbound client, and it never runs
 * against a real list (the sources here are synthetic, served by a scripted client).
 */
import { loadTrustStore } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scriptedOutboundHttp, sha256Hex, syntheticSource } from '../../trust-anchors/testing.js';
import { PermanentJobError } from '../errors.js';
import { createCapturingLogger } from '../testing.js';
import {
  TRUST_ANCHOR_REFRESH_INTERVAL_MS,
  TRUST_ANCHOR_REFRESH_QUEUE,
  trustAnchorRefreshJob,
} from './trust-anchors.js';

const NOW = new Date('2026-10-20T12:00:00.000Z');
const SIGNED = new Date('2026-10-01T08:00:00.000Z');

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

describe('trustAnchorRefreshJob (C62.7)', () => {
  it('syncs the enabled sources every six hours and logs each outcome without data', async () => {
    const source = syntheticSource('refresh/root', NOW);
    const { http, requests } = scriptedOutboundHttp(
      source.routes(source.list([source.root], SIGNED)),
    );
    const logger = createCapturingLogger();
    const job = trustAnchorRefreshJob(
      {
        db: database.db,
        clock: { now: () => NOW },
        logger,
        outboundHttp: http,
        nfc: { allowIcaoCrls: false, trustAnchorRefresh: true },
      },
      { loadManifest: () => Promise.resolve(source.manifest()) },
    );

    await job.run();

    expect(job).toMatchObject({
      name: TRUST_ANCHOR_REFRESH_QUEUE,
      repeat: { every: TRUST_ANCHOR_REFRESH_INTERVAL_MS },
    });
    expect(TRUST_ANCHOR_REFRESH_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
    expect(requests.length).toBeGreaterThan(0);
    const { anchors } = await loadTrustStore(database.db, { environmentKind: 'production' });
    expect(anchors.map((anchor) => anchor.id)).toEqual([sha256Hex(source.root.der)]);
    expect(logger.entries).toContainEqual(
      expect.objectContaining({
        level: 'info',
        message: 'trust store refreshed',
        object: expect.objectContaining({
          queue: TRUST_ANCHOR_REFRESH_QUEUE,
          source: 'bsi-de',
          outcome: 'accepted',
          anchorsSeen: 1,
        }) as unknown,
      }),
    );
  });

  it('fails for good without an outbound client', async () => {
    const job = trustAnchorRefreshJob(
      { db: database.db, clock: { now: () => NOW }, logger: createCapturingLogger() },
      { loadManifest: () => Promise.reject(new Error('never read')) },
    );

    await expect(job.run()).rejects.toBeInstanceOf(PermanentJobError);
  });
});
