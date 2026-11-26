/**
 * C53.2: the shape of every Phase 5 table, read from the migrated database's catalogs. Every
 * table but the install-wide trust tables (5B) has `environment_id` and composite foreign keys to
 * `(environment_id, verification_id)` and `(environment_id, inquiry_id)`, as `selfie_captures`
 * has. A challenge table is keyed by its `id` with `unique(environment_id, id)`; a
 * verification-keyed table by `verification_id` with `unique(environment_id, verification_id)`.
 * Then each table's own rules (statuses, one open challenge, bounds). Values are synthetic.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createVerification } from './repositories/verifications.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedBusinessRegistryRecord,
  seedChipChallenge,
  seedChipRead,
  seedCryptoChallenge,
  seedDocumentExtraction,
  seedOtpChallenge,
  seedOtpVerificationState,
  seedTrustAnchor,
  seedTrustAnchorMembership,
  seedTrustAnchorSource,
  seedTrustCrl,
  seedVerificationInputs,
  testId,
  type TestDatabase,
} from './testing.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

/** The Phase 5 tables and how each is keyed: Workflow 5A's (0017), then 5B's (0018). */
const PHASE5_TABLES = {
  verification_inputs: 'verification_id',
  otp_verification_states: 'verification_id',
  otp_challenges: 'id',
  crypto_challenges: 'id',
  document_extractions: 'verification_id',
  chip_challenges: 'id',
  chip_reads: 'verification_id',
  business_registry_records: 'verification_id',
} as const;

/** C53.3: the install-wide trust tables, with no environment, and their primary keys. */
const TRUST_TABLES = {
  trust_anchor_sources: ['id'],
  trust_anchors: ['sha256'],
  trust_anchor_memberships: ['source_id', 'anchor_id'],
  trust_crls: ['sha256'],
  trust_anchor_syncs: ['id'],
} as const;

interface Constraint {
  name: string;
  type: 'p' | 'u' | 'f' | 'c';
  columns: string[];
  foreignTable: string | null;
  foreignColumns: string[];
  onDelete: string;
}

async function constraintsOf(table: string): Promise<Constraint[]> {
  const result = await database.client.query<{
    name: string;
    type: Constraint['type'];
    columns: string[] | null;
    foreign_table: string | null;
    foreign_columns: string[] | null;
    on_delete: string;
  }>(
    `select c.conname as name, c.contype as type,
            (select array_agg(a.attname order by k.ordinality) from unnest(c.conkey)
               with ordinality as k(attnum, ordinality)
               join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as columns,
            f.relname as foreign_table,
            (select array_agg(a.attname order by k.ordinality) from unnest(c.confkey)
               with ordinality as k(attnum, ordinality)
               join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum)
              as foreign_columns,
            c.confdeltype as on_delete
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       left join pg_class f on f.oid = c.confrelid
      where t.relname = $1`,
    [table],
  );
  return result.rows.map((row) => ({
    name: row.name,
    type: row.type,
    columns: row.columns ?? [],
    foreignTable: row.foreign_table,
    foreignColumns: row.foreign_columns ?? [],
    onDelete: row.on_delete,
  }));
}

describe('every Phase 5 table is environment-scoped and keyed as C53.2 and C53.3 say', () => {
  it.each(Object.entries(PHASE5_TABLES))('%s', async (table, key) => {
    const constraints = await constraintsOf(table);
    const of = (type: Constraint['type']) => constraints.filter((c) => c.type === type);

    expect(constraints.length, `${table} exists`).toBeGreaterThan(0);
    expect(of('p').map((c) => c.columns)).toEqual([[key]]);
    expect(of('u').map((c) => c.columns)).toContainEqual(['environment_id', key]);
    const foreign = of('f').map((c) => ({
      columns: c.columns,
      table: c.foreignTable,
      foreignColumns: c.foreignColumns,
      cascades: c.onDelete === 'c',
    }));
    expect(foreign).toContainEqual({
      columns: ['environment_id', 'verification_id'],
      table: 'verifications',
      foreignColumns: ['environment_id', 'id'],
      cascades: true,
    });
    expect(foreign).toContainEqual({
      columns: ['environment_id', 'inquiry_id'],
      table: 'inquiries',
      foreignColumns: ['environment_id', 'id'],
      cascades: true,
    });
  });
});

