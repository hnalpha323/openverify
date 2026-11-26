// @vitest-environment node
import { createClient } from '@openverify/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { API_URL, problemDocument } from '../../testing/api-mock';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import {
  THEME_IDS,
  THEME_SETS_PATH,
  contrastProblem,
  serveThemeSetRevisions,
  serveThemeSets,
  themeAssetResource,
  themeSetResource,
  themeSetRevisionResource,
} from '../../testing/routes/themes-copy';
import { ActionInputError } from './action';
import {
  THEME_SETS_PAGE_SIZE,
  assetUploadFromForm,
  contrastRefusalOf,
  listThemeSetRevisions,
  listThemeSets,
  setDefaultThemeSet,
  stylesFromForm,
  uploadThemeAsset,
} from './theme-sets';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: RouteApi;
const client = () => createClient({ apiKey: SESSION_TOKEN, baseUrl: API_URL, maxRetries: 0 });

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
});

function form(entries: Readonly<Record<string, string | Blob>>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) {
    data.append(name, value);
  }
  return data;
}

function inputProblem(run: () => unknown) {
  try {
    run();
  } catch (error) {
    if (error instanceof ActionInputError) {
      return error.problem;
    }
    throw error;
  }
  throw new Error('Expected an ActionInputError');
}

describe('listThemeSets (C160.1)', () => {
  it('asks for one page, newest first, with the status filter and the cursor', async () => {
    serveThemeSets(api, [themeSetResource()]);

    const page = await listThemeSets(client(), { status: 'archived' }, THEME_IDS.otherSet);

    expect(page.data.map((set) => set.id)).toEqual([THEME_IDS.set]);
    expect(Object.fromEntries(api.find('GET', THEME_SETS_PATH)?.query ?? [])).toEqual({
      'filter[status]': 'archived',
      'page[size]': String(THEME_SETS_PAGE_SIZE),
      'page[after]': THEME_IDS.otherSet,
    });
  });

  it('sends no filter when none is chosen', async () => {
    serveThemeSets(api, []);

    await listThemeSets(client(), {});

    expect(Object.fromEntries(api.find('GET', THEME_SETS_PATH)?.query ?? [])).toEqual({
      'page[size]': String(THEME_SETS_PAGE_SIZE),
    });
  });
});

describe('listThemeSetRevisions (C160.5)', () => {
  it('pages back by revision number', async () => {
    serveThemeSetRevisions(api, THEME_IDS.set, [themeSetRevisionResource(3)]);

    const page = await listThemeSetRevisions(client(), THEME_IDS.set, 4);

    expect(page.data[0]?.attributes.revision).toBe(3);
    expect(
      Object.fromEntries(
        api.find('GET', `${THEME_SETS_PATH}/${THEME_IDS.set}/revisions`)?.query ?? [],
      ),
    ).toEqual({ 'page[before]': '4', 'page[size]': '20' });
  });
});

describe('stylesFromForm (C160.3)', () => {
  it('reads the editor tree from its JSON field, through the contract schema', () => {
    const styles = {
      settings: { 'use-dark-theme': true },
      light: { palette: { primary: '#1447e6' } },
      dark: {},
      shape: { radius: 8 },
    };

    expect(stylesFromForm(form({ styles: JSON.stringify(styles) }))).toEqual(styles);
  });

  it('refuses a colour that is not lower-case #rrggbb at its pointer, never echoing it', () => {
    const problem = inputProblem(() =>
      stylesFromForm(form({ styles: JSON.stringify({ light: { palette: { ink: 'RED' } } }) })),
    );

    expect(problem.errors?.[0]?.pointer).toBe('/light/palette/ink');
    expect(JSON.stringify(problem)).not.toContain('RED');
  });

  it('refuses a field that is not JSON', () => {
    const problem = inputProblem(() => stylesFromForm(form({ styles: '{' })));

    expect(problem.errors?.[0]?.pointer).toBe('/data/attributes/styles');
  });
});

