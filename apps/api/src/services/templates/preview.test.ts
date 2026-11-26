/**
 * C156.1 (Workflow 9B, `api-templates-finish`): `POST /inquiry-template-versions/:id/preview`.
 *
 * - The document holds every renderable step's client view (C151.5's `step` form; a branch and an
 *   action left out), a flow-spec 1 version through its migration, as the engine walks it.
 * - The theme is the version's (or the body's) set, else the environment's default, else the
 *   built-in tokens, through `api-themes`' `resolveThemeForVersion`, with the contrast gate's answer:
 *   unsaved `styles` replace the set's and a failing palette is answered, not refused (review H15).
 * - The copy is the version's (or the body's) for `meta.locale`, an enabled locale or a pseudo-locale:
 *   C162.5's fallbacks the server can resolve (a component text falls back to the default locale's;
 *   a built-in key is left to the client's catalog), and for `en-XA` and `ar-XB` the `en` texts,
 *   built-in ones included, through the pseudo-locale transform, so nothing arrives untransformed.
 * - The guidance is configuration only: what each capture step asks for and the values a consent
 *   text is filled with; never inquiry data and never a field's default.
 * - Nothing is stored; another environment's version is 404.
 *
 * Every value is synthetic.
 */
import { readFileSync } from 'node:fs';
import {
  defaultInquiryTemplateAttributes,
  templatePreviewDocumentSchema,
  type TemplateCopy,
} from '@openverify/contracts';
import { BUILTIN_PALETTES, contrastRatio } from '@openverify/core';
import { resolveFaceTemplateSettings } from '@openverify/db';
import {
  clientViewOf,
  migrateFlow,
  parseAnyFlow,
  pseudoLocalize,
  type ClientStepView,
  type FlowV1,
  type FlowV2,
} from '@openverify/flow-spec';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInquiryTestApi, type InquiryTestApi } from '../inquiries.test-support.js';
import {
  bearer,
  createTemplate,
  expectStatus,
  type TestTenant,
} from '../../test-support/harness.js';
import { previewCopy, previewGuidance } from './preview.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const defaults = defaultInquiryTemplateAttributes();
const fixturePath = (path: string) =>
  new URL(`../../../../../contracts/fixtures/${path}`, import.meta.url);
const readJson = (path: string): unknown => JSON.parse(readFileSync(fixturePath(path), 'utf8'));
const flowFixture = (name: string) => readJson(`flows/v2/${name}.json`) as FlowV2;

/** The `en` built-in catalog `flow-i18n` exports (C161.8), flattened to dotted keys. */
function englishCatalog(): Record<string, string> {
  const flat: Record<string, string> = {};
  const walk = (tree: Record<string, unknown>, prefix: string) => {
    for (const [key, value] of Object.entries(tree)) {
      if (typeof value === 'string') flat[`${prefix}${key}`] = value;
      else walk(value as Record<string, unknown>, `${prefix}${key}.`);
    }
  };
  walk((readJson('i18n/en.json') as { messages: Record<string, unknown> }).messages, '');
  return flat;
}

const viewsOf = (flow: FlowV2): ClientStepView[] =>
  flow.steps.flatMap((step) => {
    const view = clientViewOf(step);
    return view === null ? [] : [view];
  });

const call = (url: string, payload: unknown, token = api.token) =>
  api.app.inject({
    method: 'POST',
    url: `/api/v1${url}`,
    headers: bearer(token),
    payload: payload as Record<string, unknown>,
  });

/** The screen fixtures' one field, declared so their screens bind a known field. */
const NICKNAME = { key: 'nickname', type: 'string', label: 'Nickname', pii: true };

/** The default configuration of each verification type the flow's steps create. */
const configOf = (flow: FlowV2) => {
  const types = new Set(flow.steps.map(({ type }) => type));
  const config = defaults['verification-config'];
  return {
    ...(types.has('government_id') ? { 'government-id': config['government-id'] } : {}),
    ...(types.has('selfie') ? { selfie: config.selfie } : {}),
  };
};

/** A draft of `flow` on a new template of `tenant`, with `members`. */
async function draft(
  flow: FlowV2,
  members: Record<string, unknown> = {},
  tenant: TestTenant = api,
): Promise<string> {
  const templateId = await createTemplate(api, tenant.token);
  const created = await api.app.inject({
    method: 'POST',
    url: '/api/v1/inquiry-template-versions',
    headers: bearer(tenant.token),
    payload: {
      data: {
        attributes: {
          'inquiry-template-id': templateId,
          flow,
          'verification-config': configOf(flow),
          'field-schemas': [NICKNAME],
          ...members,
        },
      },
    },
  });
  return expectStatus(created, 201).data.id;
}