async function verificationOf(
  type:
    | 'phone_number'
    | 'email_address'
    | 'crypto_wallet'
    | 'aamva'
    | 'document'
    | 'government_id_nfc'
    | 'database_business',
) {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const verification = await createVerification(database.db, environment.id, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type,
  });
  return { env: environment.id, inquiryId: inquiry.id, verificationId: verification.id };
}

/**
 * Whether `write` was refused by an integrity constraint (SQLSTATE class 23: a foreign key, a
 * unique index or a check), not by anything else such as a missing table.
 */
async function refusedByConstraint(write: Promise<unknown>): Promise<string> {
  try {
    await write;
  } catch (error) {
    const code = String(
      ((error as { cause?: { code?: unknown } }).cause ?? (error as { code?: unknown })).code,
    );
    return code.startsWith('23') ? 'refused by a constraint' : `failed with ${code}`;
  }
  return 'accepted';
}

describe('the C53.2 rules each table enforces', () => {
  it('keeps every row to the environment of its verification and inquiry', async () => {
    const own = await verificationOf('phone_number');
    const other = await verificationOf('phone_number');

    expect(
      await refusedByConstraint(
        seedOtpChallenge(database.db, other.env, {
          verificationId: own.verificationId,
          inquiryId: own.inquiryId,
          channel: 'sms',
          destination: '+15550100001',
        }),
      ),
    ).toBe('refused by a constraint');
    expect(
      await refusedByConstraint(
        seedVerificationInputs(database.db, other.env, {
          verificationId: own.verificationId,
          inquiryId: own.inquiryId,
          values: { 'name-first': 'Avery' },
        }),
      ),
    ).toBe('refused by a constraint');
  });

  it('holds one sent OTP challenge per verification', async () => {
    const { env, inquiryId, verificationId } = await verificationOf('phone_number');
    const base = {
      verificationId,
      inquiryId,
      channel: 'sms' as const,
      destination: '+15550100002',
    };
    await seedOtpChallenge(database.db, env, base);
    await seedOtpChallenge(database.db, env, { ...base, status: 'superseded', codeHmac: null });

    expect(await refusedByConstraint(seedOtpChallenge(database.db, env, base))).toBe(
      'refused by a constraint',
    );
  });

  it('keeps a code HMAC only while the challenge is sent, 32 bytes, and at most five tries', async () => {
    const { env, inquiryId, verificationId } = await verificationOf('email_address');
    const base = {
      verificationId,
      inquiryId,
      channel: 'email' as const,
      destination: 'avery@example.test',
    };

    expect(
      await refusedByConstraint(
        seedOtpChallenge(database.db, env, {
          ...base,
          status: 'confirmed',
          codeHmac: new Uint8Array(32),
        }),
      ),
    ).toBe('refused by a constraint');
    expect(
      await refusedByConstraint(
        seedOtpChallenge(database.db, env, { ...base, codeHmac: new Uint8Array(16) }),
      ),
    ).toBe('refused by a constraint');
    expect(
      await refusedByConstraint(seedOtpChallenge(database.db, env, { ...base, failedAttempts: 6 })),
    ).toBe('refused by a constraint');
    expect(
      await refusedByConstraint(
        seedOtpChallenge(database.db, env, { ...base, channel: 'voice' as 'sms' }),
      ),
    ).toBe('refused by a constraint');
    expect(
      await refusedByConstraint(
        seedOtpChallenge(database.db, env, { ...base, id: 'otp_01K0000000000000000000ABCD' }),
      ),
    ).toBe('refused by a constraint');
  });

  it('bounds the OTP counts and names a reason exactly when a limit refused the user', async () => {
    const { env, inquiryId, verificationId } = await verificationOf('phone_number');
    const state = { verificationId, inquiryId };

    expect(
      await refusedByConstraint(seedOtpVerificationState(database.db, env, { ...state, sends: 6 })),
    ).toBe('refused by a constraint');
    expect(
      await refusedByConstraint(
        seedOtpVerificationState(database.db, env, { ...state, wrongEntries: 11 }),
      ),
    ).toBe('refused by a constraint');
    expect(
      await refusedByConstraint(
        seedOtpVerificationState(database.db, env, { ...state, limitedAt: new Date() }),
      ),
    ).toBe('refused by a constraint');
    await expect(
      seedOtpVerificationState(database.db, env, {
        ...state,
        limitedAt: new Date(),
        limitedReason: 'guess',
        sends: 5,
        wrongEntries: 10,
      }),
    ).resolves.toBeUndefined();
  });

  it('holds one initiated crypto challenge per verification, on a CAIP-2 chain id', async () => {
    const { env, inquiryId, verificationId } = await verificationOf('crypto_wallet');
    const base = {
      verificationId,
      inquiryId,
      chainId: 'eip155:1',
      walletAddress: '0x00000000000000000000000000000000000000aa',
      message: 'synthetic challenge',
    };
    await seedCryptoChallenge(database.db, env, base);
    await seedCryptoChallenge(database.db, env, { ...base, status: 'superseded' });

    expect(await refusedByConstraint(seedCryptoChallenge(database.db, env, base))).toBe(
      'refused by a constraint',
    );
    expect(
      await refusedByConstraint(
        seedCryptoChallenge(database.db, env, {
          ...base,
          status: 'expired',
          chainId: 'not a chain',
        }),
      ),
    ).toBe('refused by a constraint');
  });

  it('records where verification inputs came from, and refuses another source', async () => {
    const { env, inquiryId, verificationId } = await verificationOf('aamva');

    expect(
      await refusedByConstraint(
        seedVerificationInputs(database.db, env, {
          verificationId,
          inquiryId,
          values: { 'name-last': 'Synthetic' },
          source: 'scanner' as 'flow',
        }),
      ),
    ).toBe('refused by a constraint');
  });
});

