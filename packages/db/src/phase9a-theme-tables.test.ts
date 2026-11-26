/**
 * Workflow 9A Stage 1b, checkpoint (H): what `foundation-9a` builds in the database for theme sets
 * (C160.1, C160.5, C160.6, C160.7, C174.5), frozen for `api-themes` (Workflow 9B):
 *
 * - `theme_sets`, each vocabulary and the archived state held by a CHECK;
 * - `theme_set_revisions`, deleted with their set, a restore naming an earlier revision;
 * - `theme_assets`, a logo or a font coherent with its media type, size and attestation, its
 *   envelope listed for the rewrap and re-wrapped by `kek:rewrap`;
 * - the inquiry's `theme_set_id`, a set of its own environment, and the environment's
 *   `default-theme-set-id` setting.
 *
 * Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, decryptBytes, encryptBytes, setDefaultKeyring } from './crypto.js';
import { ENCRYPTED_COLUMNS } from './encrypted-columns.js';
import {
  createInquiry,
  getEnvironment,
  getInquiry,
  updateEnvironmentSettings,
} from './repositories/index.js';
import { REWRAP_TABLES, rewrapAll } from './repositories/key-rotation.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from './testing.js';

const oldKek = randomBytes(32);
const newKek = randomBytes(32);
const oldKeyring = createKeyring(oldKek);
let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase({ keyring: oldKeyring });
}, 120_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await database.close();
});

const query = <Row extends object>(text: string, params: unknown[] = []) =>
  database.client.query<Row>(text, params);

const refused = async (text: string, params: unknown[]) =>
  query(text, params).then(
    () => 'accepted',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

async function themeSet(environmentId: string, name = 'Brand') {
  const id = testId('theset');
  await query('insert into theme_sets (id, environment_id, name) values ($1, $2, $3)', [
    id,
    environmentId,
    name,
  ]);
  return id;
}

describe('theme sets (C160.1)', () => {
  it('start active, empty and at revision 1, and hold their name, status and archive to their forms', async () => {
    const { environment } = await createTestTenant(database.db);
    const id = await themeSet(environment.id);

    const { rows } = await query<Record<string, unknown>>(
      'select status, styles, revision, archived_at from theme_sets where id = $1',
      [id],
    );
    expect(rows).toEqual([{ status: 'active', styles: {}, revision: 1, archived_at: null }]);
    expect(await refused(`update theme_sets set name = '' where id = $1`, [id])).toContain(
      'theme_sets_name_length',
    );
    expect(await refused(`update theme_sets set status = 'deleted' where id = $1`, [id])).toContain(
      'theme_sets_status_valid',
    );
    expect(
      await refused(`update theme_sets set status = 'archived' where id = $1`, [id]),
    ).toContain('theme_sets_archived_coherent');
    expect(
      await refused(
        `update theme_sets set status = 'archived', archived_at = now() where id = $1`,
        [id],
      ),
    ).toBe('accepted');
  });
});

describe('theme set revisions (C160.5)', () => {
  it('belong to their set, name their creator by id, and restore only an earlier revision', async () => {
    const { environment } = await createTestTenant(database.db);
    const id = await themeSet(environment.id);
    const insert = (revision: number, more: string, params: unknown[] = []) =>
      refused(
        `insert into theme_set_revisions (environment_id, theme_set_id, revision, name, styles,
           creator_type, creator_id, restored_from) values ($1, $2, $3, 'Brand', '{}', ${more})`,
        [environment.id, id, revision, ...params],
      );

    expect(await insert(1, `'user', $4, null`, [testId('usr')])).toBe('accepted');
    expect(await insert(2, `'api-key', $4, 1`, [testId('key')])).toBe('accepted');
    expect(await insert(3, `'user', $4, 3`, [testId('usr')])).toContain(
      'theme_set_revisions_restored_from_earlier',
    );
    expect(await insert(3, `'user', $4, null`, [testId('key')])).toContain(
      'theme_set_revisions_creator_id_format',
    );
    expect(
      await refused(
        `insert into theme_set_revisions (environment_id, theme_set_id, revision, name, styles, creator_type, creator_id)
         values ($1, $2, 1, 'x', '{}', 'user', $3)`,
        [environment.id, testId('theset'), testId('usr')],
      ),
    ).toContain('theme_set_revisions_theme_set_fk');
  });
});

describe('theme assets (C160.6, C174.5)', () => {
  const insertAsset = async (environmentId: string, more: string, params: unknown[]) => {
    const id = testId('tsa');
    const { wrappedDek } = encryptBytes(new Uint8Array([1, 2, 3]), oldKeyring, { context: id });
    const outcome = await refused(
      `insert into theme_assets (id, environment_id, storage_key, sha256, wrapped_dek, kind,
         media_type, byte_size, width, height, licence_attested_by, licence_attested_at)
       values ($1, $2, $3, $4, $5, ${more})`,
      [id, environmentId, `synthetic/${id}`, '0'.repeat(64), wrappedDek, ...params],
    );
    return { id, wrappedDek, outcome };
  };

  it('holds a logo to its pixels and a font to its attestation', async () => {
    const { environment } = await createTestTenant(database.db);
    const usr = testId('usr');

    const logo = await insertAsset(
      environment.id,
      `'logo', 'image/png', 100, 64, 64, null, null`,
      [],
    );
    const font = await insertAsset(
      environment.id,
      `'font', 'font/woff2', 100, null, null, $6, now()`,
      [usr],
    );
    const svg = await insertAsset(
      environment.id,
      `'logo', 'image/svg+xml', 100, 64, 64, null, null`,
      [],
    );
    const bigLogo = await insertAsset(
      environment.id,
      `'logo', 'image/png', 262145, 64, 64, null, null`,
      [],
    );
    const unattested = await insertAsset(
      environment.id,
      `'font', 'font/woff2', 100, null, null, null, null`,
      [],
    );

    expect([logo.outcome, font.outcome]).toEqual(['accepted', 'accepted']);
    expect(svg.outcome).toMatch(/theme_assets_(kind_coherent|media_type_valid)/);
    expect(bigLogo.outcome).toContain('theme_assets_kind_coherent');
    expect(unattested.outcome).toContain('theme_assets_kind_coherent');
  });

  it('lists the envelope for the rewrap, and kek:rewrap re-wraps it', async () => {
    expect(ENCRYPTED_COLUMNS).toContainEqual({
      table: 'theme_assets',
      column: 'wrapped_dek',
      aad: 'file',
    });
    expect(REWRAP_TABLES).toContain('theme_assets');
    const { environment } = await createTestTenant(database.db);
    const plaintext = new Uint8Array([7, 7, 7]);
    const id = testId('tsa');
    const sealed = encryptBytes(plaintext, oldKeyring, { context: id });
    await query(
      `insert into theme_assets (id, environment_id, storage_key, sha256, wrapped_dek, kind, media_type, byte_size, width, height)
       values ($1, $2, $3, $4, $5, 'logo', 'image/png', 3, 1, 1)`,
      [id, environment.id, `synthetic/${id}`, '0'.repeat(64), sealed.wrappedDek],
    );

    const rotated = createKeyring(newKek, [oldKek]);
    await rewrapAll(database.db, { keyring: rotated });

    const { rows } = await query<{ wrapped_dek: string }>(
      'select wrapped_dek from theme_assets where id = $1',
      [id],
    );
    const rewrapped = rows[0]?.wrapped_dek ?? '';
    expect(rewrapped.split('.')[1]).toBe(createKeyring(newKek).currentKeyId);
    expect(
      decryptBytes(
        { wrappedDek: rewrapped, ciphertext: sealed.ciphertext },
        createKeyring(newKek),
        {
          context: id,
        },
      ),
    ).toEqual(Buffer.from(plaintext));
  });
});

describe("the inquiry's theme set and the environment's default (C160.7)", () => {
  it('keeps the set an inquiry was created with, of its own environment only, and none by default', async () => {
    const { environment } = await createTestTenant(database.db);
    const other = await createTestTenant(database.db);
    const own = await themeSet(environment.id);
    const foreign = await themeSet(other.environment.id);
    const { template, inquiry: plain } = await createTestInquiry(database.db, environment.id);
    const base = {
      inquiryTemplateId: template.id,
      inquiryTemplateVersionId: template.latestVersion.id,
      referenceId: null,
      fields: {},
    };

    const themed = await createInquiry(database.db, environment.id, {
      ...base,
      id: testId('inq'),
      themeSetId: own,
    });

    expect((await getInquiry(database.db, environment.id, themed.id))?.themeSetId).toBe(own);
    expect(plain.themeSetId).toBeNull();
    await expect(
      createInquiry(database.db, environment.id, {
        ...base,
        id: testId('inq'),
        themeSetId: foreign,
      }),
    ).rejects.toThrow();
    await updateEnvironmentSettings(database.db, environment.id, { 'default-theme-set-id': own });
    expect((await getEnvironment(database.db, environment.id))?.settings).toMatchObject({
      'default-theme-set-id': own,
    });
  });
});
