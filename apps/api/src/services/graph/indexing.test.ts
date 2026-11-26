/**
 * C101.3-C101.5 (Workflow 7B, `api-graph`): the in-transaction indexer and the graph hooks on
 * PGlite: an account's fields and reference id (weak kinds only with `graph-weak-kinds`), a
 * session's address under P05 (no `trust-all` address in production, no documentation, non-global
 * or relay range outside a sandbox), an inquiry's rows following it to an account, nothing with
 * `graph-indexing` off or without a key; the settings switches that mark kinds incomplete;
 * consolidation (one row per value and source); the redaction hooks, which leave no row and no
 * stored result naming the subject; and `blind-index:rebuild`'s re-keying. Every value is
 * synthetic: emails at example.com, addresses from the documentation ranges.
 */
import { randomBytes } from 'node:crypto';
import { newId } from '@openverify/contracts';
import {
  blindIndexKeyId,
  createAccount,
  createInquirySession,
  getGraphQuery,
  hashSessionToken,
  identifierKey,
  listGraphIndexStates,
  recordSessionNetworkEvaluation,
  updateEnvironmentSettings,
  type Db,
  type EnvironmentSettings,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedGraphAttribute,
  seedGraphQuery,
  seedGraphQueryTemplate,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { moveGraphOnConsolidationInTx } from './consolidation.js';
import { indexAccountAttributesInTx } from './indexing.js';
import { useGraphIndexKey } from './keys.js';
import { rebuildGraphIndexes } from './rebuild.js';
import { redactAccountGraphInTx, redactInquiryGraphInTx } from './redaction.js';
import { onGraphSettingsChangedInTx } from './settings-hook.js';

let database: TestDatabase;
let db: Db;
const key = new Uint8Array(randomBytes(32));
const keyId = blindIndexKeyId(key);

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  useGraphIndexKey(key);
}, 120_000);

afterAll(async () => {
  useGraphIndexKey(undefined);
  await database.close();
});

interface Row extends Record<string, unknown> {
  kind: number;
  value_key: string;
  key_id: string;
  account_id: string;
  source_type: string;
  source_id: string;
  inquiry_id: string | null;
}

async function rowsOf(environmentId: string): Promise<Row[]> {
  const result = await db.execute<Row>(sql`
      select kind, value_key, key_id, account_id, source_type, source_id, inquiry_id
      from graph_attributes where environment_id = ${environmentId}
      order by kind, value_key, account_id, source_type, source_id`);
  return (result as { rows: Row[] }).rows;
}

async function environment(
  settings: EnvironmentSettings = {},
  kind: 'sandbox' | 'production' = 'sandbox',
): Promise<string> {
  const id = (await createTestTenant(db, { kind })).environment.id;
  await updateEnvironmentSettings(db, id, settings);
  return id;
}

const keyOf = (
  environmentId: string,
  kind: Parameters<typeof identifierKey>[1]['kind'],
  input: string,
) => identifierKey(key, { environmentId, kind, input });

const FIELDS = {
  email_address: 'person@example.com',
  name_first: 'Ada',
  name_last: 'Example',
  birthdate: '1990-01-02',
};

async function indexFields(environmentId: string, accountId: string, referenceId: string | null) {
  return db.transaction((tx) =>
    indexAccountAttributesInTx(
      tx,
      environmentId,
      accountId,
      { type: 'account', id: accountId },
      { kind: 'account-fields', referenceId, fields: FIELDS },
    ),
  );
}

