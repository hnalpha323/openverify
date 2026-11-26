/**
 * Migration 0034 (Workflow 10C, `contracts-10c`), upgrading a database at 0033 on PGlite: the
 * Workflow's one migration. `chip_challenges.sandbox_scenario` (C208.1): the scenario of the sandbox
 * test chip the server built for a challenge, `null` on every challenge written before it and on
 * every challenge no sandbox chip was built for, held to the five scenarios by the CHECK
 * `chip_challenges_sandbox_scenario_valid`. The client-unable note needs no column: the step
 * record's `notes` holds its codes. Every value is synthetic.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { migrationTags, runMigrations } from './migrate.js';
import {
  createChipChallenge,
  getChipChallenge,
  listChipChallenges,
  setChipChallengeSandboxScenario,
  supersedeOpenChipChallenges,
} from './repositories/chip-challenges.js';
import * as schema from './schema.js';
import { CHIP_SANDBOX_SCENARIO_VALUES } from './schema.js';
import {
  PGLITE_EXTENSIONS,
  createTestInquiryOnEarlierSchema,
  createTestTenant,
  createTestVerificationOnEarlierSchema,
  testId,
} from './testing.js';

let upgraded: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let seeded: { environmentId: string; inquiryId: string; verificationId: string; earlier: string };

const NONCE_SHA256 = 'a'.repeat(64);

beforeAll(async () => {
  setDefaultKeyring(createKeyring(randomBytes(32)));
  upgraded = new PGlite({ extensions: PGLITE_EXTENSIONS });
  db = drizzle({ client: upgraded, schema });
  await runMigrations(db, { upTo: '0033_phase10b' });
  const { environment } = await createTestTenant(db);
  const { inquiry } = await createTestInquiryOnEarlierSchema(db, environment.id);
  const verification = await createTestVerificationOnEarlierSchema(db, environment.id, {
    inquiryId: inquiry.id,
    type: 'government_id_nfc',
  });
  const earlier = testId('chc');
  await upgraded.query(
    `insert into chip_challenges (id, environment_id, verification_id, inquiry_id, nonce_sha256,
       status, expires_at)
     values ($1, $2, $3, $4, $5, 'superseded', now() + interval '5 minutes')`,
    [earlier, environment.id, verification.id, inquiry.id, NONCE_SHA256],
  );
  seeded = {
    environmentId: environment.id,
    inquiryId: inquiry.id,
    verificationId: verification.id,
    earlier,
  };
  await runMigrations(db);
}, 120_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await upgraded.close();
});

const newChallenge = async (): Promise<string> => {
  await supersedeOpenChipChallenges(db, seeded.environmentId, seeded.verificationId);
  const now = new Date();
  const challenge = await createChipChallenge(db, seeded.environmentId, {
    id: testId('chc'),
    verificationId: seeded.verificationId,
    inquiryId: seeded.inquiryId,
    nonceSha256: NONCE_SHA256,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 300_000),
  });
  return challenge.id;
};

describe('migration 0034: applies on top of 0033 (Workflow 10C)', () => {
  it('is the migration after 0033_phase10b', () => {
    // Workflow 11A Stage 1a (C): 0035_phase11_connect is the last now (migration-0035.test.ts).
    const tags = migrationTags();
    expect(tags.indexOf('0034_phase10c')).toBe(tags.indexOf('0033_phase10b') + 1);
  });
});

describe('migration 0034: chip_challenges.sandbox_scenario (C208.1)', () => {
  it('leaves every earlier challenge without a scenario', async () => {
    const rows = await upgraded.query<{ sandbox_scenario: string | null; status: string }>(
      'select sandbox_scenario, status from chip_challenges where environment_id = $1 and id = $2',
      [seeded.environmentId, seeded.earlier],
    );
    expect(rows.rows).toEqual([{ sandbox_scenario: null, status: 'superseded' }]);
    expect(
      (await getChipChallenge(db, seeded.environmentId, seeded.earlier))?.sandboxScenario,
    ).toBeNull();
  });

  it('holds the scenario to the five values, null allowed', async () => {
    const rows = await upgraded.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
         where conname = 'chip_challenges_sandbox_scenario_valid'`,
    );
    const definition = rows.rows[0]?.def ?? '';
    for (const scenario of CHIP_SANDBOX_SCENARIO_VALUES) {
      expect(definition).toContain(`'${scenario}'`);
    }
    await expect(
      upgraded.query(`update chip_challenges set sandbox_scenario = 'revoked' where id = $1`, [
        seeded.earlier,
      ]),
    ).rejects.toThrow(/chip_challenges_sandbox_scenario_valid/);
  });
});

describe('setChipChallengeSandboxScenario (C208.1)', () => {
  it('records each scenario on the verification’s open challenge, which then serves it', async () => {
    for (const scenario of CHIP_SANDBOX_SCENARIO_VALUES) {
      const id = await newChallenge();

      expect(
        await setChipChallengeSandboxScenario(db, seeded.environmentId, {
          id,
          verificationId: seeded.verificationId,
          scenario,
        }),
      ).toBe(true);
      expect((await getChipChallenge(db, seeded.environmentId, id))?.sandboxScenario).toBe(
        scenario,
      );
    }
    const listed = await listChipChallenges(db, seeded.environmentId, seeded.verificationId);
    expect(listed.filter((challenge) => challenge.sandboxScenario !== null)).toHaveLength(
      CHIP_SANDBOX_SCENARIO_VALUES.length,
    );
  });

  it('a new challenge has none', async () => {
    const id = await newChallenge();

    expect((await getChipChallenge(db, seeded.environmentId, id))?.sandboxScenario).toBeNull();
  });

  it('writes nothing on a challenge that is no longer open, another verification’s, or unknown', async () => {
    const closed = await newChallenge();
    await supersedeOpenChipChallenges(db, seeded.environmentId, seeded.verificationId);
    const open = await newChallenge();
    const other = await createTestVerificationOnEarlierSchema(db, seeded.environmentId, {
      inquiryId: seeded.inquiryId,
      type: 'government_id_nfc',
    });

    for (const input of [
      { id: closed, verificationId: seeded.verificationId },
      { id: open, verificationId: other.id },
      { id: testId('chc'), verificationId: seeded.verificationId },
    ]) {
      expect(
        await setChipChallengeSandboxScenario(db, seeded.environmentId, {
          ...input,
          scenario: 'match',
        }),
      ).toBe(false);
    }
    expect((await getChipChallenge(db, seeded.environmentId, closed))?.sandboxScenario).toBeNull();
    expect((await getChipChallenge(db, seeded.environmentId, open))?.sandboxScenario).toBeNull();
  });
});
