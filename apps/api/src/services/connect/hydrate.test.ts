/**
 * C234.5, C234.6, C235.1 (Workflow 11A, `api-redeem`): hydrate writes the share's fields into a
 * destination account or inquiry through its own write path: mappings first, then names; a name
 * match the destination does not declare, or of another type, is dropped and listed (keys only); a
 * mapping that cannot be written, or a value the destination refuses, fails the redemption
 * (`import_failed`); the object records the hydrated keys with the token (`hydrated_fields`), and an
 * inquiry its `connect-hydrate` provenance.
 *
 * Synthetic rows only (rule 9).
 */
import type { ShareFieldEntry } from '@openverify/core';
import { getAccount, getInquiry } from '@openverify/db';
import { createTestInquiry } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UNMASKED } from '../../auth/pii.js';
import { createTestApi, type TestApi } from '../../test-support/harness.js';
import type { Acting } from '../inquiries.js';
import { HydrateImportFailedError, hydrateInTx, type HydrateRequest } from './hydrate.js';

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
}, 120_000);

afterAll(async () => {
  await api.close();
});

/** The value, or a failed test when it is missing. */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('the test expected a value');
  }
  return value;
}

const TOKEN = 'cnst_01M5CN0000000000000011A330';
const NOW = new Date('2026-11-12T10:00:00.000Z');

const acting = (): Acting => ({
  ctx: { environmentId: api.environmentId, organizationId: api.organizationId },
  actor: { type: 'api-key', id: 'key_01M5CN0000000000000011A331' },
  mask: UNMASKED,
  environmentKind: 'sandbox',
});

const FIELDS: ShareFieldEntry[] = [
  { key: 'name_first', type: 'string', value: 'QUINN' },
  { key: 'name_last', type: 'string', value: 'VALEMONT synthetic' },
  { key: 'loyalty', type: 'number', value: 7 },
  { key: 'not_declared', type: 'string', value: 'x' },
];

const request = (more: Partial<HydrateRequest> = {}): HydrateRequest => ({
  allowlist: ['name_first', 'name_last', 'loyalty', 'not_declared'],
  fields: FIELDS,
  mappings: [],
  ...more,
});

async function inquiryDestination() {
  const { inquiry } = await createTestInquiry(api.database.db, api.environmentId);
  const schemas = [
    { key: 'name_first', type: 'string', label: 'First name', pii: true },
    { key: 'surname', type: 'string', label: 'Surname', pii: true },
    { key: 'loyalty', type: 'string', label: 'Loyalty', pii: false },
  ];
  await api.database.db.execute(sql`update inquiry_template_versions
    set field_schemas = ${JSON.stringify(schemas)}::jsonb
    where id = ${inquiry.inquiryTemplateVersionId}`);
  return inquiry;
}

const hydrate = (
  target: { type: 'inquiry' | 'account'; id: string },
  more?: Partial<HydrateRequest>,
) =>
  api.database.db.transaction((tx) =>
    hydrateInTx(
      {
        tx,
        deps: api.deps,
        acting: acting(),
        staged: [],
        shareTokenId: TOKEN,
        sourceOrganizationName: 'Example Partner',
        now: NOW,
      },
      target,
      request(more),
    ),
  );

describe('hydrate into an inquiry (C234.5)', () => {
  it('writes the name matches, drops the undeclared and other-typed ones, and records the keys', async () => {
    const inquiry = await inquiryDestination();
    const outcome = await hydrate({ type: 'inquiry', id: inquiry.id });
    expect(outcome).toEqual({
      written: ['name_first'],
      dropped: ['loyalty', 'name_last', 'not_declared'],
    });
    const stored = must(await getInquiry(api.database.db, api.environmentId, inquiry.id));
    expect(stored.fields).toMatchObject({ name_first: 'QUINN' });
    expect(stored.fields).not.toHaveProperty('not_declared');
    expect(stored.hydratedFields).toEqual([
      { 'share-token-id': TOKEN, fields: ['name_first'], 'hydrated-at': NOW.toISOString() },
    ]);
    expect(stored.provenance).toMatchObject({
      kind: 'connect-hydrate',
      'share-token-id': TOKEN,
      fields: ['name_first'],
    });
  });

  it('writes a mapping before the names (a mapped key is not name-matched)', async () => {
    const inquiry = await inquiryDestination();
    const outcome = await hydrate(
      { type: 'inquiry', id: inquiry.id },
      { mappings: [{ 'source-field-name': 'name_last', 'destination-field-name': 'surname' }] },
    );
    expect(outcome.written).toEqual(['surname', 'name_first']);
    expect(
      must(await getInquiry(api.database.db, api.environmentId, inquiry.id)).fields,
    ).toMatchObject({
      surname: 'VALEMONT synthetic',
    });
  });

  it('fails the redemption on a mapping to a field the destination does not declare, writing nothing', async () => {
    const inquiry = await inquiryDestination();
    await expect(
      hydrate(
        { type: 'inquiry', id: inquiry.id },
        { mappings: [{ 'source-field-name': 'name_last', 'destination-field-name': 'nowhere' }] },
      ),
    ).rejects.toBeInstanceOf(HydrateImportFailedError);
    const stored = must(await getInquiry(api.database.db, api.environmentId, inquiry.id));
    expect(stored.fields).not.toHaveProperty('name_first');
    expect(stored.hydratedFields).toBeNull();
  });

  it('fails the redemption when the destination refuses a value (an inquiry that is no longer open)', async () => {
    const inquiry = await inquiryDestination();
    await api.database.db.execute(
      sql`update inquiries set status = 'completed' where id = ${inquiry.id}`,
    );
    await expect(hydrate({ type: 'inquiry', id: inquiry.id })).rejects.toBeInstanceOf(
      HydrateImportFailedError,
    );
  });
});

describe('hydrate into an account (C234.5)', () => {
  it('writes the account type’s declared fields and records the keys (no provenance column)', async () => {
    const { inquiry } = await createTestInquiry(api.database.db, api.environmentId);
    const account = must(await getAccount(api.database.db, api.environmentId, inquiry.accountId));
    await api.database.db.execute(sql`update account_types
      set fields_schema = ${JSON.stringify({ name_first: { type: 'string', label: 'First name' } })}::jsonb
      where id = ${account.accountTypeId}`);
    const outcome = await hydrate({ type: 'account', id: account.id });
    expect(outcome.written).toEqual(['name_first']);
    const stored = must(await getAccount(api.database.db, api.environmentId, account.id));
    expect(stored.fields).toMatchObject({ name_first: 'QUINN' });
    expect(stored.hydratedFields).toEqual([
      { 'share-token-id': TOKEN, fields: ['name_first'], 'hydrated-at': NOW.toISOString() },
    ]);
  });
});