describe('the install-wide trust tables (C53.3)', () => {
  async function columnsOf(table: string): Promise<string[]> {
    const result = await database.client.query<{ name: string }>(
      `select column_name as name from information_schema.columns where table_name = $1`,
      [table],
    );
    return result.rows.map((row) => row.name);
  }

  it.each(Object.entries(TRUST_TABLES))(
    '%s has no environment and its own key',
    async (table, key) => {
      const constraints = await constraintsOf(table);
      expect(constraints.length, `${table} exists`).toBeGreaterThan(0);
      expect(constraints.filter((c) => c.type === 'p').map((c) => c.columns)).toEqual([[...key]]);
      expect(await columnsOf(table)).not.toContain('environment_id');
    },
  );

  it('ties a membership to its source and its anchor, removed with either', async () => {
    const constraints = await constraintsOf('trust_anchor_memberships');
    const foreign = constraints
      .filter((c) => c.type === 'f')
      .map((c) => ({ columns: c.columns, table: c.foreignTable, cascades: c.onDelete === 'c' }));
    expect(foreign).toContainEqual({
      columns: ['source_id'],
      table: 'trust_anchor_sources',
      cascades: true,
    });
    expect(foreign).toContainEqual({
      columns: ['anchor_id'],
      table: 'trust_anchors',
      cascades: true,
    });
    expect(
      await refusedByConstraint(
        seedTrustAnchorMembership(database.db, {
          sourceId: 'no-such-source',
          anchorId: 'f'.repeat(64),
        }),
      ),
    ).toBe('refused by a constraint');
  });

  it('keeps anchors to their shape: a two-letter country, hex key identifiers, sandbox off by default', async () => {
    const id = await seedTrustAnchor(database.db, { certificate: new Uint8Array([1, 2, 3, 4]) });
    const row = await database.client.query<{ sandbox_only: boolean; is_link: boolean }>(
      `select sandbox_only, is_link from trust_anchors where sha256 = $1`,
      [id],
    );
    expect(row.rows[0]).toEqual({ sandbox_only: false, is_link: false });
    expect(
      await refusedByConstraint(
        seedTrustAnchor(database.db, { certificate: new Uint8Array([5]), country: 'UTO' }),
      ),
    ).toBe('refused by a constraint');
    expect(
      await refusedByConstraint(
        seedTrustAnchor(database.db, { certificate: new Uint8Array([6]), ski: 'not hex' }),
      ),
    ).toBe('refused by a constraint');
    expect(
      await refusedByConstraint(seedTrustAnchorSource(database.db, { id: 'Not A Source' })),
    ).toBe('refused by a constraint');
    expect(
      await refusedByConstraint(
        seedTrustCrl(database.db, { der: new Uint8Array([7]), issuerCountry: 'utopia' }),
      ),
    ).toBe('refused by a constraint');
  });
});