async function preview(id: string, body: Record<string, unknown>, token = api.token) {
  const response = await call(`/inquiry-template-versions/${id}/preview`, body, token);
  expect(response.statusCode, response.body).toBe(200);
  return {
    response,
    attributes: templatePreviewDocumentSchema.parse(response.json()).data.attributes,
  };
}

const days = resolveFaceTemplateSettings({})['face-template-retention-days'];

describe('the preview document of a stored version (C156.1)', () => {
  it('holds every renderable step’s client view, the built-in theme and the guidance', async () => {
    const flow = flowFixture('projection-branch');
    const id = await draft(flow);

    const { response, attributes } = await preview(id, { meta: { locale: 'en' } });

    expect(response.json()).toMatchObject({ data: { type: 'inquiry-template-preview', id } });
    expect(attributes.locale).toBe('en');
    expect(attributes['spec-version']).toBe(2);
    expect(attributes.steps).toEqual(viewsOf(flow));
    expect(attributes.steps.map(({ id: stepId }) => stepId)).not.toContain('age_route');
    expect(attributes.theme).toMatchObject({
      'theme-set-id': null,
      revision: null,
      mode: 'light',
      light: BUILTIN_PALETTES.light,
      dark: BUILTIN_PALETTES.dark,
    });
    expect(attributes.contrast.status).toBe('passed');
    expect(attributes.contrast.findings.every(({ level }) => level === 'warn')).toBe(true);
    expect(attributes.guidance).toEqual({
      consent: { days, organization: null },
      id_card: { sides: ['front'] },
    });
  });

  it('previews a flow-spec 1 version through its migration, as the engine walks it', async () => {
    const templateId = await createTemplate(api);
    const template = expectStatus(
      await api.app.inject({
        method: 'GET',
        url: `/api/v1/inquiry-templates/${templateId}`,
        headers: bearer(api.token),
      }),
      200,
    );
    const versionId = (template.data.attributes as { 'current-version': { id: string } })[
      'current-version'
    ].id;

    const { attributes } = await preview(versionId, { meta: { locale: 'en' } });

    expect(attributes.steps).toEqual(viewsOf(migrateFlow(parseAnyFlow(defaults.flow) as FlowV1)));
    expect(attributes.guidance).toMatchObject({ selfie: { poses: expect.any(Array) as unknown } });
  });

  it('is 404 for a version of another environment or an unknown one', async () => {
    const other = await api.newTenant();
    const foreign = await draft(flowFixture('projection-linear'), {}, other);
    const response = await call(`/inquiry-template-versions/${foreign}/preview`, {
      meta: { locale: 'en' },
    });
    expect(response.statusCode, response.body).toBe(404);
    const unknown = await call(
      '/inquiry-template-versions/itmplv_01M5CN0000000000000000ZZZZ/preview',
      { meta: { locale: 'en' } },
    );
    expect(unknown.statusCode, unknown.body).toBe(404);
  });

  it('refuses a stored flow it cannot read at /data/attributes/flow, and previews a body’s instead', async () => {
    const id = await draft(flowFixture('projection-linear'));
    await api.database.client.query(
      `update inquiry_template_versions set flow = '{"steps": "unreadable"}'::jsonb where id = $1`,
      [id],
    );
    const refused = await call(`/inquiry-template-versions/${id}/preview`, {
      meta: { locale: 'en' },
    });
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json()).toMatchObject({ errors: [{ pointer: '/data/attributes/flow' }] });

    const flow = flowFixture('projection-linear');
    const { attributes } = await preview(id, {
      data: { attributes: { flow } },
      meta: { locale: 'en' },
    });
    expect(attributes.steps).toEqual(viewsOf(flow));
  });
});

