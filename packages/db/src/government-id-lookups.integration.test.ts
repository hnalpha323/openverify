/**
 * C34 on Postgres 17: the repeat lookup (`findRepeatCandidates`) finds the same blind index and
 * every front pHash within `max-phash-distance` through indexes, never by reading the whole
 * table. The proof is the plan Postgres chooses (EXPLAIN) for the exact query the repository
 * sends, captured from the pool, over a table holding tens of thousands of analyzed extractions:
 * a BitmapOr of the blind-index index and the eight pHash band indexes (the pigeonhole lookup),
 * then the exact Hamming distance as a filter. The same-number lookup of the inconsistent-repeat
 * check uses the blind-index index alone. Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { runMigrations } from './migrate.js';
import {
  createEnvironment,
  createGovernmentIdExtraction,
  createInquiry,
  createInquiryTemplate,
  createOrganization,
  createVerification,
  findRepeatCandidates,
  findSameNumberExtractions,
} from './repositories/index.js';
import { createIntegrationPool, testId, startIntegrationPostgres, ifSet } from './testing.js';

const keyring = createKeyring(randomBytes(32));
/** Extractions in the environment under test, and in a second environment. */
const FILLER_ROWS = 40_000;
const OTHER_ENVIRONMENT_ROWS = 10_000;

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 4 });
  db = createDatabase(pool);
  await runMigrations(db);
  setDefaultKeyring(keyring);
});

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

const ids = (prefix: Parameters<typeof testId>[0], count: number): string[] =>
  Array.from({ length: count }, () => testId(prefix));

const hex = (bytes: number): string => randomBytes(bytes).toString('hex');

const PHASH = '0123456789abcdef';
const INDEX = 'c'.repeat(64);
/** Postgres truncates identifiers to 63 bytes, so the blind-index index carries this name. */
const NUMBER_INDEX =
  'government_id_extractions_environment_id_identification_number_index_idx'.slice(0, 63);

/** `PHASH` with one bit of each of `bands` bands flipped: `bands` bits away. */
function nearby(bands: number): string {
  const bytes = Buffer.from(PHASH, 'hex');
  for (let band = 0; band < bands; band += 1) {
    bytes[band] = (bytes[band] ?? 0) ^ 0x01;
  }
  return bytes.toString('hex');
}

interface Tenant {
  environmentId: string;
  templateId: string;
  versionId: string;
}

async function tenant(): Promise<Tenant> {
  const organization = await createOrganization(db, { id: testId('org'), name: 'Example Org' });
  const environment = await createEnvironment(db, {
    id: testId('env'),
    organizationId: organization.id,
    kind: 'sandbox',
  });
  const template = await createInquiryTemplate(db, environment.id, {
    id: testId('itmpl'),
    name: 'KYC',
    version: { id: testId('itmplv'), flow: {}, verificationConfig: {} },
  });
  return {
    environmentId: environment.id,
    templateId: template.id,
    versionId: template.currentVersion.id,
  };
}

/** A government ID verification of a new inquiry (and so a new account). */
async function governmentId(env: Tenant) {
  const inquiry = await createInquiry(db, env.environmentId, {
    id: testId('inq'),
    inquiryTemplateId: env.templateId,
    inquiryTemplateVersionId: env.versionId,
  });
  const verification = await createVerification(db, env.environmentId, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type: 'government_id',
  });
  return { verificationId: verification.id, accountId: inquiry.accountId };
}

/**
 * `count` filler extractions of one account, in one statement per table: random blind indexes
 * and pHashes, no fields (the plans never open them).
 */
async function fillExtractions(env: Tenant, accountId: string, count: number): Promise<void> {
  const inquiryIds = ids('inq', count);
  const verificationIds = ids('ver', count);
  await pool.query(
    `insert into inquiries (id, environment_id, inquiry_template_id, inquiry_template_version_id,
                            account_id, fields)
     select id, $2, $3, $4, $5, '{}' from unnest($1::text[]) as t(id)`,
    [inquiryIds, env.environmentId, env.templateId, env.versionId, accountId],
  );
  await pool.query(
    `insert into verifications (id, environment_id, inquiry_id, type)
     select id, $2, inquiry_id, 'government_id'
       from unnest($1::text[], $3::text[]) as t(id, inquiry_id)`,
    [verificationIds, env.environmentId, inquiryIds],
  );
  await pool.query(
    `insert into government_id_extractions (environment_id, verification_id,
                                            identification_number_index, front_phash, created_at)
     select $2, verification_id, number_index, phash, now() - (ordinality || ' minutes')::interval
       from unnest($1::text[], $3::text[], $4::text[]) with ordinality
            as t(verification_id, number_index, phash, ordinality)`,
    [
      verificationIds,
      env.environmentId,
      Array.from({ length: count }, () => hex(32)),
      Array.from({ length: count }, () => hex(8)),
    ],
  );
}

/**
 * Runs `lookup` and returns the plan Postgres chooses for the last query it sent on `table`,
 * with the parameters it was sent with.
 */
