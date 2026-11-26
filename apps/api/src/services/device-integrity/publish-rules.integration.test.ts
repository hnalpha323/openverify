/**
 * Workflow 10B (`api-integrity`; C210.5, C211.9; review V05): the device-integrity publish rules
 * through `flowPublishReport` on a real Postgres (Testcontainers): with a `deviceIntegrity` provider
 * bound, a consent that starts the session-integrity collection needs `notice.play-integrity` on it
 * or before it (`play_integrity_notice_missing`); in every environment a failure behind a route on a
 * signal that is not decisive alone is refused (`signal_not_decisive_alone`). Every value is
 * synthetic.
 */
import { randomBytes } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  createDatabase,
  createKeyring,
  getInquiryTemplateVersion,
  runMigrations,
  setDefaultKeyring,
  type Database,
  type InquiryTemplateVersion,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestInquiry,
  createTestTenant,
  startIntegrationPostgres,
} from '@openverify/db/testing';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { flowPublishReport } from '../publish/flow-v2.js';

let postgres: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let db: Database;
let environmentId: string;
let version: InquiryTemplateVersion;

beforeAll(async () => {
  postgres = await startIntegrationPostgres();
  pool = createIntegrationPool(postgres.getConnectionUri(), { max: 4 });
  db = createDatabase(pool);
  setDefaultKeyring(createKeyring(randomBytes(32)));
  await runMigrations(db);
  environmentId = (await createTestTenant(db)).environment.id;
  const { inquiry } = await createTestInquiry(db, environmentId);
  const stored = await getInquiryTemplateVersion(
    db,
    environmentId,
    inquiry.inquiryTemplateVersionId,
  );
  if (stored === null) {
    throw new Error('no version');
  }
  version = stored;
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await postgres?.stop();
  setDefaultKeyring(undefined);
});

const meta = { specVersion: 2, id: 'integrity', version: 1, name: 'Integrity' };

/** A v2 flow: a consent with `textKeys`, an ID, then `tail` (steps and edges after the ID). */
function flowWith(
  textKeys: string[],
  tail: { steps: object[]; edges: [string, string, string][] } = {
    steps: [{ id: 'done', type: 'completion' }],
    edges: [['id_card', 'next', 'done']],
  },
) {
  const edges = [['consent', 'next', 'id_card'], ...tail.edges].map(([from, port, to], index) => ({
    id: `e${String(index)}`,
    from,
    port,
    to,
  }));
  return {
    metadata: meta,
    entry: 'consent',
    steps: [
      { id: 'consent', type: 'consent', textKeys, required: true },
      {
        id: 'id_card',
        type: 'government_id',
        sides: 'front',
        maxAttempts: 2,
        captureMethods: ['camera'],
      },
      ...tail.steps,
    ],
    edges,
  };
}

const codesOf = async (flow: Record<string, unknown>, deviceIntegrityBound?: boolean) =>
  (
    await flowPublishReport(db, {
      environment: { id: environmentId, kind: 'sandbox' },
      templateId: version.inquiryTemplateId,
      version: { ...version, flow },
      ...(deviceIntegrityBound === undefined ? {} : { deviceIntegrityBound }),
    })
  ).problems.map(({ code, pointer }) => `${code} ${pointer}`);

const COLLECTING = ['consent.biometric', 'notice.session-integrity'];

describe('play_integrity_notice_missing through the publish report (C211.9, review V05)', () => {
  it('refuses a bound environment’s collection without the notice', async () => {
    expect(await codesOf(flowWith(COLLECTING), true)).toContain(
      'play_integrity_notice_missing /flow/steps/0',
    );
  });

  it('passes the notice shown on the consent, and asks nothing where nothing is bound', async () => {
    const codes = await codesOf(flowWith([...COLLECTING, 'notice.play-integrity']), true);
    expect(codes.filter((code) => code.startsWith('play_integrity_notice_missing'))).toEqual([]);
    expect(
      (await codesOf(flowWith(COLLECTING), false)).filter((code) =>
        code.startsWith('play_integrity_notice_missing'),
      ),
    ).toEqual([]);
  });
});

describe('signal_not_decisive_alone through the publish report (C210.5)', () => {
  it('refuses a failure right after a route on a device heuristic', async () => {
    const flow = flowWith(COLLECTING, {
      steps: [
        {
          id: 'device',
          type: 'branch',
          routes: [
            {
              key: 'rooted',
              label: 'Rooted',
              condition: { '===': [{ var: 'signals.inquiry/device_rooted' }, true] },
              onNull: 'else',
            },
          ],
          waitFor: { facts: ['signals.inquiry/device_rooted'], maxSeconds: 5 },
        },
        { id: 'done', type: 'completion' },
        { id: 'rejected', type: 'failure' },
      ],
      edges: [
        ['id_card', 'next', 'device'],
        ['device', 'route:rooted', 'rejected'],
        ['device', 'else', 'done'],
      ],
    });

    expect(await codesOf(flow)).toContain('signal_not_decisive_alone /flow/steps/4');
  });
});
