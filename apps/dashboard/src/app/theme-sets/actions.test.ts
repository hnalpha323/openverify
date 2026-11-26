// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { ENVIRONMENTS, problemDocument } from '../../testing/api-mock';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { previewDocument, previewPath } from '../../testing/routes/preview';
import {
  THEME_EDITOR,
  THEME_IDS,
  THEME_SETS_PATH,
  contrastProblem,
  serveThemeSet,
  themeAssetResource,
  themeSetResource,
} from '../../testing/routes/themes-copy';
import {
  archiveThemeSet,
  clearDefaultThemeSet,
  createThemeSet,
  duplicateThemeSet,
  makeDefaultThemeSet,
  previewThemeStyles,
  renameThemeSet,
  restoreThemeSetRevision,
  saveThemeStyles,
  uploadThemeAssetAction,
} from './actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: THEME_EDITOR });
});

afterEach(() => {
  api.restore();
});

function form(entries: Readonly<Record<string, string>>): FormData {
  const data = new FormData();
  data.append('environment-id', ENVIRONMENTS.sandbox.id);
  for (const [name, value] of Object.entries(entries)) {
    data.append(name, value);
  }
  return data;
}

describe('createThemeSet (C160.1)', () => {
  it('creates a set with every cell built in and answers its id', async () => {
    api.on('POST', THEME_SETS_PATH, 201, { data: themeSetResource() });

    const result = await createThemeSet(null, form({ name: ' Synthetic Brand ' }));

    expect(result).toEqual({ ok: true, data: { id: THEME_IDS.set } });
    expect(api.find('POST', THEME_SETS_PATH)?.body).toEqual({
      data: { type: 'theme-set', attributes: { name: 'Synthetic Brand' } },
    });
  });

  it('refuses an empty name at its pointer without calling the API', async () => {
    const result = await createThemeSet(null, form({ name: '  ' }));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.problem.errors?.[0]?.pointer).toBe('/data/attributes/name');
    expect(api.find('POST', THEME_SETS_PATH)).toBeUndefined();
  });

  it('answers the forbidden problem without theme-sets:write', async () => {
    api.me({ permissions: ['theme-sets:read'] });

    const result = await createThemeSet(null, form({ name: 'Synthetic Brand' }));

    expect(result.ok).toBe(false);
    expect(api.find('POST', THEME_SETS_PATH)).toBeUndefined();
  });
});

const SET_PATH = `${THEME_SETS_PATH}/${THEME_IDS.set}`;

describe('saveThemeStyles (C160.3-C160.5)', () => {
  it('replaces the styles tree and answers the new revision', async () => {
    api.on('PATCH', SET_PATH, 200, { data: themeSetResource({ revision: 5 }) });
    const styles = { light: { palette: { primary: '#1447e6' } } };

    const result = await saveThemeStyles(
      null,
      form({ 'theme-set-id': THEME_IDS.set, styles: JSON.stringify(styles) }),
    );

    expect(result).toEqual({ ok: true, data: { kind: 'saved', revision: 5 } });
    expect(api.find('PATCH', SET_PATH)?.body).toEqual({
      data: { type: 'theme-set', attributes: { styles } },
    });
  });

  it('answers the contrast refusal with its pairs, never as a save', async () => {
    const pairs = [
      {
        pointer: '/data/attributes/styles/light/palette/ink',
        foreground: 'ink',
        background: 'surface',
        ratio: 1.5,
        required: 4.5,
      },
    ];
    api.on('PATCH', SET_PATH, 422, contrastProblem(pairs));

    const result = await saveThemeStyles(
      null,
      form({ 'theme-set-id': THEME_IDS.set, styles: '{}' }),
    );

    expect(result).toEqual({ ok: true, data: { kind: 'refused', pairs } });
  });

  it('refuses a malformed set id without calling the API', async () => {
    const result = await saveThemeStyles(null, form({ 'theme-set-id': 'nope', styles: '{}' }));

    expect(result.ok).toBe(false);
    expect(api.requests.filter((request) => request.method === 'PATCH')).toEqual([]);
  });
});

describe('renameThemeSet and archiveThemeSet (C160.1, C160.7)', () => {
  it('renames through PATCH with the name only', async () => {
    api.on('PATCH', SET_PATH, 200, { data: themeSetResource({ name: 'Synthetic Renamed' }) });

    const result = await renameThemeSet(
      null,
      form({ 'theme-set-id': THEME_IDS.set, name: 'Synthetic Renamed' }),
    );

    expect(result.ok).toBe(true);
    expect(api.find('PATCH', SET_PATH)?.body).toEqual({
      data: { type: 'theme-set', attributes: { name: 'Synthetic Renamed' } },
    });
  });

  it('archives with DELETE, and says theme_set_default in words', async () => {
    api.on('DELETE', SET_PATH, 200, { data: themeSetResource({ status: 'archived' }) });
    expect((await archiveThemeSet(null, form({ 'theme-set-id': THEME_IDS.set }))).ok).toBe(true);

    api.on('DELETE', SET_PATH, 409, problemDocument(409, undefined, { code: 'theme_set_default' }));
    const refused = await archiveThemeSet(null, form({ 'theme-set-id': THEME_IDS.set }));
    expect(!refused.ok && refused.problem.detail).toMatch(/is the environment’s default/);
  });
});

