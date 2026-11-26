/**
 * C71.1, C71.2, C72.1: report templates and their versions over the API, on PGlite, with a
 * synthetic source catalog and synthetic source rows.
 */
import { seedWatchlistSource } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestWatchlistCatalog } from '../../services/reports/testing.js';
import { bearer, createTestApi, expectStatus, type TestApi } from '../../test-support/harness.js';

let api: TestApi;
let production: { environmentId: string; token: string };
let restoreCatalog: () => void;

beforeAll(async () => {
  restoreCatalog = useTestWatchlistCatalog();
  api = await createTestApi();
  production = await api.newTenant({ kind: 'production' });
  const db = api.database.db;
  await seedWatchlistSource(db, { id: 'ofac-sdn' });
  await seedWatchlistSource(db, { id: 'eu-fsf' });
  // Disabled by the operator (C76.4): never pinned by default.
  await seedWatchlistSource(db, { id: 'uk-sanctions-list', enabled: false });
  await seedWatchlistSource(db, { id: 'openverify-sandbox', sandboxOnly: true });
  await seedWatchlistSource(db, { id: 'wikidata-pep' });
  await seedWatchlistSource(db, { id: 'openverify-sandbox-pep', sandboxOnly: true });
}, 60_000);

afterAll(async () => {
  restoreCatalog();
  await api.close();
});

type Json = Record<string, unknown>;

function send(method: 'POST' | 'GET' | 'PATCH', url: string, token: string, payload?: unknown) {
  return api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: bearer(token),
    ...(payload === undefined ? {} : { payload: payload as Json }),
  });
}

const createTemplate = (token: string, attributes: Json) =>
  send('POST', '/report-templates', token, { data: { type: 'report-template', attributes } });

const configOf = (document: { data: { attributes: Json } }) =>
  (document.data.attributes['current-version'] as { config: Json }).config;

function problem(response: { statusCode: number; json: () => unknown }) {
  const body = response.json() as { code?: string; errors?: { pointer?: string }[] };
  return {
    status: response.statusCode,
    code: body.code,
    pointers: (body.errors ?? []).map((error) => error.pointer),
  };
}

describe('POST /report-templates (C71.1, C71.2)', () => {
  it('publishes version 1 with the defaults and pins every enabled sanctions list of a sandbox', async () => {
    const response = await createTemplate(api.token, {
      'report-type': 'watchlist',
      name: 'Synthetic watchlist',
    });

    const document = expectStatus(response, 201);
    expect(response.headers.location).toBe(`/api/v1/report-templates/${document.data.id}`);
    expect(document.data.type).toBe('report-template');
    expect(document.data.attributes).toMatchObject({
      'report-type': 'watchlist',
      name: 'Synthetic watchlist',
      status: 'active',
      'current-version': { 'version-number': 1 },
    });
    expect(configOf(document)).toMatchObject({
      'search-lists': ['eu-fsf', 'ofac-sdn', 'openverify-sandbox'],
      'name-matching': { preset: 'tolerant' },
      'max-list-age-hours': 48,
      'recurrence-interval-days': null,
    });
    expect(api.audit.entries.map((entry) => entry.action)).toContain('report-template.created');
  });

  it('pins only the enabled, not sandbox-only sources of the kind in production', async () => {
    const sanctions = expectStatus(
      await createTemplate(production.token, { 'report-type': 'watchlist', name: 'Watchlist' }),
      201,
    );
    const pep = expectStatus(
      await createTemplate(production.token, {
        'report-type': 'politically-exposed-person',
        name: 'PEP',
      }),
      201,
    );

    expect(configOf(sanctions)['search-lists']).toEqual(['eu-fsf', 'ofac-sdn']);
    // V01: the PEP list is pinned before any sync.
    expect(configOf(pep)['search-lists']).toEqual(['wikidata-pep']);
    expect(configOf(pep)['max-list-age-hours']).toBe(192);
  });

  it('refuses a sandbox-only, unknown, other-kind or empty source list (422 with pointers)', async () => {
    const lists = async (token: string, searchLists: string[]) =>
      problem(
        await createTemplate(token, {
          'report-type': 'watchlist',
          name: 'Watchlist',
          config: { 'search-lists': searchLists },
        }),
      );

    expect(await lists(production.token, ['ofac-sdn', 'openverify-sandbox'])).toEqual({
      status: 422,
      code: 'watchlist_source_not_allowed',
      pointers: ['/data/attributes/config/search-lists/1'],
    });
    expect(await lists(api.token, ['not-a-list'])).toEqual({
      status: 422,
      code: 'watchlist_source_unknown',
      pointers: ['/data/attributes/config/search-lists/0'],
    });
    expect(await lists(api.token, ['wikidata-pep'])).toEqual({
      status: 422,
      code: 'watchlist_source_not_allowed',
      pointers: ['/data/attributes/config/search-lists/0'],
    });
    expect(await lists(api.token, [])).toEqual({
      status: 422,
      code: 'watchlist_sources_empty',
      pointers: ['/data/attributes/config/search-lists'],
    });
  });

  it('refuses a configuration the type does not take, and a list age below a refresh interval', async () => {
    const recurring = await createTemplate(api.token, {
      'report-type': 'email-address',
      name: 'Emails',
      config: { 'recurrence-interval-days': 7 },
    });
    const young = await createTemplate(api.token, {
      'report-type': 'watchlist',
      name: 'Watchlist',
      config: { 'search-lists': ['ofac-sdn'], 'max-list-age-hours': 2 },
    });

    expect(problem(recurring)).toMatchObject({
      status: 422,
      pointers: ['/data/attributes/config/recurrence-interval-days'],
    });
    expect(problem(young)).toMatchObject({
      status: 422,
      pointers: ['/data/attributes/config/max-list-age-hours'],
    });
  });

  it('creates a template of a type without lists, with its defaults', async () => {
    const document = expectStatus(
      await createTemplate(api.token, { 'report-type': 'email-address', name: 'Emails' }),
      201,
    );

    expect(configOf(document)).toEqual({
      'recurrence-interval-days': null,
      'min-domain-age-days': 30,
      'young-domain-days': 365,
    });
  });
});

