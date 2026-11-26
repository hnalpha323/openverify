// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../../testing/api-routes';
import { fakeRequest } from '../../../../testing/fake-request';
import {
  PREVIEW_IDS,
  PRESETS_PATH,
  ownPreset,
  previewDocument,
  previewPath,
  previewRoutes,
  simulatePath,
  simulationDocument,
} from '../../../../testing/routes/preview';
import { removePreset, resolvePreview, runSimulation, savePreset } from './actions';

vi.mock('next/headers', () =>
  import('../../../../testing/fake-request').then((m) => m.nextHeaders),
);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: ['inquiry-templates:read'] });
  previewRoutes(api);
});

afterEach(() => {
  api.restore();
});

const VERSION = PREVIEW_IDS.version;

describe('resolving a preview (C156.1)', () => {
  it('posts the unsaved members and the locale, and answers the document', async () => {
    const body = {
      data: { attributes: { 'theme-set-id': PREVIEW_IDS.themeSet } },
      meta: { locale: 'en-XA' },
    };

    await expect(resolvePreview({ 'version-id': VERSION, body })).resolves.toEqual({
      ok: true,
      data: previewDocument(),
    });
    expect(api.find('POST', previewPath())?.body).toEqual(body);
  });

  it('refuses a malformed request without calling the API', async () => {
    for (const input of [
      { 'version-id': 'itmplv_../x', body: { meta: { locale: 'en' } } },
      { 'version-id': VERSION, body: { meta: { locale: 'xx' } } },
      { 'version-id': VERSION, body: { meta: { locale: 'en' }, extra: true } },
      null,
    ]) {
      const result = await resolvePreview(input);
      expect(result.ok).toBe(false);
    }
    expect(api.all('POST', previewPath())).toEqual([]);
  });

  it('answers the API’s 422 with its pointers, for the page to place', async () => {
    api.onProblem('POST', previewPath(), 422, undefined, {
      errors: [{ pointer: '/meta/locale', detail: 'Synthetic: the version does not enable fr.' }],
    });

    const result = await resolvePreview({
      'version-id': VERSION,
      body: { meta: { locale: 'fr' } },
    });

    expect(result).toMatchObject({
      ok: false,
      problem: {
        status: 422,
        errors: [{ pointer: '/meta/locale', detail: 'Synthetic: the version does not enable fr.' }],
      },
    });
  });

  it('answers forbidden without inquiry-templates:read, calling nothing', async () => {
    api.me({ permissions: ['inquiries:read'] });

    const result = await resolvePreview({
      'version-id': VERSION,
      body: { meta: { locale: 'en' } },
    });

    expect(result.ok).toBe(false);
    expect(api.all('POST', previewPath())).toEqual([]);
  });
});

describe('simulating a path (C156.4)', () => {
  it('posts a scope and answers the simulated path', async () => {
    const body = { meta: { scope: { device: { kind: null } } } };

    await expect(runSimulation({ 'version-id': VERSION, body })).resolves.toEqual({
      ok: true,
      data: simulationDocument(),
    });
    expect(api.find('POST', simulatePath())?.body).toEqual(body);
  });

  it('posts a preset id', async () => {
    const body = { meta: { 'preset-id': 'builtin:government-id-failed' } };

    await runSimulation({ 'version-id': VERSION, body });

    expect(api.find('POST', simulatePath())?.body).toEqual(body);
  });

  it('refuses both a scope and a preset, without calling the API', async () => {
    const result = await runSimulation({
      'version-id': VERSION,
      body: { meta: { scope: {}, 'preset-id': 'builtin:selfie-failed' } },
    });

    expect(result.ok).toBe(false);
    expect(api.all('POST', simulatePath())).toEqual([]);
  });

  it('answers the API’s 422 at the scope pointer', async () => {
    api.onProblem('POST', simulatePath(), 422, undefined, {
      errors: [{ pointer: '/meta/scope/signals/inquiry~1x', detail: 'Synthetic refusal.' }],
    });

    const result = await runSimulation({
      'version-id': VERSION,
      body: { meta: { scope: { signals: { 'inquiry/x': 1 } } } },
    });

    expect(result).toMatchObject({ ok: false, problem: { status: 422 } });
  });
});

describe('presets (C156.4)', () => {
  it('saves a named scope of mine and answers the preset', async () => {
    api.on('POST', PRESETS_PATH, 201, { data: ownPreset() });
    const scope = { verifications: { id_card: { status: 'failed' } } };

    await expect(savePreset({ name: 'Synthetic failed capture', scope })).resolves.toEqual({
      ok: true,
      data: ownPreset(),
    });
    expect(api.find('POST', PRESETS_PATH)?.body).toEqual({
      data: { type: 'simulation-preset', attributes: { name: 'Synthetic failed capture', scope } },
    });
  });

  it('refuses a preset without a name', async () => {
    const result = await savePreset({ name: '', scope: {} });

    expect(result.ok).toBe(false);
    expect(api.all('POST', PRESETS_PATH)).toEqual([]);
  });

  it('deletes one of mine, and never a built-in', async () => {
    api.on('DELETE', `${PRESETS_PATH}/${PREVIEW_IDS.preset}`, 204);

    await expect(removePreset({ id: PREVIEW_IDS.preset })).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect((await removePreset({ id: 'builtin:selfie-failed' })).ok).toBe(false);
    expect(api.all('DELETE', `${PRESETS_PATH}/${PREVIEW_IDS.preset}`)).toHaveLength(1);
  });
});