describe('restoreThemeSetRevision and duplicateThemeSet (C160.5)', () => {
  it('restores a revision with meta.revision and answers the new revision', async () => {
    api.on('POST', `${SET_PATH}/restore`, 200, { data: themeSetResource({ revision: 7 }) });

    const result = await restoreThemeSetRevision(
      null,
      form({ 'theme-set-id': THEME_IDS.set, revision: '3' }),
    );

    expect(result).toEqual({ ok: true, data: { revision: 7 } });
    expect(api.find('POST', `${SET_PATH}/restore`)?.body).toEqual({ meta: { revision: 3 } });
  });

  it('duplicates a set with its styles under a copy name', async () => {
    const styles = { shape: { radius: 4 } };
    serveThemeSet(api, themeSetResource({ name: 'Synthetic Brand', styles }));
    api.on('POST', THEME_SETS_PATH, 201, { data: themeSetResource({ id: THEME_IDS.otherSet }) });

    const result = await duplicateThemeSet(null, form({ 'theme-set-id': THEME_IDS.set }));

    expect(result).toEqual({ ok: true, data: { id: THEME_IDS.otherSet } });
    expect(api.find('POST', THEME_SETS_PATH)?.body).toEqual({
      data: { type: 'theme-set', attributes: { name: 'Synthetic Brand (copy)', styles } },
    });
  });
});

describe('the default set (C160.7)', () => {
  it('sets and clears default-theme-set-id with settings:write', async () => {
    api.on('PATCH', '/dashboard/settings', 200, {});

    await makeDefaultThemeSet(null, form({ 'theme-set-id': THEME_IDS.set }));
    expect(api.find('PATCH', '/dashboard/settings')?.body).toEqual({
      'default-theme-set-id': THEME_IDS.set,
    });
    await clearDefaultThemeSet(null, form({ 'theme-set-id': THEME_IDS.set }));
    expect(api.find('PATCH', '/dashboard/settings')?.body).toEqual({
      'default-theme-set-id': null,
    });
  });

  it('refuses without settings:write before calling the API', async () => {
    api.me({ permissions: ['theme-sets:read', 'theme-sets:write'] });

    const result = await makeDefaultThemeSet(null, form({ 'theme-set-id': THEME_IDS.set }));

    expect(result.ok).toBe(false);
    expect(api.find('PATCH', '/dashboard/settings')).toBeUndefined();
  });
});

describe('uploadThemeAssetAction (C160.6)', () => {
  it('answers the stored asset', async () => {
    api.on('POST', `${THEME_SETS_PATH}/assets`, 201, { data: themeAssetResource('logo') });
    const data = form({ kind: 'logo' });
    data.append(
      'file',
      new File([new Uint8Array([0x89, 0x50])], 'logo.png', { type: 'image/png' }),
    );

    const result = await uploadThemeAssetAction(null, data);

    expect(result).toEqual({
      ok: true,
      data: { id: THEME_IDS.logo, kind: 'logo', width: 120, height: 40 },
    });
  });

  it('says asset_type_refused and a busy image service in words', async () => {
    const data = () => {
      const each = form({ kind: 'logo' });
      each.append(
        'file',
        new File([new Uint8Array([0x3c])], 'logo.svg', { type: 'image/svg+xml' }),
      );
      return each;
    };
    api.on(
      'POST',
      `${THEME_SETS_PATH}/assets`,
      415,
      problemDocument(415, undefined, { code: 'asset_type_refused' }),
    );
    const refused = await uploadThemeAssetAction(null, data());
    expect(!refused.ok && refused.problem.detail).toMatch(/SVG is not accepted/);

    api.on('POST', `${THEME_SETS_PATH}/assets`, 503, problemDocument(503));
    const busy = await uploadThemeAssetAction(null, data());
    expect(!busy.ok && busy.problem.detail).toMatch(/busy/);
  });
});

describe('previewThemeStyles (C156.1, C160)', () => {
  it('previews the unsaved styles on a version, in English, and answers the document', async () => {
    api.me({ permissions: [...THEME_EDITOR, 'inquiry-templates:read'] });
    const document = previewDocument();
    api.on('POST', previewPath(THEME_IDS.version), 200, document);
    const styles = { shape: { radius: 12 } };

    const result = await previewThemeStyles(
      null,
      form({ 'version-id': THEME_IDS.version, styles: JSON.stringify(styles) }),
    );

    expect(result).toEqual({ ok: true, data: document });
    expect(api.find('POST', previewPath(THEME_IDS.version))?.body).toEqual({
      data: { attributes: { styles } },
      meta: { locale: 'en' },
    });
  });

  it('needs inquiry-templates:read', async () => {
    const result = await previewThemeStyles(
      null,
      form({ 'version-id': THEME_IDS.version, styles: '{}' }),
    );

    expect(result.ok).toBe(false);
  });
});