describe('the indexer at an account field write (C101.3)', () => {
  it('writes the reference id and the typed fields under the shared labels, strong and medium only by default', async () => {
    const env = await environment();
    const account = await createAccount(db, env, { id: testId('acc') });

    expect(await indexFields(env, account.id, 'ref-synthetic-1')).toBeGreaterThan(0);

    const rows = await rowsOf(env);
    expect(rows.every((row) => row.source_type === 'account' && row.key_id === keyId)).toBe(true);
    expect(new Set(rows.map((row) => row.kind))).toEqual(new Set([6, 8, 9]));
    expect(rows.find((row) => row.kind === 6)?.value_key).toBe(
      keyOf(env, 'identifier-email', 'person@example.com'),
    );
    expect(rows.find((row) => row.kind === 8)?.value_key).toBe(
      keyOf(env, 'identifier-reference-id', 'ref-synthetic-1'),
    );
    expect(JSON.stringify(rows)).not.toContain('example.com');
  });

  it('writes the weak kinds too with graph-weak-kinds on, and replaces what the fields no longer hold', async () => {
    const env = await environment({ 'graph-weak-kinds': true });
    const account = await createAccount(db, env, { id: testId('acc') });
    await indexFields(env, account.id, 'ref-old');

    expect(new Set((await rowsOf(env)).map((row) => row.kind))).toEqual(
      new Set([6, 8, 9, 15, 16, 18]),
    );
    await db.transaction((tx) =>
      indexAccountAttributesInTx(
        tx,
        env,
        account.id,
        { type: 'account', id: account.id },
        {
          kind: 'account-fields',
          referenceId: null,
          fields: { email_address: 'person@example.org' },
        },
      ),
    );

    const rows = await rowsOf(env);
    expect(rows.map((row) => row.kind).sort((a, b) => a - b)).toEqual([6, 18]);
    expect(rows.find((row) => row.kind === 18)?.value_key).toBe(
      keyOf(env, 'identifier-email-domain', 'example.org'),
    );
  });

  it('writes nothing with graph-indexing off, or in a process without a key', async () => {
    const off = await environment({ 'graph-indexing': false });
    const account = await createAccount(db, off, { id: testId('acc') });
    expect(await indexFields(off, account.id, 'ref-synthetic')).toBe(0);
    expect(await rowsOf(off)).toEqual([]);

    const on = await environment();
    const other = await createAccount(db, on, { id: testId('acc') });
    expect(process.env.OPENVERIFY_BLIND_INDEX_KEY).toBeUndefined();
    useGraphIndexKey(undefined);
    try {
      expect(await indexFields(on, other.id, 'ref-synthetic')).toBe(0);
    } finally {
      useGraphIndexKey(key);
    }
    expect(await rowsOf(on)).toEqual([]);
  });
});