describe('the C53.3 rules each Workflow 5B table enforces', () => {
  it('keeps every row to the environment of its verification and inquiry', async () => {
    const own = await verificationOf('document');
    const other = await verificationOf('document');
    expect(
      await refusedByConstraint(
        seedDocumentExtraction(database.db, other.env, {
          verificationId: own.verificationId,
          inquiryId: own.inquiryId,
        }),
      ),
    ).toBe('refused by a constraint');
  });

  it('names a known document class, a confidence in [0, 1], 1 to 50 pages and a document media type', async () => {
    const base = async () => {
      const { env, inquiryId, verificationId } = await verificationOf('document');
      return { env, row: { verificationId, inquiryId } };
    };
    for (const patch of [
      { documentType: 'passport' },
      { typeConfidence: 1.5 },
      { pageCount: 0 },
      { pageCount: 51 },
      { mimeType: 'image/gif' },
    ]) {
      const { env, row } = await base();
      expect(
        await refusedByConstraint(seedDocumentExtraction(database.db, env, { ...row, ...patch })),
        JSON.stringify(patch),
      ).toBe('refused by a constraint');
    }
    const { env, row } = await base();
    await expect(
      seedDocumentExtraction(database.db, env, {
        ...row,
        documentType: 'unknown',
        typeConfidence: null,
      }),
    ).resolves.toBeUndefined();
  });

  it('holds one initiated chip challenge per verification, with a hex nonce digest and a chc id', async () => {
    const { env, inquiryId, verificationId } = await verificationOf('government_id_nfc');
    const base = { verificationId, inquiryId };
    await seedChipChallenge(database.db, env, base);
    await seedChipChallenge(database.db, env, { ...base, status: 'superseded' });

    expect(await refusedByConstraint(seedChipChallenge(database.db, env, base))).toBe(
      'refused by a constraint',
    );
    expect(
      await refusedByConstraint(
        seedChipChallenge(database.db, env, { ...base, status: 'expired', nonceSha256: 'abc' }),
      ),
    ).toBe('refused by a constraint');
    expect(
      await refusedByConstraint(
        seedChipChallenge(database.db, env, { ...base, status: 'expired', id: testId('cwc') }),
      ),
    ).toBe('refused by a constraint');
    expect(
      await refusedByConstraint(
        seedChipChallenge(database.db, env, {
          ...base,
          status: 'answered' as 'expired',
        }),
      ),
    ).toBe('refused by a constraint');
  });

  it('keeps a chip read to a known integrity, hex indexes and an ICAO issuing state', async () => {
    for (const patch of [
      { integrity: 'trusted' as 'established' },
      { sodSignatureIndex: 'not hex' },
      { documentNumberIndex: 'G'.repeat(64) },
      { issuingCountry: 'UT' },
    ]) {
      const { env, inquiryId, verificationId } = await verificationOf('government_id_nfc');
      expect(
        await refusedByConstraint(
          seedChipRead(database.db, env, { verificationId, inquiryId, ...patch }),
        ),
        JSON.stringify(patch),
      ).toBe('refused by a constraint');
    }
    const { env, inquiryId, verificationId } = await verificationOf('government_id_nfc');
    await expect(
      seedChipRead(database.db, env, {
        verificationId,
        inquiryId,
        issuingCountry: 'D<<',
        sodSignatureIndex: 'a'.repeat(64),
      }),
    ).resolves.toBeUndefined();
  });

  it('names the registry a business record came from', async () => {
    const { env, inquiryId, verificationId } = await verificationOf('database_business');
    expect(
      await refusedByConstraint(
        seedBusinessRegistryRecord(database.db, env, {
          verificationId,
          inquiryId,
          source: 'opencorporates' as 'gleif',
        }),
      ),
    ).toBe('refused by a constraint');
  });
});