describe('the preview’s locale and copy (C156.1, C161.7, C162.5)', () => {
  it('refuses a locale the version does not enable, at /meta/locale', async () => {
    const id = await draft(flowFixture('projection-branch'));
    const response = await call(`/inquiry-template-versions/${id}/preview`, {
      meta: { locale: 'fr' },
    });
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json()).toMatchObject({ errors: [{ pointer: '/meta/locale' }] });
  });

  it('answers the copy for the locale: the version’s own texts, a component’s from the default', async () => {
    const id = await draft(flowFixture('projection-branch'), {
      'enabled-locales': ['en', 'es'],
      'default-locale': 'en',
    });
    const copy: TemplateCopy = {
      messages: {
        en: {
          'consent.title': 'Synthetic consent title',
          'extra_details.title.body': 'A few more details',
          'extra_details.nickname.label': 'Nickname',
        },
        es: { 'extra_details.title.body': 'Unos detalles más' },
      },
    };

    const { attributes } = await preview(id, {
      data: { attributes: { copy } },
      meta: { locale: 'es' },
    });

    expect(attributes.copy).toEqual({
      'extra_details.title.body': 'Unos detalles más',
      'extra_details.nickname.label': 'Nickname',
    });
  });

  it('transforms every en text for a pseudo-locale, the built-in ones included', async () => {
    const id = await draft(flowFixture('projection-branch'));
    const catalog = englishCatalog();
    const copy: TemplateCopy = {
      messages: { en: { 'consent.title': 'Synthetic consent title' } },
    };

    const { attributes } = await preview(id, {
      data: { attributes: { copy } },
      meta: { locale: 'en-XA' },
    });

    expect(attributes.locale).toBe('en-XA');
    expect(attributes.copy['consent.title']).toBe(
      pseudoLocalize('en-XA', 'Synthetic consent title'),
    );
    expect(attributes.copy.loading).toBe(pseudoLocalize('en-XA', catalog.loading ?? ''));
    expect(Object.keys(attributes.copy).sort()).toEqual(Object.keys(catalog).sort());
    const reversed = await preview(id, { meta: { locale: 'ar-XB' } });
    expect(reversed.attributes.copy.loading).toBe(pseudoLocalize('ar-XB', catalog.loading ?? ''));
  });
});

describe('previewCopy, the copy for one locale (C162.5)', () => {
  const copy: TemplateCopy = {
    messages: {
      en: { 'consent.title': 'Synthetic title', 'about.name.label': 'Name' },
      es: { 'about.name.label': 'Nombre' },
      fr: { 'about.name.label': 'Nom', 'about.city.label': 'Ville' },
    },
  };

  it('keeps the locale’s own text, then a component’s default-locale text, never a built-in key’s', () => {
    expect(
      previewCopy({ copy, enabledLocales: ['en', 'es'], defaultLocale: 'en', locale: 'es' }),
    ).toEqual({ 'about.name.label': 'Nombre' });
    expect(
      previewCopy({ copy, enabledLocales: ['en', 'es'], defaultLocale: 'es', locale: 'en' }),
    ).toEqual({ 'consent.title': 'Synthetic title', 'about.name.label': 'Name' });
  });

  it('reads no locale the version does not enable', () => {
    expect(
      previewCopy({ copy, enabledLocales: ['es', 'fr'], defaultLocale: 'fr', locale: 'es' }),
    ).toEqual({ 'about.name.label': 'Nombre', 'about.city.label': 'Ville' });
    expect(
      previewCopy({ copy, enabledLocales: ['es'], defaultLocale: 'es', locale: 'es' }),
    ).toEqual({ 'about.name.label': 'Nombre' });
  });

  it('takes a pseudo-locale’s texts from en, falling back as an en session would', () => {
    const catalog = englishCatalog();
    const pseudo = previewCopy({
      copy,
      enabledLocales: ['fr'],
      defaultLocale: 'fr',
      locale: 'ar-XB',
    });
    expect(pseudo['about.city.label']).toBe(pseudoLocalize('ar-XB', 'Ville'));
    // en is not enabled: its custom title is not shown, the built-in en title is.
    expect(pseudo['consent.title']).toBe(pseudoLocalize('ar-XB', catalog['consent.title'] ?? ''));
  });
});

describe('previewGuidance, configuration only', () => {
  it('names each capture step’s sides and poses and a consent step’s placeholder values', () => {
    const steps = [
      { id: 'consent', type: 'consent', textKeys: ['consent.biometric'], required: true },
      { id: 'front_only', type: 'government_id', sides: 'front', maxAttempts: 1 },
      { id: 'both_sides', type: 'government_id', sides: 'both', maxAttempts: 1 },
      { id: 'back_only', type: 'government_id', sides: 'back', maxAttempts: 1 },
      { id: 'face', type: 'selfie', poses: ['center', 'left'], liveness: 'active', maxAttempts: 1 },
      { id: 'done', type: 'completion' },
    ] as unknown as ClientStepView[];

    expect(previewGuidance(steps, { days: 30, organization: 'Example Org' })).toEqual({
      consent: { days: 30, organization: 'Example Org' },
      front_only: { sides: ['front'] },
      both_sides: { sides: ['front', 'back'] },
      back_only: { sides: ['back'] },
      face: { poses: ['center', 'left'] },
    });
  });
});

