/**
 * C160.7, C160.8, C156.1 (`api-themes`, Workflow 9B): which theme a flow renders, behind 9A's hooks.
 * A session's is the inquiry's `theme-set-id`, else its version's, else the environment's default,
 * else the built-in tokens (no member), each only while it is an active set of the inquiry's
 * environment; it names the revision it rendered and is live at the next load. The preview's
 * resolution has no inquiry and carries the contrast gate's findings. A set is named on an inquiry,
 * as the default and at publish only while active in that environment; a promote re-resolves it by
 * name, or copies it for a caller who may write sets there. Every value is synthetic.
 */
import { BUILTIN_PALETTES, contrastRatio } from '@openverify/core';
import {
  environments,
  inquiryTemplateVersions,
  inquiries,
  themeAssets,
  themeSets,
} from '@openverify/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createInquiry,
  createTemplate,
  expectStatus,
  multipart,
  resumeInquiry,
  type TestApi,
} from '../../test-support/harness.js';
import { createInquiryTestApi } from '../inquiries.test-support.js';
import { promoteThemeReferenceInTx } from './promote.js';
import { themeSetPublishProblems } from './publish.js';
import { resolveThemeForVersion } from './resolve.js';
import { checkThemeSetChoice } from './settings.js';

let api: TestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const USER = { type: 'user' as const, id: 'usr_01M5CK16P0D13FXHZSS4TCFBVH' };

async function createSet(
  attributes: Record<string, unknown>,
  token = api.token,
): Promise<{ id: string; revision: number }> {
  const created = expectStatus(
    await api.app.inject({
      method: 'POST',
      url: '/api/v1/theme-sets',
      headers: bearer(token),
      payload: { data: { type: 'theme-set', attributes } },
    }),
    201,
  );
  return { id: created.data.id, revision: created.data.attributes.revision as number };
}

async function archive(id: string, token = api.token) {
  expectStatus(
    await api.app.inject({ method: 'DELETE', url: `/api/v1/theme-sets/${id}`, headers: bearer(token) }),
    200,
  );
}

async function setDefault(environmentId: string, themeSetId: string | null) {
  await api.database.db
    .update(environments)
    .set({
      settings: sql`${environments.settings} || ${JSON.stringify({ 'default-theme-set-id': themeSetId })}::jsonb`,
    })
    .where(eq(environments.id, environmentId));
}

/** The pinned version of `inquiryId` names `themeSetId` (as a version published with it would). */
async function pinVersionTheme(inquiryId: string, themeSetId: string | null) {
  const [row] = await api.database.db
    .select({ versionId: inquiries.inquiryTemplateVersionId })
    .from(inquiries)
    .where(eq(inquiries.id, inquiryId));
  await api.database.db
    .update(inquiryTemplateVersions)
    .set({ themeSetId })
    .where(eq(inquiryTemplateVersions.id, row?.versionId ?? ''));
}

async function sessionTheme(inquiryId: string): Promise<unknown> {
  const token = await resumeInquiry(api, inquiryId);
  const session = expectStatus(
    await api.app.inject({ url: '/api/v1/flow/session', headers: bearer(token) }),
    200,
  ) as unknown as Record<string, unknown>;
  return session.theme;
}

async function inquiryWithTheme(themeSetId: string): Promise<string> {
  const templateId = await createTemplate(api);
  const created = await api.app.inject({
    method: 'POST',
    url: '/api/v1/inquiries',
    headers: bearer(api.token),
    payload: {
      data: {
        type: 'inquiry',
        attributes: { 'inquiry-template-id': templateId, 'theme-set-id': themeSetId },
      },
    },
  });
  return expectStatus(created, 201).data.id;
}