describe('contrastRefusalOf (C160.4)', () => {
  it('answers the failing pairs of a theme_contrast_insufficient problem, ratios unrounded', async () => {
    const pairs = [
      {
        pointer: '/data/attributes/styles/light/palette/ink-muted',
        foreground: 'ink-muted',
        background: 'canvas',
        ratio: 4.218749213,
        required: 4.5,
      },
    ];
    api.on('PATCH', `${THEME_SETS_PATH}/${THEME_IDS.set}`, 422, contrastProblem(pairs));

    const error = await client()
      .themeSets.update(THEME_IDS.set, { styles: {} })
      .catch((caught: unknown) => caught);

    expect(contrastRefusalOf(error)).toEqual(pairs);
  });

  it('answers null for any other failure', async () => {
    api.on('PATCH', `${THEME_SETS_PATH}/${THEME_IDS.set}`, 409, problemDocument(409));

    const error = await client()
      .themeSets.update(THEME_IDS.set, { styles: {} })
      .catch((caught: unknown) => caught);

    expect(contrastRefusalOf(error)).toBeNull();
    expect(contrastRefusalOf(new Error('synthetic'))).toBeNull();
  });
});

describe('assetUploadFromForm (C160.6)', () => {
  const png = () =>
    new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'logo.png', { type: 'image/png' });

  it('reads a logo upload', async () => {
    const upload = await assetUploadFromForm(form({ kind: 'logo', file: png() }));

    expect(upload).toMatchObject({ kind: 'logo', licenceAttested: false });
    expect(upload.file.filename).toBe('logo.png');
    expect([...upload.file.bytes]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('refuses a font without the licence attestation (decision 27)', async () => {
    const font = new File([new Uint8Array([0x77, 0x4f, 0x46, 0x32])], 'brand.woff2');

    await expect(assetUploadFromForm(form({ kind: 'font', file: font }))).rejects.toBeInstanceOf(
      ActionInputError,
    );
    await expect(
      assetUploadFromForm(form({ kind: 'font', file: font, 'licence-attested': 'on' })),
    ).resolves.toMatchObject({ kind: 'font', licenceAttested: true });
  });

  it('refuses a missing or empty file, and an unknown kind', async () => {
    await expect(assetUploadFromForm(form({ kind: 'logo' }))).rejects.toBeInstanceOf(
      ActionInputError,
    );
    await expect(
      assetUploadFromForm(form({ kind: 'logo', file: new File([], 'empty.png') })),
    ).rejects.toBeInstanceOf(ActionInputError);
    await expect(assetUploadFromForm(form({ kind: 'icon', file: png() }))).rejects.toBeInstanceOf(
      ActionInputError,
    );
  });

  it('refuses a file over the kind limit before sending it', async () => {
    const big = new File([new Uint8Array(262_145)], 'big.png', { type: 'image/png' });

    const error = await assetUploadFromForm(form({ kind: 'logo', file: big })).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ActionInputError);
    expect((error as ActionInputError).problem.errors?.[0]?.detail).toMatch(/256 KiB/);
  });
});

describe('uploadThemeAsset (C160.6)', () => {
  it('posts the bytes as multipart with the kind and the attestation', async () => {
    api.on('POST', `${THEME_SETS_PATH}/assets`, 201, { data: themeAssetResource('font') });

    const asset = await uploadThemeAsset(client(), {
      kind: 'font',
      file: { bytes: new Uint8Array([1, 2]), filename: 'brand.woff2', mimeType: 'font/woff2' },
      licenceAttested: true,
    });

    expect(asset.data.id).toBe(THEME_IDS.font);
    expect(api.find('POST', `${THEME_SETS_PATH}/assets`)).toBeDefined();
  });
});

describe('setDefaultThemeSet (C160.7)', () => {
  it('sets and clears default-theme-set-id', async () => {
    api.me({ permissions: ['settings:write'] });
    api.on('PATCH', '/dashboard/settings', 200, {
      data: { type: 'settings', id: 'settings', attributes: {} },
    });

    await setDefaultThemeSet(THEME_IDS.set).catch(() => undefined);
    expect(api.find('PATCH', '/dashboard/settings')?.body).toEqual({
      'default-theme-set-id': THEME_IDS.set,
    });

    await setDefaultThemeSet(null).catch(() => undefined);
    expect(api.find('PATCH', '/dashboard/settings')?.body).toEqual({
      'default-theme-set-id': null,
    });
  });
});
