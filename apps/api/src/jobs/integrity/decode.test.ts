/**
 * Workflow 10B (`api-integrity`; C211.4, owner decision 5 after Workflow 6C): the `integrity-decode`
 * job. For one challenge it reads the posted token (left in place for a retry), decodes it through
 * the environment kind's bound `deviceIntegrity` provider, stores only the verdict's projection under
 * the inquiry's lock and takes the token. A failure that may pass is retried with the token kept; a
 * refused token is stored as a failed decode. An inquiry redacted before or during the decode gets
 * nothing written, and its token is taken. Nothing it logs carries the token or the verdict.
 *
 * Every token is synthetic; the sandbox provider and in-process fakes answer, never Google.
 */
import { randomBytes } from 'node:crypto';
import {
  createInquiryIntegrityChallengeInTx,
  createInquirySession,
  createKeyring,
  getInquiryIntegrityVerdict,
  hashSessionToken,
  readInquiryIntegrityToken,
  setDefaultKeyring,
  storeInquiryIntegrityTokenInTx,
  type Keyring,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DeviceIntegrityProvider, ProviderBindings } from '../../ports.js';
import {
  createDeviceIntegrityProvider,
  DeviceIntegrityDecodeError,
} from '../../services/device-integrity/index.js';
import { fixedClock } from '../../test-support/fakes.js';
import { PermanentJobError } from '../errors.js';
import { createCapturingLogger } from '../testing.js';
import { processIntegrityDecode, type IntegrityDecodeDeps } from './decode.js';

const NOW = new Date('2026-11-09T12:00:00.000Z');
const HASH = 'B'.repeat(43);

let database: TestDatabase;
let keyring: Keyring;

beforeAll(async () => {
  keyring = createKeyring(randomBytes(32));
  database = await createTestDatabase({ keyring });
}, 120_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await database.close();
});

async function posted(token: string) {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const session = await createInquirySession(database.db, environment.id, {
    id: testId('iqse'),
    inquiryId: inquiry.id,
    tokenHash: hashSessionToken(`ovs_${testId('iqse')}`),
    expiresAt: new Date(NOW.getTime() + 3_600_000),
  });
  const challengeId = testId('ich');
  await createInquiryIntegrityChallengeInTx(database.db, environment.id, {
    id: challengeId,
    inquiryId: inquiry.id,
    sessionId: session.id,
    requestHash: HASH,
    createdAt: NOW,
    expiresAt: new Date(NOW.getTime() + 600_000),
  });
  expect(
    await storeInquiryIntegrityTokenInTx(database.db, environment.id, {
      challengeId,
      sessionId: session.id,
      token,
      now: NOW,
    }),
  ).toBe('stored');
  return { environmentId: environment.id, inquiryId: inquiry.id, challengeId };
}

const bindings = (provider: DeviceIntegrityProvider | undefined): ProviderBindings => ({
  sandbox: provider === undefined ? {} : { deviceIntegrity: provider },
  production: {},
});

function depsWith(provider: DeviceIntegrityProvider | undefined) {
  const logger = createCapturingLogger();
  const deps: IntegrityDecodeDeps = {
    db: database.db,
    clock: fixedClock(NOW),
    logger,
    keyring,
    providers: bindings(provider),
  };
  return { deps, logger };
}

const sandbox = createDeviceIntegrityProvider('sandbox', { clock: fixedClock(NOW) });

const verdictOf = (seeded: Awaited<ReturnType<typeof posted>>) =>
  getInquiryIntegrityVerdict(database.db, seeded.environmentId, seeded.inquiryId);

const tokenOf = (seeded: Awaited<ReturnType<typeof posted>>) =>
  readInquiryIntegrityToken(database.db, seeded.environmentId, seeded.challengeId);

const redact = (seeded: Awaited<ReturnType<typeof posted>>) =>
  database.client.query('update inquiries set redacted_at = $1 where id = $2', [
    NOW.toISOString(),
    seeded.inquiryId,
  ]);