describe('the session theme (C160.7, T15)', () => {
  it('is no member for the built-in tokens, with no set named anywhere', async () => {
    await setDefault(api.environmentId, null);
    expect(await sessionTheme(await createInquiry(api))).toBeUndefined();
  });

  it('is the environment’s default, naming its revision, and live at the next load', async () => {
    const set = await createSet({ name: 'Default', styles: { shape: { radius: 10 } } });
    await setDefault(api.environmentId, set.id);
    const inquiryId = await createInquiry(api);

    expect(await sessionTheme(inquiryId)).toEqual({
      'theme-set-id': set.id,
      revision: 1,
      mode: 'light',
      light: BUILTIN_PALETTES.light,
      dark: null,
      radius: 10,
      font: { kind: 'system', platforms: ['web', 'android'] },
      logo: null,
      placement: 'header',
    });

    expectStatus(
      await api.app.inject({
        method: 'PATCH',
        url: `/api/v1/theme-sets/${set.id}`,
        headers: bearer(api.token),
        payload: {
          data: { type: 'theme-set', attributes: { styles: { light: { palette: { primary: '#2563eb' } } } } },
        },
      }),
      200,
    );
    expect(await sessionTheme(inquiryId)).toMatchObject({
      revision: 2,
      light: { ...BUILTIN_PALETTES.light, primary: '#2563eb' },
      radius: 6,
    });
    await setDefault(api.environmentId, null);
  });

  it('prefers the inquiry’s set, then its version’s, then the default, skipping archived ones', async () => {
    const fallback = await createSet({ name: 'Fallback' });
    const versionSet = await createSet({ name: 'Version' });
    const inquirySet = await createSet({ name: 'Inquiry' });
    await setDefault(api.environmentId, fallback.id);
    const inquiryId = await inquiryWithTheme(inquirySet.id);
    await pinVersionTheme(inquiryId, versionSet.id);

    expect(await sessionTheme(inquiryId)).toMatchObject({ 'theme-set-id': inquirySet.id });
    await archive(inquirySet.id);
    expect(await sessionTheme(inquiryId)).toMatchObject({ 'theme-set-id': versionSet.id });
    await archive(versionSet.id);
    expect(await sessionTheme(inquiryId)).toMatchObject({ 'theme-set-id': fallback.id });
    await setDefault(api.environmentId, null);
    expect(await sessionTheme(inquiryId)).toBeUndefined();
  });

  it('carries the dark palette under auto and the uploaded font for the web only', async () => {
    const user = api.newUserToken(api.environmentId);
    const font = new Uint8Array(64);
    font.set([0x77, 0x4f, 0x46, 0x32, 0, 1, 0, 0, 0, 0, 0, 64, 0, 1]);
    const form = await multipart({
      kind: 'font',
      'meta[licence-attested]': 'true',
      file: { bytes: font, filename: 'brand.woff2' },
    });
    const asset = expectStatus(
      await api.app.inject({
        method: 'POST',
        url: '/api/v1/theme-sets/assets',
        headers: { ...bearer(user), ...form.headers },
        payload: form.payload,
      }),
      201,
    ).data.id;
    const set = await createSet({
      name: 'Dark font',
      styles: {
        settings: { 'use-dark-theme': true },
        dark: { palette: { primary: '#4891ff' } },
        typography: { font: { kind: 'uploaded', 'asset-id': asset } },
      },
    });

    expect(await sessionTheme(await inquiryWithTheme(set.id))).toMatchObject({
      mode: 'auto',
      dark: { ...BUILTIN_PALETTES.dark, primary: '#4891ff' },
      font: { kind: 'uploaded', 'asset-id': asset, platforms: ['web'] },
    });
  });

  it('never resolves another environment’s set, even when a row names it', async () => {
    const other = await api.newTenant();
    const theirs = await createSet({ name: 'Theirs' }, other.token);
    const inquiryId = await createInquiry(api);
    await pinVersionTheme(inquiryId, theirs.id);
    expect(await sessionTheme(inquiryId)).toBeUndefined();
  });
});