describe('an unsaved body (C156.1; review H15)', () => {
  it('previews the body’s flow, copy and styles, a failing palette answered, and stores nothing', async () => {
    const stored = flowFixture('projection-branch');
    const id = await draft(stored);
    const before = await readVersion(id);
    const unsaved = flowFixture('projection-screen');

    const { attributes } = await preview(id, {
      data: {
        attributes: {
          flow: unsaved,
          copy: { messages: { en: { 'extra_details.title.body': 'Unsaved words' } } },
          styles: { light: { palette: { ink: '#777777' } } },
        },
      },
      meta: { locale: 'en' },
    });

    expect(attributes.steps).toEqual(viewsOf(unsaved));
    expect(attributes.copy).toEqual({ 'extra_details.title.body': 'Unsaved words' });
    expect(attributes.theme.light.ink).toBe('#777777');
    expect(attributes.contrast.status).toBe('failed');
    expect(attributes.contrast.findings).toContainEqual({
      pointer: '/data/attributes/styles/light/palette/ink',
      foreground: 'ink',
      background: 'surface',
      ratio: contrastRatio('#777777', '#ffffff'),
      required: 4.5,
      level: 'fail',
    });
    expect(await readVersion(id)).toEqual(before);
  });

  it('refuses styles that contradict themselves, under /data/attributes/styles', async () => {
    const id = await draft(flowFixture('projection-linear'), {}, api);
    const response = await call(`/inquiry-template-versions/${id}/preview`, {
      data: { attributes: { styles: { settings: { 'use-dark-theme': true } } } },
      meta: { locale: 'en' },
    });
    expect(response.statusCode, response.body).toBe(422);
    const problem = response.json<{ errors: { pointer: string }[] }>();
    expect(problem.errors.length).toBeGreaterThan(0);
    expect(
      problem.errors.every(({ pointer }) => pointer.startsWith('/data/attributes/styles')),
    ).toBe(true);
  });

  it('never answers a field default the body carries', async () => {
    const canary = 'Synthetic-Canary-Wren';
    const id = await draft(flowFixture('projection-branch'));
    const { response } = await preview(id, {
      data: {
        attributes: {
          'field-schemas': [{ ...NICKNAME, default: canary }],
        },
      },
      meta: { locale: 'en' },
    });
    expect(response.body).not.toContain(canary);
  });
});

/** The version as the API answers it now, with its ETag. */
async function readVersion(id: string): Promise<{ etag: unknown; body: unknown }> {
  const response = await api.app.inject({
    method: 'GET',
    url: `/api/v1/inquiry-template-versions/${id}`,
    headers: bearer(api.token),
  });
  return { etag: response.headers.etag, body: expectStatus(response, 200) };
}

describe('the preview’s theme set (C160.7, C156.1)', () => {
  const themeSet = async (tenant: TestTenant, styles: Record<string, unknown>) =>
    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: '/api/v1/theme-sets',
        headers: bearer(tenant.token),
        payload: {
          data: {
            type: 'theme-set',
            attributes: { name: `Brand ${String(Math.random())}`, styles },
          },
        },
      }),
      201,
    ).data;

  it('resolves the version’s set, and the body’s instead when it names one', async () => {
    const stored = await themeSet(api, { light: { palette: { primary: '#1d4ed8' } } });
    const chosen = await themeSet(api, { shape: { radius: 12 } });
    const id = await draft(flowFixture('projection-linear'), { 'theme-set-id': stored.id });

    const fromVersion = await preview(id, { meta: { locale: 'en' } });
    expect(fromVersion.attributes.theme).toMatchObject({
      'theme-set-id': stored.id,
      revision: 1,
      light: { primary: '#1d4ed8' },
    });

    const fromBody = await preview(id, {
      data: { attributes: { 'theme-set-id': chosen.id } },
      meta: { locale: 'en' },
    });
    expect(fromBody.attributes.theme).toMatchObject({ 'theme-set-id': chosen.id, radius: 12 });

    const none = await preview(id, {
      data: { attributes: { 'theme-set-id': null } },
      meta: { locale: 'en' },
    });
    expect(none.attributes.theme['theme-set-id']).toBeNull();
  });

  it('refuses a body’s set that is not an active set of the environment, at its pointer', async () => {
    const other = await api.newTenant();
    const foreign = await themeSet(other, {});
    const archived = await themeSet(api, {});
    expectStatus(
      await api.app.inject({
        method: 'DELETE',
        url: `/api/v1/theme-sets/${archived.id}`,
        headers: bearer(api.token),
      }),
      200,
    );
    const id = await draft(flowFixture('projection-linear'));
    for (const themeSetId of [foreign.id, archived.id]) {
      const response = await call(`/inquiry-template-versions/${id}/preview`, {
        data: { attributes: { 'theme-set-id': themeSetId } },
        meta: { locale: 'en' },
      });
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json()).toMatchObject({
        errors: [{ pointer: '/data/attributes/theme-set-id' }],
      });
    }
  });
});
