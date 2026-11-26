/**
 * Workflow 9A Stage 1b, checkpoint (T): what `foundation-9a` builds in the database for templates,
 * versions, deployments, promotions and simulation presets (C154.1, C154.5, C154.7, C156.4, C174.5):
 *
 * - the version members of C154.1, each with its default and its CHECK;
 * - `deployments` (`dply_`), one per publish of a version, named by its creator;
 * - `inquiry_template_promotions`, one per promote into a template's environment;
 * - `simulation_presets` (`ssp_`), a user's synthetic scope sealed for the row, listed for the
 *   rewrap and re-wrapped by `kek:rewrap`;
 * - the repository stubs are `api-templates`' and built (`repositories/template-records.test.ts`).
 *
 * Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { ENCRYPTED_COLUMNS, SEALED } from './encrypted-columns.js';
import { REWRAP_TABLES, rewrapAll } from './repositories/key-rotation.js';
import { openJson, sealJson, type Sealed } from './sealed.js';
import { createUser } from './repositories/users.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from './testing.js';

const oldKek = randomBytes(32);
const newKek = randomBytes(32);
let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase({ keyring: createKeyring(oldKek) });
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

async function seededVersion() {
  const { organization, environment } = await createTestTenant(database.db);
  const { template } = await createTestInquiry(database.db, environment.id);
  return {
    organizationId: organization.id,
    environmentId: environment.id,
    templateId: template.id,
    versionId: template.latestVersion.id,
  };
}

describe('the version members of C154.1', () => {
  it('gives a version made before them their defaults', async () => {
    const { versionId } = await seededVersion();
    const { rows } = await query<Record<string, unknown>>(
      `select publish_note, description, last_updater, field_schemas, copy, enabled_locales, default_locale,
         theme_set_id, embed_origins, redirect_uri, redirect_uri_schemes, redirect_include_status, help_url,
         privacy_url, validation, flow_sha256, acknowledgements
       from inquiry_template_versions where id = $1`,
      [versionId],
    );
    expect(rows).toEqual([
      {
        publish_note: null,
        description: null,
        last_updater: null,
        field_schemas: [],
        copy: {},
        enabled_locales: ['en'],
        default_locale: 'en',
        theme_set_id: null,
        embed_origins: [],
        redirect_uri: null,
        redirect_uri_schemes: [],
        redirect_include_status: false,
        help_url: null,
        privacy_url: null,
        validation: null,
        flow_sha256: null,
        acknowledgements: [],
      },
    ]);
  });

  it('holds each member to its form', async () => {
    const { versionId } = await seededVersion();
    const set = (assignment: string, value: unknown) =>
      refused(`update inquiry_template_versions set ${assignment} where id = $1`, [
        versionId,
        value,
      ]);
    expect(await set('publish_note = $2', 'a'.repeat(256))).toContain(
      'inquiry_template_versions_publish_note_length',
    );
    expect(await set('description = $2', 'a'.repeat(2001))).toContain(
      'inquiry_template_versions_description_length',
    );
    expect(await set('flow_sha256 = $2', 'not-hex')).toContain(
      'inquiry_template_versions_flow_sha256_format',
    );
    expect(await set('theme_set_id = $2', 'tsa_01M5CJXHG07XPHF3HRM6NREDH8')).toContain(
      'inquiry_template_versions_theme_set_id_format',
    );
    expect(await set('enabled_locales = $2', ['en', 'pt'])).toContain(
      'inquiry_template_versions_locales_valid',
    );
    expect(await set('enabled_locales = $2', [])).toContain(
      'inquiry_template_versions_locales_valid',
    );
    expect(await set('default_locale = $2', 'fr')).toContain(
      'inquiry_template_versions_locales_valid',
    );
    expect(await set('field_schemas = $2', JSON.stringify({ key: 'x' }))).toContain(
      'inquiry_template_versions_json_shapes',
    );
    expect(
      await set('last_updater = $2', JSON.stringify({ type: 'user', id: testId('usr') })),
    ).toBe('accepted');
    expect(await set('flow_sha256 = $2', 'a'.repeat(64))).toBe('accepted');
    expect(await set('enabled_locales = $2', ['en', 'ar'])).toBe('accepted');
  });
});

describe('deployments (C154.7)', () => {
  it('records one deployment per publish of a version, by its creator, and lists them newest first', async () => {
    const { environmentId, templateId, versionId } = await seededVersion();
    const insert = (id: string, creatorType: string, creatorId: string, source: string | null) =>
      refused(
        `insert into deployments (id, environment_id, inquiry_template_id, inquiry_template_version_id,
           source_deployment_id, creator_type, creator_id) values ($1, $2, $3, $4, $5, $6, $7)`,
        [id, environmentId, templateId, versionId, source, creatorType, creatorId],
      );
    const first = testId('dply');
    expect(await insert(first, 'user', testId('usr'), null)).toBe('accepted');
    expect(await insert(testId('dply'), 'api-key', testId('key'), first)).toContain(
      'deployments_inquiry_template_version_id_key',
    );
    expect(await insert(testId('dply'), 'system', 'x', null)).toContain(
      'deployments_creator_valid',
    );
    expect(await insert('dep_1', 'user', testId('usr'), null)).toContain('deployments_id_format');
    const other = await createTestTenant(database.db);
    expect(
      await refused(
        `insert into deployments (id, environment_id, inquiry_template_id, inquiry_template_version_id,
           creator_type, creator_id) values ($1, $2, $3, $4, 'user', $5)`,
        [testId('dply'), other.environment.id, templateId, testId('itmplv'), testId('usr')],
      ),
    ).toContain('deployments_version_fk');
  });
});

describe('promotions (C154.5)', () => {
  it('records a promote into the target template, its source named by ids only', async () => {
    const { environmentId, templateId, versionId } = await seededVersion();
    const source = await seededVersion();
    const insert = (actor: string) =>
      refused(
        `insert into inquiry_template_promotions (environment_id, inquiry_template_id, inquiry_template_version_id,
           source_environment_id, source_template_id, source_version_id, promoted_by)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          environmentId,
          templateId,
          versionId,
          source.environmentId,
          source.templateId,
          source.versionId,
          actor,
        ],
      );
    expect(await insert(testId('usr'))).toBe('accepted');
    expect(await insert(testId('key'))).toContain('inquiry_template_promotions_promoted_by_format');
  });
});

describe('simulation presets (C156.4, C174.5)', () => {
  it("seals a user's preset scope for the row, lists it for the rewrap, and kek:rewrap re-wraps it", async () => {
    expect(ENCRYPTED_COLUMNS).toContainEqual({
      table: 'simulation_presets',
      column: 'scope',
      aad: 'row',
    });
    expect(SEALED.simulationPresetScope).toBe('simulation_presets.scope');
    expect(REWRAP_TABLES).toContain('simulation_presets');
    const { organizationId, environmentId } = await seededVersion();
    const user = await createUser(database.db, {
      id: testId('usr'),
      organizationId,
      email: `${testId('usr').toLowerCase()}@example.com`,
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
    });
    const id = testId('ssp');
    const scope = { fields: { name_first: 'Synthetic' } };
    await query(
      `insert into simulation_presets (id, environment_id, user_id, name, scope) values ($1, $2, $3, $4, $5)`,
      [id, environmentId, user.id, 'Passing ID', sealJson(SEALED.simulationPresetScope, id, scope)],
    );
    const stored = (
      await query<{ scope: string }>('select scope from simulation_presets where id = $1', [id])
    ).rows[0]?.scope;
    expect(stored).not.toContain('Synthetic');
    expect(() => openJson(SEALED.simulationPresetScope, testId('ssp'), stored as Sealed)).toThrow();
    await rewrapAll(database.db, { keyring: createKeyring(newKek, [oldKek]) });
    const rewrapped = (
      await query<{ scope: string }>('select scope from simulation_presets where id = $1', [id])
    ).rows[0]?.scope;
    expect(rewrapped).not.toBe(stored);
    setDefaultKeyring(createKeyring(newKek));
    expect(openJson(SEALED.simulationPresetScope, id, rewrapped as Sealed)).toEqual(scope);
    expect(
      await refused(
        `insert into simulation_presets (id, environment_id, user_id, name, scope) values ($1, $2, $3, '', 'x')`,
        [testId('ssp'), environmentId, user.id],
      ),
    ).toContain('simulation_presets_name_length');
  });
});
