/**
 * Workflow 10B (`api-integrity`; C211.5, C211.7): the inquiry's Play Integrity facts for the signal
 * computation, and where they may go.
 *
 * - `deviceIntegritySignalsInput` reads the bound provider (none: `null`), whether a token was
 *   taken and waits for its decode, and the stored verdict parsed against the projection (a stored
 *   value outside it reads as a failed decode, never a value). Through `computeInquirySignals` the
 *   sandbox provider's verdict reaches the two Play Integrity signals with its provenance.
 * - C211.7 (Play Integrity's terms): no Play Integrity field feeds a device list, the graph,
 *   `device-fingerprint` or `device-class`: only the two Play Integrity signals read the verdict, no
 *   graph kind is drawn from it, and no device or graph source reads the integrity tables.
 *
 * Every verdict is synthetic.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { computeInquirySignals } from '@openverify/checks';
import { GRAPH_KINDS, SIGNAL_REGISTRY } from '@openverify/core';
import {
  createInquiryIntegrityChallengeInTx,
  createInquirySession,
  createKeyring,
  hashSessionToken,
  SEALED,
  sealJson,
  setDefaultKeyring,
  storeInquiryIntegrityTokenInTx,
  storeInquiryIntegrityVerdict,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '../../test-support/fakes.js';
import { createDeviceIntegrityProvider, sandboxVerdict } from './index.js';
import { deviceIntegritySignalsInput } from './signals-input.js';

const NOW = new Date('2026-11-09T12:00:00.000Z');

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase({ keyring: createKeyring(randomBytes(32)) });
}, 120_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await database.close();
});

const sandbox = createDeviceIntegrityProvider('sandbox', { clock: fixedClock(NOW) });
const playIntegrity = createDeviceIntegrityProvider('play-integrity', {});

async function seeded() {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  return { environmentId: environment.id, id: inquiry.id };
}

async function tokenTaken(inquiry: { environmentId: string; id: string }) {
  const sessionRow = await createInquirySession(database.db, inquiry.environmentId, {
    id: testId('iqse'),
    inquiryId: inquiry.id,
    tokenHash: hashSessionToken(`ovs_${testId('iqse')}`),
    expiresAt: new Date(NOW.getTime() + 3_600_000),
  });
  const challengeId = testId('ich');
  await createInquiryIntegrityChallengeInTx(database.db, inquiry.environmentId, {
    id: challengeId,
    inquiryId: inquiry.id,
    sessionId: sessionRow.id,
    requestHash: 'C'.repeat(43),
    createdAt: NOW,
    expiresAt: new Date(NOW.getTime() + 600_000),
  });
  await storeInquiryIntegrityTokenInTx(database.db, inquiry.environmentId, {
    challengeId,
    sessionId: sessionRow.id,
    token: 'sandbox-strong',
    now: NOW,
  });
}

describe('deviceIntegritySignalsInput (C211.5)', () => {
  it('names no provider where none is bound, and the bound one otherwise', async () => {
    const inquiry = await seeded();

    expect(await deviceIntegritySignalsInput(database.db, inquiry, null)).toEqual({
      provider: null,
      tokenPending: false,
      verdict: null,
    });
    expect(await deviceIntegritySignalsInput(database.db, inquiry, playIntegrity)).toEqual({
      provider: { name: 'play-integrity', sandbox: false },
      tokenPending: false,
      verdict: null,
    });
  });

  it('reads a taken token without a verdict as pending, and the verdict once stored', async () => {
    const inquiry = await seeded();
    await tokenTaken(inquiry);

    expect(await deviceIntegritySignalsInput(database.db, inquiry, sandbox)).toMatchObject({
      tokenPending: true,
      verdict: null,
    });

    const projection = sandboxVerdict('sandbox-strong', NOW);
    await storeInquiryIntegrityVerdict(database.db, inquiry.environmentId, {
      inquiryId: inquiry.id,
      provider: 'sandbox',
      verdict: { ...projection },
      decodedAt: NOW,
    });

    expect(await deviceIntegritySignalsInput(database.db, inquiry, sandbox)).toEqual({
      provider: { name: 'sandbox', sandbox: true },
      tokenPending: false,
      verdict: { provider: 'sandbox', projection },
    });
  });

  it('reads a stored verdict outside the projection as a failed decode, never a value', async () => {
    const inquiry = await seeded();
    await database.client.query(
      `insert into inquiry_integrity_verdicts (environment_id, inquiry_id, provider, verdict, decoded_at)
       values ($1, $2, 'sandbox', $3, $4)`,
      [
        inquiry.environmentId,
        inquiry.id,
        sealJson(SEALED.integrityVerdict, inquiry.id, {
          outcome: 'decoded',
          accountDetails: { appLicensingVerdict: 'LICENSED' },
        }),
        NOW.toISOString(),
      ],
    );

    const input = await deviceIntegritySignalsInput(database.db, inquiry, sandbox);

    expect(input.verdict?.projection.outcome).toBe('failed');
    expect(JSON.stringify(input)).not.toContain('LICENSED');
  });

  it('carries the sandbox verdict to the two signals with its provenance', async () => {
    const inquiry = await seeded();
    await storeInquiryIntegrityVerdict(database.db, inquiry.environmentId, {
      inquiryId: inquiry.id,
      provider: 'sandbox',
      verdict: { ...sandboxVerdict('sandbox-unrecognized-app', NOW) },
      decodedAt: NOW,
    });

    const result = computeInquirySignals({
      environment: 'sandbox',
      collect: 'default',
      computedAt: NOW,
      sessions: [
        {
          id: 'iqse_a',
          createdAt: NOW,
          consented: true,
          signalsCollected: ['session-integrity'],
          userAgent: null,
          network: null,
          bodies: [],
          handoffFromSessionId: null,
        },
      ],
      governmentIdCountry: null,
      deviceIntegrity: await deviceIntegritySignalsInput(database.db, inquiry, sandbox),
    });

    const value = (name: string) => result.signals.find((signal) => signal.name === name)?.value;
    expect(value('inquiry/device_integrity_level')).toBe('device');
    expect(value('inquiry/app_recognized')).toBe(false);
    expect(result.details['inquiry/app_recognized']).toMatchObject({
      sources: [{ kind: 'provider', provider: 'sandbox', sandbox: true }],
    });
  });
});

describe('no Play Integrity field feeds a device list or the graph (C211.7)', () => {
  it('lets only the two Play Integrity signals read the verdict', () => {
    expect(
      SIGNAL_REGISTRY.filter((signal) => signal.inputs.includes('integrity-verdict')).map(
        ({ name }) => name,
      ),
    ).toEqual(['inquiry/device_integrity_level', 'inquiry/app_recognized']);
    for (const signal of SIGNAL_REGISTRY) {
      expect(signal.inputs, signal.name).not.toContain('device-fingerprint');
    }
  });

  it('draws no graph kind from it', () => {
    for (const kind of GRAPH_KINDS) {
      expect(kind).not.toMatch(/integrity|play|verdict|attest/);
    }
  });

  it('keeps the integrity tables out of every device and graph source', () => {
    const sources = [
      ...['devices.ts', 'device-trust.ts'].map(
        (name) => new URL(`../../../../../packages/db/src/repositories/${name}`, import.meta.url),
      ),
      ...readdirSync(new URL('../graph/', import.meta.url))
        .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
        .map((name) => new URL(`../graph/${name}`, import.meta.url)),
      ...readdirSync(new URL('../../../../../packages/db/src/repositories/', import.meta.url))
        .filter((name) => name.startsWith('graph') && !name.endsWith('.test.ts'))
        .map(
          (name) => new URL(`../../../../../packages/db/src/repositories/${name}`, import.meta.url),
        ),
      new URL('../signals/flow-signals.ts', import.meta.url),
      new URL('../../jobs/graph/index-job.ts', import.meta.url),
    ];
    expect(sources.length).toBeGreaterThan(5);
    for (const source of sources) {
      const text = readFileSync(source, 'utf8');
      expect(text, source.pathname).not.toMatch(
        /inquiry_integrity|inquiryIntegrity|IntegrityVerdict|integrity-verdict|device-integrity/,
      );
    }
  });
});