describe('resolveThemeForVersion, the preview’s theme (C156.1; B46, review H15)', () => {
  it('is the built-in theme with both palettes and a passing gate when no set is named', async () => {
    const tenant = await api.newTenant();
    const resolved = await resolveThemeForVersion(api.database.db, {
      environmentId: tenant.environmentId,
      themeSetId: null,
    });

    expect(resolved.theme).toMatchObject({
      'theme-set-id': null,
      revision: null,
      mode: 'light',
      light: BUILTIN_PALETTES.light,
      dark: BUILTIN_PALETTES.dark,
    });
    expect(resolved.contrast.status).toBe('passed');
    expect(resolved.contrast.findings.every(({ level }) => level === 'warn')).toBe(true);
  });

  it('is the version’s set, else the default, with its revision', async () => {
    const tenant = await api.newTenant();
    const set = await createSet({ name: 'Version set' }, tenant.token);
    const fallback = await createSet({ name: 'Fallback set' }, tenant.token);
    await setDefault(tenant.environmentId, fallback.id);

    const named = await resolveThemeForVersion(api.database.db, {
      environmentId: tenant.environmentId,
      themeSetId: set.id,
    });
    expect(named.theme).toMatchObject({ 'theme-set-id': set.id, revision: 1 });

    await archive(set.id, tenant.token);
    const fallen = await resolveThemeForVersion(api.database.db, {
      environmentId: tenant.environmentId,
      themeSetId: set.id,
    });
    expect(fallen.theme).toMatchObject({ 'theme-set-id': fallback.id });
  });

  it('renders unsaved styles that fail the gate, and says so with each finding', async () => {
    const resolved = await resolveThemeForVersion(api.database.db, {
      environmentId: api.environmentId,
      themeSetId: null,
      styles: { light: { palette: { ink: '#777777' } } },
    });

    expect(resolved.theme).toMatchObject({ revision: null, light: { ink: '#777777' } });
    expect(resolved.contrast.status).toBe('failed');
    expect(resolved.contrast.findings).toContainEqual({
      pointer: '/data/attributes/styles/light/palette/ink',
      foreground: 'ink',
      background: 'surface',
      ratio: contrastRatio('#777777', '#ffffff'),
      required: 4.5,
      level: 'fail',
    });
  });

  it('refuses unsaved styles naming an asset of another environment', async () => {
    await expect(
      resolveThemeForVersion(api.database.db, {
        environmentId: api.environmentId,
        themeSetId: null,
        styles: {
          branding: { logo: { 'asset-id': 'tsa_01M5CK16P0D13FXHZSS4TCFBVH', decorative: true } },
        },
      }),
    ).rejects.toMatchObject({
      status: 422,
      errors: [{ pointer: '/data/attributes/styles/branding/logo/asset-id' }],
    });
  });
});

describe('naming a theme set (C160.7, C174.6, C154.9)', () => {
  it('takes an active set of the environment, and refuses an archived or foreign one', async () => {
    const active = await createSet({ name: 'Choice' });
    const archived = await createSet({ name: 'Archived choice' });
    await archive(archived.id);
    const other = await api.newTenant();
    const theirs = await createSet({ name: 'Foreign' }, other.token);
    const choice = (themeSetId: string | null) =>
      checkThemeSetChoice(api.database.db, {
        environmentId: api.environmentId,
        themeSetId,
        pointer: '/default-theme-set-id',
      });

    await expect(choice(null)).resolves.toBeUndefined();
    await expect(choice(active.id)).resolves.toBeUndefined();
    for (const refused of [archived.id, theirs.id]) {
      await expect(choice(refused)).rejects.toMatchObject({
        status: 422,
        errors: [{ pointer: '/default-theme-set-id' }],
      });
    }
  });

  it('lets an inquiry name an active set', async () => {
    const set = await createSet({ name: 'For an inquiry' });
    const inquiryId = await inquiryWithTheme(set.id);
    const [row] = await api.database.db
      .select({ themeSetId: inquiries.themeSetId })
      .from(inquiries)
      .where(eq(inquiries.id, inquiryId));
    expect(row?.themeSetId).toBe(set.id);
  });

  it('publishes a version naming an active set, and refuses an archived one', async () => {
    const active = await createSet({ name: 'Publish' });
    const archived = await createSet({ name: 'Publish archived' });
    await archive(archived.id);
    const problems = (themeSetId: string | null) =>
      themeSetPublishProblems(api.database.db, { environmentId: api.environmentId, themeSetId });

    await expect(problems(null)).resolves.toEqual([]);
    await expect(problems(active.id)).resolves.toEqual([]);
    await expect(problems(archived.id)).resolves.toEqual([
      expect.objectContaining({ pointer: '/theme-set-id' }),
    ]);
  });
});