describe('processIntegrityDecode (C211.4)', () => {
  it('decodes the token through the bound provider, stores the projection and takes the token', async () => {
    const seeded = await posted('sandbox-device');
    const { deps, logger } = depsWith(sandbox);

    await expect(
      processIntegrityDecode(
        { environmentId: seeded.environmentId, challengeId: seeded.challengeId },
        deps,
      ),
    ).resolves.toEqual({ outcome: 'decoded' });

    expect(await verdictOf(seeded)).toEqual({
      inquiryId: seeded.inquiryId,
      provider: 'sandbox',
      verdict: {
        outcome: 'decoded',
        'device-recognition': ['MEETS_DEVICE_INTEGRITY', 'MEETS_BASIC_INTEGRITY'],
        'app-recognition': 'PLAY_RECOGNIZED',
        checks: {
          'package-name': true,
          'request-hash': true,
          timestamp: true,
          'app-recognized': true,
          'certificate-digest': true,
        },
        'decoded-at': NOW.toISOString(),
      },
      decodedAt: NOW,
    });
    expect(await tokenOf(seeded)).toBeNull();
    expect(JSON.stringify(logger.entries)).not.toContain('sandbox-device');
    expect(JSON.stringify(logger.entries)).not.toContain('MEETS_');
  });

  it('passes the challenge’s request hash to the provider, and the token once', async () => {
    const seeded = await posted('synthetic-integrity-token-hash');
    const seen: { token: string; requestHash: string }[] = [];
    const recording: DeviceIntegrityProvider = {
      id: 'sandbox',
      name: 'sandbox',
      sandbox: true,
      decode: (request) => {
        seen.push(request);
        return sandbox.decode({ ...request, token: 'sandbox-basic' });
      },
    };

    await processIntegrityDecode(
      { environmentId: seeded.environmentId, challengeId: seeded.challengeId },
      depsWith(recording).deps,
    );

    expect(seen).toEqual([{ token: 'synthetic-integrity-token-hash', requestHash: HASH }]);
  });

  it('keeps the token for a retry when the decode may pass, naming no token', async () => {
    const seeded = await posted('synthetic-integrity-token-retry');
    const failing: DeviceIntegrityProvider = {
      ...sandbox,
      decode: () => Promise.reject(new DeviceIntegrityDecodeError('decode_unavailable', true)),
    };

    const error = await processIntegrityDecode(
      { environmentId: seeded.environmentId, challengeId: seeded.challengeId },
      depsWith(failing).deps,
    ).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PermanentJobError);
    expect(String(error)).not.toContain('synthetic-integrity-token-retry');
    expect(await tokenOf(seeded)).not.toBeNull();
    expect(await verdictOf(seeded)).toBeNull();
  });

  it('stores a refused token as a failed decode and takes it', async () => {
    const seeded = await posted('synthetic-integrity-token-unknown');
    const { deps, logger } = depsWith(sandbox);

    await processIntegrityDecode(
      { environmentId: seeded.environmentId, challengeId: seeded.challengeId },
      deps,
    );

    expect(await verdictOf(seeded)).toMatchObject({
      provider: 'sandbox',
      verdict: { outcome: 'failed', 'device-recognition': [], 'app-recognition': null },
    });
    expect(await tokenOf(seeded)).toBeNull();
    expect(logger.entries).toEqual([
      expect.objectContaining({
        level: 'warn',
        object: expect.objectContaining({ code: 'sandbox_token_unknown' }) as unknown,
      }),
    ]);
    expect(JSON.stringify(logger.entries)).not.toContain('synthetic-integrity-token-unknown');
  });

  it('skips a challenge with no token, and takes the token where no provider is bound any more', async () => {
    const none = await posted('sandbox-strong');
    await processIntegrityDecode(
      { environmentId: none.environmentId, challengeId: testId('ich') },
      depsWith(sandbox).deps,
    ).then((result) => {
      expect(result).toEqual({ outcome: 'skipped' });
    });

    await expect(
      processIntegrityDecode(
        { environmentId: none.environmentId, challengeId: none.challengeId },
        depsWith(undefined).deps,
      ),
    ).resolves.toEqual({ outcome: 'skipped' });
    expect(await tokenOf(none)).toBeNull();
    expect(await verdictOf(none)).toBeNull();
  });

  it('writes nothing for an inquiry redacted after its token was posted, and takes the token', async () => {
    const seeded = await posted('sandbox-strong');
    await redact(seeded);

    await expect(
      processIntegrityDecode(
        { environmentId: seeded.environmentId, challengeId: seeded.challengeId },
        depsWith(sandbox).deps,
      ),
    ).resolves.toEqual({ outcome: 'skipped' });

    expect(await verdictOf(seeded)).toBeNull();
    expect(await tokenOf(seeded)).toBeNull();
  });

  it('writes nothing for an inquiry redacted while its token was being decoded', async () => {
    const seeded = await posted('sandbox-strong');
    const redactingDuringDecode: DeviceIntegrityProvider = {
      ...sandbox,
      decode: async (request) => {
        await redact(seeded);
        return sandbox.decode(request);
      },
    };

    await expect(
      processIntegrityDecode(
        { environmentId: seeded.environmentId, challengeId: seeded.challengeId },
        depsWith(redactingDuringDecode).deps,
      ),
    ).resolves.toEqual({ outcome: 'skipped' });

    expect(await verdictOf(seeded)).toBeNull();
    expect(await tokenOf(seeded)).toBeNull();
  });
});
