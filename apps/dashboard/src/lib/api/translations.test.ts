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
  serveTranslations,
  translationRow,
  translationsPath,
} from '../../testing/routes/themes-copy';
import { ActionInputError } from './action';
import {
  csvProblemsOf,
  fetchTranslationsCsv,
  getTranslations,
  importTranslations,
  translationRefusalsOf,
  translationRowsFromForm,
  uploadTranslationsCsv,
} from './translations';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: RouteApi;
const client = () => createClient({ apiKey: SESSION_TOKEN, baseUrl: API_URL, maxRetries: 0 });
const ROWS = [
  translationRow('consent.title', { en: 'Before we start', es: 'Antes de empezar' }),
  translationRow('label', { en: 'Synthetic name' }, { step: 'welcome', component: 'name' }),
];

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
});

describe('getTranslations and importTranslations (C162.7)', () => {
  it('reads the rows of the latest draft, else the latest published version', async () => {
    serveTranslations(api, ROWS);

    const document = await getTranslations(client(), THEME_IDS.template);

    expect(document.data.attributes.translations).toEqual(ROWS);
  });

  it('posts rows as the JSON document the route takes', async () => {
    api.on('POST', translationsPath(), 200, {
      data: {
        type: 'inquiry-template-translations',
        id: THEME_IDS.template,
        attributes: { 'inquiry-template-version-id': THEME_IDS.draft, translations: ROWS },
      },
    });

    await importTranslations(client(), THEME_IDS.template, ROWS);

    expect(api.find('POST', translationsPath())?.body).toEqual({
      data: { type: 'inquiry-template-translations', attributes: { translations: ROWS } },
    });
  });
});

describe('translationRefusalsOf (C162.2, C162.3)', () => {
  it('answers each refused cell by pointer and code, never a value', async () => {
    api.on(
      'POST',
      translationsPath(),
      422,
      problemDocument(422, undefined, {
        errors: [
          {
            location: 'body',
            pointer: '/data/attributes/translations/0/locale-values/1/value',
            detail: 'Bidirectional embeddings and overrides (U+202A to U+202E) are refused.',
            code: 'copy_bidi_override',
          },
        ],
      }),
    );

    const error = await importTranslations(client(), THEME_IDS.template, ROWS).catch(
      (caught: unknown) => caught,
    );

    expect(translationRefusalsOf(error)).toEqual([
      {
        pointer: '/data/attributes/translations/0/locale-values/1/value',
        code: 'copy_bidi_override',
      },
    ]);
    expect(translationRefusalsOf(new Error('synthetic'))).toBeNull();
  });
});

describe('translationRowsFromForm', () => {
  it('reads the editor rows from their JSON field through the contract schema', () => {
    const data = new FormData();
    data.set('rows', JSON.stringify(ROWS));

    expect(translationRowsFromForm(data)).toEqual(ROWS);
  });

  it('refuses no rows, and rows the schema refuses', () => {
    const empty = new FormData();
    empty.set('rows', '[]');
    expect(() => translationRowsFromForm(empty)).toThrow(ActionInputError);
    const broken = new FormData();
    broken.set('rows', '{');
    expect(() => translationRowsFromForm(broken)).toThrow(ActionInputError);
  });
});

describe('the CSV routes (C162.7)', () => {
  it('downloads translations.csv with the session, as text/csv', async () => {
    api.handle('GET', `${translationsPath()}.csv`, () => ({ status: 200, body: 'step' }));

    const response = await fetchTranslationsCsv(THEME_IDS.template);

    expect(response?.status).toBe(200);
    const request = api.find('GET', `${translationsPath()}.csv`);
    expect(request?.headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(request?.headers.get('accept')).toBe('text/csv');
  });

  it('uploads the bytes as text/csv', async () => {
    api.handle('POST', `${translationsPath()}.csv`, () => ({ status: 200, body: {} }));

    await uploadTranslationsCsv(THEME_IDS.template, new TextEncoder().encode('step,component'));

    const request = api.find('POST', `${translationsPath()}.csv`);
    expect(request?.headers.get('content-type')).toBe('text/csv');
  });

  it('answers null without a session', async () => {
    fakeRequest.reset();

    expect(await fetchTranslationsCsv(THEME_IDS.template)).toBeNull();
    expect(await uploadTranslationsCsv(THEME_IDS.template, new Uint8Array())).toBeNull();
  });

  it('reads the row and column of each CSV problem from its pointer, never a value', () => {
    expect(
      csvProblemsOf({
        errors: [
          { pointer: '/rows/header/step', code: 'missing_column', detail: 'missing_column' },
          { pointer: '/rows/header', code: 'unknown_column', detail: 'unknown_column' },
          { pointer: '/rows/4/es', code: 'copy_too_long', detail: 'A text may be at most 40.' },
          { pointer: '/elsewhere', code: 'x', detail: 'x' },
        ],
      }),
    ).toEqual([
      { row: null, column: 'step', code: 'missing_column' },
      { row: null, column: null, code: 'unknown_column' },
      { row: 4, column: 'es', code: 'copy_too_long' },
    ]);
    expect(csvProblemsOf('not a problem')).toEqual([]);
  });
});