async function sessionWith(
  environmentId: string,
  inquiryId: string,
  facts: { ip: string; clientAddressSource?: 'socket' | 'trust-all'; privacyRelay?: true | null },
) {
  const session = await createInquirySession(db, environmentId, {
    id: newId('iqse'),
    inquiryId,
    tokenHash: hashSessionToken(`ovs_${randomBytes(16).toString('hex')}`),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  const network = await recordSessionNetworkEvaluation(db, environmentId, {
    id: newId('net'),
    inquirySessionId: session.id,
    ip: facts.ip,
    clientAddressSource: facts.clientAddressSource ?? 'socket',
    evaluatedAt: new Date(),
    facts: {
      isTor: null,
      isDatacenter: null,
      isVpn: null,
      isProxy: null,
      hostingAsn: null,
      hostingAsnConfidence: null,
      privacyRelay: facts.privacyRelay ?? null,
      threatLevel: null,
      countryCode: null,
      countryName: null,
      location: null,
      asn: null,
      organization: null,
      serviceType: null,
      proxyType: null,
      ipConnectionType: null,
    },
    reasons: [],
    sources: [],
  });
  return { session, networkId: network?.id ?? '' };
}

async function indexAddress(
  environmentId: string,
  facts: Parameters<typeof sessionWith>[2],
): Promise<{ written: number; inquiryId: string }> {
  const { inquiry } = await createTestInquiry(db, environmentId);
  const { session, networkId } = await sessionWith(environmentId, inquiry.id, facts);
  const written = await db.transaction((tx) =>
    indexAccountAttributesInTx(
      tx,
      environmentId,
      inquiry.accountId,
      { type: 'inquiry-session', id: session.id, inquiryId: inquiry.id },
      { kind: 'session-address', ip: facts.ip, networkId },
    ),
  );
  return { written, inquiryId: inquiry.id };
}

describe('the indexer at the session start (C101.3, P05)', () => {
  it('writes the address as a weak kind only with graph-weak-kinds on', async () => {
    const off = await environment();
    expect((await indexAddress(off, { ip: '192.0.2.10' })).written).toBe(0);

    const on = await environment({ 'graph-weak-kinds': true });
    const { written, inquiryId } = await indexAddress(on, { ip: '192.0.2.10' });
    expect(written).toBe(1);
    expect(await rowsOf(on)).toEqual([
      expect.objectContaining({
        kind: 14,
        value_key: keyOf(on, 'identifier-ip', '192.0.2.10'),
        source_type: 'inquiry-session',
        inquiry_id: inquiryId,
      }),
    ]);
  });

  it('refuses a trust-all address, a relay and a documentation or non-global range in production', async () => {
    const production = await environment({ 'graph-weak-kinds': true }, 'production');

    for (const facts of [
      { ip: '192.0.2.11' },
      { ip: '192.0.2.12', clientAddressSource: 'trust-all' as const },
      { ip: '198.51.100.7', privacyRelay: true as const },
      { ip: '10.0.0.1' },
      { ip: '2001:db8::1' },
    ]) {
      expect((await indexAddress(production, facts)).written, facts.ip).toBe(0);
    }
    expect(await rowsOf(production)).toEqual([]);
  });
});

describe('an inquiry linked to another account (C101.3)', () => {
  it('moves the inquiry’s rows with it', async () => {
    const env = await environment();
    const { inquiry } = await createTestInquiry(db, env);
    const target = await createAccount(db, env, { id: testId('acc') });
    await seedGraphAttribute(db, env, {
      accountId: inquiry.accountId,
      kind: 4,
      source: { type: 'inquiry', id: inquiry.id },
    });
    await db.execute(sql`update inquiries set account_id = ${target.id} where id = ${inquiry.id}`);

    expect(
      await db.transaction((tx) =>
        indexAccountAttributesInTx(
          tx,
          env,
          target.id,
          { type: 'inquiry', id: inquiry.id },
          { kind: 'inquiry-linked' },
        ),
      ),
    ).toBe(1);
    expect((await rowsOf(env)).map((row) => row.account_id)).toEqual([target.id]);
  });
});

describe('the settings switches (C101.5, H10)', () => {
  async function switched(before: EnvironmentSettings, after: EnvironmentSettings) {
    const env = await environment();
    await db.transaction((tx) => onGraphSettingsChangedInTx(tx, env, before, after));
    return (await listGraphIndexStates(db, env))
      .filter((state) => !state.complete)
      .map(({ kind }) => kind);
  }

  it('marks every kind incomplete when graph-indexing is turned back on', async () => {
    expect(await switched({ 'graph-indexing': false }, { 'graph-indexing': true })).toEqual(
      Array.from({ length: 18 }, (_, index) => index + 1),
    );
  });

  it('marks the weak kinds when graph-weak-kinds is turned on', async () => {
    expect(await switched({}, { 'graph-weak-kinds': true })).toEqual([12, 13, 14, 15, 16, 17, 18]);
  });

  it('marks the device kinds when device recognition is enabled', async () => {
    const recognition = (mode: 'off' | 'consent'): EnvironmentSettings => ({
      'signal-collection': {
        'session-integrity': 'on',
        'device-recognition': mode,
        'device-recognition-basis': null,
      },
    });
    expect(await switched(recognition('off'), recognition('consent'))).toEqual([11, 12, 13]);
  });

  it('marks nothing when nothing starts being written', async () => {
    expect(await switched({ 'graph-weak-kinds': true }, { 'graph-weak-kinds': false })).toEqual([]);
    expect(await switched({}, { 'graph-components': true })).toEqual([]);
  });
});

describe('consolidation (C101.4)', () => {
  it('moves the absorbed accounts’ rows to the survivor, one row per value and source', async () => {
    const env = await environment();
    const [target, absorbed] = [
      await createAccount(db, env, { id: testId('acc') }),
      await createAccount(db, env, { id: testId('acc') }),
    ];
    const shared = randomBytes(32).toString('hex');
    await seedGraphAttribute(db, env, { accountId: target.id, kind: 5, valueKey: shared });
    await seedGraphAttribute(db, env, { accountId: absorbed.id, kind: 5, valueKey: shared });
    await seedGraphAttribute(db, env, { accountId: absorbed.id, kind: 4 });

    const moved = await db.transaction((tx) =>
      moveGraphOnConsolidationInTx(tx, {
        environmentId: env,
        targetId: target.id,
        sourceIds: [absorbed.id],
      }),
    );

    expect(moved).toBe(2);
    const rows = await rowsOf(env);
    expect(rows.every((row) => row.account_id === target.id)).toBe(true);
    expect(rows.filter((row) => row.value_key === shared)).toHaveLength(2);
  });
});

async function storedResult(env: string, accountIds: string[]) {
  const template = await seedGraphQueryTemplate(db, env);
  return seedGraphQuery(db, env, {
    graphQueryTemplateId: template.id,
    graphQueryTemplateVersionId: template.versionId,
    accountIds,
  });
}

describe('the redaction hooks (C101.4, C102.7)', () => {
  it('an inquiry’s redaction deletes its rows and takes its account out of every stored result', async () => {
    const env = await environment();
    const { inquiry } = await createTestInquiry(db, env);
    const other = await createAccount(db, env, { id: testId('acc') });
    await seedGraphAttribute(db, env, {
      accountId: inquiry.accountId,
      kind: 4,
      source: { type: 'inquiry', id: inquiry.id },
    });
    await seedGraphAttribute(db, env, { accountId: inquiry.accountId, kind: 8 });
    const query = await storedResult(env, [inquiry.accountId, other.id]);

    const outcome = await db.transaction((tx) =>
      redactInquiryGraphInTx(tx, { environmentId: env, inquiryId: inquiry.id, at: new Date() }),
    );

    expect(outcome).toEqual({ deletedRows: 1, scrubbedQueries: 1 });
    expect((await rowsOf(env)).map((row) => row.source_type)).toEqual(['account']);
    const stored = await getGraphQuery(db, env, query.id);
    expect(stored?.accountIds).toEqual([other.id]);
    expect(JSON.stringify(stored?.nodes)).not.toContain(inquiry.accountId);
  });

  it('an account’s redaction deletes all its rows and its component, and runs again harmlessly', async () => {
    const env = await environment();
    const account = await createAccount(db, env, { id: testId('acc') });
    await seedGraphAttribute(db, env, { accountId: account.id, kind: 4 });
    await seedGraphAttribute(db, env, { accountId: account.id, kind: 5 });
    await db.execute(sql`insert into graph_components (environment_id, account_id, component_id,
      size, computed_at) values (${env}, ${account.id}, 'c1', 1, now())`);
    await storedResult(env, [account.id]);
    const redact = () =>
      db.transaction((tx) =>
        redactAccountGraphInTx(tx, { environmentId: env, accountId: account.id, at: new Date() }),
      );

    expect(await redact()).toEqual({ deletedRows: 2, scrubbedQueries: 1 });
    expect(await rowsOf(env)).toEqual([]);
    const components = (await db.execute<{ n: number }>(
      sql`select count(*)::int as n from graph_components where account_id = ${account.id}`,
    )) as { rows: { n: number }[] };
    expect(components.rows[0]?.n).toBe(0);
    expect(await redact()).toEqual({ deletedRows: 0, scrubbedQueries: 0 });
  });
});

describe('blind-index:rebuild (C101.5)', () => {
  it('re-keys every row made under another key from its source, and drops what cannot be re-derived', async () => {
    const env = await environment();
    const account = await createAccount(db, env, {
      id: testId('acc'),
      referenceId: 'ref-rekey',
      fields: { email_address: 'rekey@example.com' },
    });
    const oldKey = new Uint8Array(randomBytes(32));
    await seedGraphAttribute(db, env, {
      accountId: account.id,
      kind: 8,
      valueKey: identifierKey(oldKey, {
        environmentId: env,
        kind: 'identifier-reference-id',
        input: 'ref-rekey',
      }),
      keyId: blindIndexKeyId(oldKey),
    });

    const result = await rebuildGraphIndexes(db, key, { batchSize: 10 });

    expect(result.scanned).toBeGreaterThanOrEqual(1);
    const rows = await rowsOf(env);
    expect(rows.every((row) => row.key_id === keyId)).toBe(true);
    expect(rows.find((row) => row.kind === 8)?.value_key).toBe(
      keyOf(env, 'identifier-reference-id', 'ref-rekey'),
    );
    expect(rows.find((row) => row.kind === 6)?.value_key).toBe(
      keyOf(env, 'identifier-email', 'rekey@example.com'),
    );
  });
});