describe('GET and PATCH /report-templates', () => {
  it('lists by type, fetches one, archives it and answers 404 for another environment', async () => {
    const created = expectStatus(
      await createTemplate(api.token, { 'report-type': 'phone-number', name: 'Phones' }),
      201,
    );
    const id = created.data.id;

    const listed = expectStatus(
      await send('GET', '/report-templates?filter[report-type]=phone-number', api.token),
      200,
    ) as unknown as { data: { id: string }[]; links: { next: string | null } };
    expect(listed.data.map((template) => template.id)).toEqual([id]);
    expect(listed.links.next).toBeNull();
    expect(expectStatus(await send('GET', `/report-templates/${id}`, api.token), 200).data.id).toBe(
      id,
    );

    const archived = expectStatus(
      await send('PATCH', `/report-templates/${id}`, api.token, {
        data: { attributes: { status: 'archived', name: 'Old phones' } },
      }),
      200,
    );
    expect(archived.data.attributes).toMatchObject({ status: 'archived', name: 'Old phones' });
    expect((await send('GET', `/report-templates/${id}`, production.token)).statusCode).toBe(404);
  });
});

describe('report template versions (C71.1)', () => {
  it('drafts, updates and publishes a version, superseding the published one', async () => {
    const template = expectStatus(
      await createTemplate(api.token, {
        'report-type': 'watchlist',
        name: 'Versions',
        config: { 'search-lists': ['ofac-sdn'] },
      }),
      201,
    );
    const templateId = template.data.id;
    const firstVersionId = (template.data.attributes['current-version'] as { id: string }).id;

    const draft = expectStatus(
      await send('POST', '/report-template-versions', api.token, {
        data: {
          attributes: { 'report-template-id': templateId, config: { 'pause-on-match': true } },
        },
      }),
      201,
    );
    expect(draft.data.attributes).toMatchObject({
      'report-type': 'watchlist',
      'version-number': 2,
      status: 'draft',
      'published-at': null,
    });
    // The omitted list is resolved and pinned when the version is created (C71.2).
    expect((draft.data.attributes.config as Json)['search-lists']).toEqual([
      'eu-fsf',
      'ofac-sdn',
      'openverify-sandbox',
    ]);

    const updated = expectStatus(
      await send('PATCH', `/report-template-versions/${draft.data.id}`, api.token, {
        data: {
          attributes: { config: { 'search-lists': ['eu-fsf'], 'recurrence-interval-days': 30 } },
        },
      }),
      200,
    );
    expect(updated.data.attributes.config).toMatchObject({
      'search-lists': ['eu-fsf'],
      'recurrence-interval-days': 30,
      'pause-on-match': false,
    });

    const published = expectStatus(
      await send('POST', `/report-template-versions/${draft.data.id}/publish`, api.token, {}),
      200,
    );
    expect(published.data.attributes.status).toBe('published');
    const current = expectStatus(
      await send('GET', `/report-templates/${templateId}`, api.token),
      200,
    );
    expect((current.data.attributes['current-version'] as { id: string }).id).toBe(draft.data.id);
    const first = expectStatus(
      await send('GET', `/report-template-versions/${firstVersionId}`, api.token),
      200,
    );
    expect(first.data.attributes.status).toBe('superseded');

    const versions = expectStatus(
      await send(
        'GET',
        `/report-template-versions?filter[report-template-id]=${templateId}`,
        api.token,
      ),
      200,
    ) as unknown as { data: { id: string }[] };
    expect(versions.data.map((version) => version.id)).toEqual([draft.data.id, firstVersionId]);
    expect(api.audit.entries.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        'report-template-version.created',
        'report-template-version.updated',
        'report-template-version.published',
      ]),
    );

    // Only drafts change (409).
    expect(
      (await send('POST', `/report-template-versions/${draft.data.id}/publish`, api.token, {}))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await send('PATCH', `/report-template-versions/${draft.data.id}`, api.token, {
          data: { attributes: { config: {} } },
        })
      ).statusCode,
    ).toBe(409);
  });

  it('checks a draft against its template type, and answers 404 for an unknown template', async () => {
    const template = expectStatus(
      await createTemplate(api.token, { 'report-type': 'address-lookup', name: 'Addresses' }),
      201,
    );

    const refused = await send('POST', '/report-template-versions', api.token, {
      data: {
        attributes: { 'report-template-id': template.data.id, config: { 'search-lists': [] } },
      },
    });
    expect(problem(refused)).toMatchObject({
      status: 422,
      pointers: ['/data/attributes/config'],
    });
    const unknown = await send('POST', '/report-template-versions', production.token, {
      data: { attributes: { 'report-template-id': template.data.id, config: {} } },
    });
    expect(unknown.statusCode).toBe(404);
  });
});