async function planOf(table: string, lookup: () => Promise<unknown>): Promise<string> {
  const spy = vi.spyOn(pool, 'query');
  let calls: unknown[][];
  try {
    await lookup();
  } finally {
    calls = [...spy.mock.calls];
    spy.mockRestore();
  }
  const sent = calls
    .map((call) => {
      const [config, values] = call as unknown as [string | { text: string }, unknown[]?];
      return { text: typeof config === 'string' ? config : config.text, values: values ?? [] };
    })
    .filter(({ text }) => text.includes(`from "${table}"`))
    .at(-1);
  if (sent === undefined) {
    throw new Error(`no query on ${table} was sent`);
  }
  const explained = await pool.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${sent.text}`, sent.values);
  return explained.rows.map((row) => row['QUERY PLAN']).join('\n');
}

const fields = {
  'name-first': 'QUINN',
  'name-middle': null,
  'name-last': 'VALEMONT',
  birthdate: '1990-02-14',
  sex: 'X',
  nationality: 'UTO',
  'identification-number': 'X12K45P78',
  'personal-number': null,
  'issue-date': '2024-03-01',
  'expiration-date': '2034-02-28',
  'issuing-authority-code': 'UTO',
  'address-street-1': null,
  'address-street-2': null,
  'address-city': null,
  'address-subdivision': null,
  'address-postal-code': null,
  'address-country-code': null,
  endorsements: null,
  restrictions: null,
  'vehicle-class': null,
} as const;

describe('C34 lookups on Postgres 17 (Workflow 3A Stage 3)', () => {
  /** The environment of each test, seeded with its filler extractions. */
  let repeatEnvironment: Tenant;
  let sameNumberEnvironment: Tenant;

  // The bulk inserts are setup, not the lookups under test: they run under the hook timeout, so
  // a test body never races the per-test timeout while another suite loads the machine.
  beforeAll(async () => {
    repeatEnvironment = await tenant();
    const other = await tenant();
    await fillExtractions(
      repeatEnvironment,
      (await governmentId(repeatEnvironment)).accountId,
      FILLER_ROWS,
    );
    await fillExtractions(other, (await governmentId(other)).accountId, OTHER_ENVIRONMENT_ROWS);
    sameNumberEnvironment = await tenant();
    await fillExtractions(
      sameNumberEnvironment,
      (await governmentId(sameNumberEnvironment)).accountId,
      FILLER_ROWS,
    );
  });

  it('finds repeats through the blind-index and pHash band indexes, every match within the distance', async () => {
    const env = repeatEnvironment;
    const planted = new Map<string, number | null>();
    for (const [index, phash, distance] of [
      [INDEX, hex(8), null],
      [hex(32), nearby(0), 0],
      [hex(32), nearby(3), 3],
      [hex(32), nearby(7), 7],
      [hex(32), nearby(8), 8],
    ] as const) {
      const verification = await governmentId(env);
      await createGovernmentIdExtraction(db, env.environmentId, {
        verificationId: verification.verificationId,
        fields,
        fieldSources: {},
        identificationNumberIndex: index,
        frontPhash: phash,
        idClassGroup: 'national_id',
      });
      planted.set(verification.verificationId, distance);
    }
    await pool.query('ANALYZE government_id_extractions, verifications, inquiries');
    const current = await governmentId(env);

    let found: { verificationId: string; sameIdentificationNumber: boolean }[] = [];
    const started = performance.now();
    const plan = await planOf('government_id_extractions', async () => {
      found = await findRepeatCandidates(db, env.environmentId, {
        verificationId: current.verificationId,
        accountId: current.accountId,
        identificationNumberIndex: INDEX,
        frontPhash: PHASH,
        maxPhashDistance: 7,
      });
    });
    const elapsed = performance.now() - started;

    const plantedFound = found.filter((candidate) => planted.has(candidate.verificationId));
    expect(plantedFound.map((candidate) => planted.get(candidate.verificationId)).sort()).toEqual(
      [0, 3, 7, null].sort(),
    );
    expect(
      plantedFound.find((candidate) => planted.get(candidate.verificationId) === null),
    ).toMatchObject({ sameIdentificationNumber: true });
    console.info(
      `EXPLAIN findRepeatCandidates over ${String(FILLER_ROWS)} extractions (+${String(OTHER_ENVIRONMENT_ROWS)} in another environment), ${elapsed.toFixed(1)} ms with the EXPLAIN:\n${plan}`,
    );
    expect(plan).toContain('BitmapOr');
    expect(plan).toContain(NUMBER_INDEX);
    for (let band = 0; band < 8; band += 1) {
      expect(plan).toContain(
        `government_id_extractions_environment_id_front_phash_band_${String(band)}_idx`,
      );
    }
    expect(plan).not.toMatch(/Seq Scan/);
  });

  it('finds the same-number extractions through the blind-index index', async () => {
    const env = sameNumberEnvironment;
    const earlier = await governmentId(env);
    await createGovernmentIdExtraction(db, env.environmentId, {
      verificationId: earlier.verificationId,
      fields,
      fieldSources: {},
      identificationNumberIndex: INDEX,
      frontPhash: null,
      idClassGroup: 'national_id',
    });
    await pool.query('ANALYZE government_id_extractions, verifications');
    const current = await governmentId(env);

    let found: { verificationId: string }[] = [];
    const plan = await planOf('government_id_extractions', async () => {
      found = await findSameNumberExtractions(db, env.environmentId, {
        verificationId: current.verificationId,
        identificationNumberIndex: INDEX,
      });
    });

    expect(found.map((candidate) => candidate.verificationId)).toEqual([earlier.verificationId]);
    console.info(
      `EXPLAIN findSameNumberExtractions over ${String(FILLER_ROWS)} extractions:\n${plan}`,
    );
    expect(plan).toContain(NUMBER_INDEX);
    expect(plan).not.toMatch(/Seq Scan/);
  });
});
