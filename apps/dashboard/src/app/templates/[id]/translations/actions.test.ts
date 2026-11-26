// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../testing/api-fixtures';
import { problemDocument } from '../../../../testing/api-mock';
import { routeApi, type RouteApi } from '../../../../testing/api-routes';
import { fakeRequest } from '../../../../testing/fake-request';
import { LIFECYCLE_IDS, draft } from '../../../../testing/lifecycle-fixtures';
import {
  COPY_EDITOR,
  VERSION_ETAG,
  translationRow,
  translationsDocument,
  translationsPath,
} from '../../../../testing/routes/themes-copy';
import { importTranslationRows, saveTemplateLocales } from './actions';

vi.mock('next/headers', () =>
  import('../../../../testing/fake-request').then((m) => m.nextHeaders),
);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;
const ID = LIFECYCLE_IDS.template;
const ROWS = [translationRow('consent.title', { en: 'Synthetic', fr: 'Synthétique' })];

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: COPY_EDITOR });
});

afterEach(() => {
  api.restore();
});

function form(entries: readonly (readonly [string, string])[]): FormData {
  const data = new FormData();
  for (const [name, value] of entries) {
    data.append(name, value);
  }
  return data;
}

describe('importTranslationRows (C162.7)', () => {
  it('imports the edited rows and answers how many texts were saved', async () => {
    api.on('POST', translationsPath(ID), 200, translationsDocument(ROWS));

    const result = await importTranslationRows(
      null,
      form([
        ['inquiry-template-id', ID],
        ['rows', JSON.stringify(ROWS)],
      ]),
    );

    expect(result).toEqual({ ok: true, data: { kind: 'saved', count: 2 } });
    expect(api.find('POST', translationsPath(ID))?.body).toEqual({
      data: { type: 'inquiry-template-translations', attributes: { translations: ROWS } },
    });
  });

  it('answers the refused cells by pointer and code', async () => {
    const pointer = '/data/attributes/translations/0/locale-values/1/value';
    api.on(
      'POST',
      translationsPath(ID),
      422,
      problemDocument(422, undefined, {
        errors: [{ location: 'body', pointer, detail: 'synthetic', code: 'copy_markup' }],
      }),
    );

    const result = await importTranslationRows(
      null,
      form([
        ['inquiry-template-id', ID],
        ['rows', JSON.stringify(ROWS)],
      ]),
    );

    expect(result).toEqual({
      ok: true,
      data: { kind: 'refused', refusals: [{ pointer, code: 'copy_markup' }] },
    });
  });

  it('refuses without inquiry-templates:write, calling nothing', async () => {
    api.me({ permissions: ['inquiry-templates:read'] });

    const result = await importTranslationRows(
      null,
      form([
        ['inquiry-template-id', ID],
        ['rows', JSON.stringify(ROWS)],
      ]),
    );

    expect(result.ok).toBe(false);
    expect(api.find('POST', translationsPath(ID))).toBeUndefined();
  });
});

describe('saveTemplateLocales (C161.2)', () => {
  const path = `/inquiry-template-versions/${LIFECYCLE_IDS.draft}`;
  const locales = (defaultLocale: string) =>
    form([
      ['inquiry-template-id', ID],
      ['version-id', LIFECYCLE_IDS.draft],
      ['etag', VERSION_ETAG],
      ['enabled-locales', 'en'],
      ['enabled-locales', 'ar'],
      ['default-locale', defaultLocale],
    ]);

  it('saves the base tags and the default with If-Match', async () => {
    api.on('PATCH', path, 200, { data: draft() }, { etag: VERSION_ETAG });

    const result = await saveTemplateLocales(null, locales('ar'));

    expect(result.ok).toBe(true);
    const request = api.find('PATCH', path);
    expect(request?.headers.get('if-match')).toBe(VERSION_ETAG);
    expect(request?.body).toMatchObject({
      data: { attributes: { 'enabled-locales': ['en', 'ar'], 'default-locale': 'ar' } },
    });
  });

  it('refuses a default that is not enabled, and a region tag, before calling the API', async () => {
    expect((await saveTemplateLocales(null, locales('fr'))).ok).toBe(false);
    expect((await saveTemplateLocales(null, locales('ar-EG'))).ok).toBe(false);
    expect(api.find('PATCH', path)).toBeUndefined();
  });

  it('says a draft changed meanwhile in words (412)', async () => {
    api.on('PATCH', path, 412, problemDocument(412, undefined, { code: 'precondition_failed' }));

    const result = await saveTemplateLocales(null, locales('en'));

    expect(!result.ok && result.problem.title).toMatch(
      /The draft changed since this page was opened/,
    );
  });
});