describe('promote (C160.8; review P19)', () => {
  async function environmentsPair() {
    const source = await api.newTenant();
    const target = await api.newTenant({ kind: 'production' });
    return { source, target };
  }

  const reference = (
    source: { environmentId: string },
    target: { environmentId: string },
    themeSetId: string | null,
    mayWriteThemeSets: boolean,
  ) => ({
    sourceEnvironmentId: source.environmentId,
    targetEnvironmentId: target.environmentId,
    themeSetId,
    actor: USER,
    mayWriteThemeSets,
  });

  it('re-resolves the set by name in the target environment', async () => {
    const { source, target } = await environmentsPair();
    const theirs = await createSet({ name: 'Brand' }, source.token);
    const ours = await createSet({ name: 'Brand' }, target.token);

    await expect(
      api.database.db.transaction((tx) =>
        promoteThemeReferenceInTx(tx, reference(source, target, theirs.id, false)),
      ),
    ).resolves.toEqual({ themeSetId: ours.id, copied: false });
  });

  it('copies the set into the target, as revision 1, for a caller who may write sets there', async () => {
    const { source, target } = await environmentsPair();
    const theirs = await createSet(
      { name: 'Copied', styles: { shape: { radius: 3 } } },
      source.token,
    );

    const promoted = await api.database.db.transaction((tx) =>
      promoteThemeReferenceInTx(tx, reference(source, target, theirs.id, true)),
    );

    expect(promoted.copied).toBe(true);
    expect(promoted.themeSetId).not.toBe(theirs.id);
    const [copy] = await api.database.db
      .select()
      .from(themeSets)
      .where(eq(themeSets.id, promoted.themeSetId ?? ''));
    expect(copy).toMatchObject({
      environmentId: target.environmentId,
      name: 'Copied',
      styles: { shape: { radius: 3 } },
      revision: 1,
      status: 'active',
    });
  });

  it('refuses with promote_unresolved when nothing matches and the caller may not write sets there', async () => {
    const { source, target } = await environmentsPair();
    const theirs = await createSet({ name: 'Not there' }, source.token);

    await expect(
      api.database.db.transaction((tx) =>
        promoteThemeReferenceInTx(tx, reference(source, target, theirs.id, false)),
      ),
    ).rejects.toMatchObject({
      code: 'promote_unresolved',
      errors: [{ pointer: '/data/attributes/theme-set-id' }],
    });
    const copies = await api.database.db
      .select()
      .from(themeSets)
      .where(eq(themeSets.environmentId, target.environmentId));
    expect(copies).toEqual([]);
  });

  it('copies the set’s font with it when given the asset store, and refuses without it', async () => {
    const { source, target } = await environmentsPair();
    const font = new Uint8Array(64);
    font.set([0x77, 0x4f, 0x46, 0x32, 0, 1, 0, 0, 0, 0, 0, 64, 0, 1]);
    const form = await multipart({
      kind: 'font',
      'meta[licence-attested]': 'true',
      file: { bytes: font, filename: 'brand.woff2' },
    });
    const asset = expectStatus(
      await api.app.inject({
        method: 'POST',
        url: '/api/v1/theme-sets/assets',
        headers: { ...bearer(api.newUserToken(source.environmentId)), ...form.headers },
        payload: form.payload,
      }),
      201,
    ).data.id;
    const theirs = await createSet(
      { name: 'With font', styles: { typography: { font: { kind: 'uploaded', 'asset-id': asset } } } },
      source.token,
    );

    await expect(
      api.database.db.transaction((tx) =>
        promoteThemeReferenceInTx(tx, reference(source, target, theirs.id, true)),
      ),
    ).rejects.toMatchObject({ code: 'promote_unresolved' });

    const promoted = await api.database.db.transaction((tx) =>
      promoteThemeReferenceInTx(tx, {
        ...reference(source, target, theirs.id, true),
        assets: { storage: api.storage, keyring: api.database.keyring },
      }),
    );
    const [copy] = await api.database.db
      .select()
      .from(themeSets)
      .where(eq(themeSets.id, promoted.themeSetId ?? ''));
    const copiedFont = (copy?.styles as { typography: { font: { 'asset-id': string } } })
      .typography.font['asset-id'];
    expect(copiedFont).not.toBe(asset);
    const [copiedAsset] = await api.database.db
      .select()
      .from(themeAssets)
      .where(eq(themeAssets.id, copiedFont));
    expect(copiedAsset).toMatchObject({
      environmentId: target.environmentId,
      kind: 'font',
      byteSize: 64,
    });
    const read = await api.app.inject({
      url: `/api/v1/theme-sets/assets/${copiedFont}/content`,
      headers: bearer(target.token),
    });
    expect(new Uint8Array(read.rawPayload)).toEqual(font);
  });
});
