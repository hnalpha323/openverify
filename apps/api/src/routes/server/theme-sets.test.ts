/**
 * C160.1-C160.5, C160.7 (`api-themes`, Workflow 9B): the theme set routes under `/api/v1`, scoped to
 * the caller's environment (decision 24): list, create, retrieve, update, archive, revisions and
 * restore. Every save passes the contrast gate first (422 `theme_contrast_insufficient` with each
 * failing pair, never rounded), writes an immutable revision and an audit entry naming it; an
 * unknown or mistyped cell is 400 with JSON Pointers; a contradiction is 422; archiving the default
 * is 409 `theme_set_default`. Every value is synthetic.
 */
import { contrastRatio } from '@openverify/core';
import { environments } from '@openverify/db';
import { createdAtClock, wallClockStepsBack } from '@openverify/db/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { bearer, createTestApi, expectStatus, type TestApi } from '../../test-support/harness.js';

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
  token = api.token,
) =>
  api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: bearer(token),
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

const body = (attributes: Record<string, unknown>) => ({
  data: { type: 'theme-set', attributes },
});

async function createSet(attributes: Record<string, unknown> = { name: 'Brand' }, token?: string) {
  return expectStatus(await call('POST', '/theme-sets', body(attributes), token), 201).data;
}

async function setDefault(environmentId: string, themeSetId: string | null) {
  await api.database.db
    .update(environments)
    .set({
      settings: sql`${environments.settings} || ${JSON.stringify({ 'default-theme-set-id': themeSetId })}::jsonb`,
    })
    .where(eq(environments.id, environmentId));
}

describe('POST /theme-sets (C160.1, C160.4, C160.5)', () => {
  it('creates revision 1 of a named set, audited with the revision, never the default', async () => {
    const styles = {
      light: { palette: { primary: '#1f4fd1' } },
      shape: { radius: 8 },
    };
    const created = await createSet({ name: '  Brand  ', styles });

    expect(created.id).toMatch(/^theset_/);
    expect(created.attributes).toMatchObject({
      name: 'Brand',
      status: 'active',
      styles,
      revision: 1,
      'is-default': false,
      'archived-at': null,
    });
    const [entry] = api.audit
      .withAction('theme-set.created')
      .filter((audit) => audit.resourceId === created.id);
    expect(entry).toMatchObject({
      resourceType: 'theme-set',
      environmentId: api.environmentId,
      metadata: { revision: 1 },
    });
    expect(JSON.stringify(entry?.metadata)).not.toContain('Brand');
  });

  it('takes no styles as the empty tree, every cell built in', async () => {
    const created = await createSet({ name: 'Plain' });
    expect(created.attributes.styles).toEqual({});
  });

  it.each([
    ['an unknown cell', { light: { palette: { accent: '#000000' } } }],
    ['a colour that is not #rrggbb', { light: { palette: { ink: '#FFF' } } }],
    ['a colour as a name', { light: { palette: { ink: 'black' } } }],
    ['a radius over 24', { shape: { radius: 25 } }],
    ['an unknown branch', { motion: {} }],
  ])('answers 400 for %s, with a JSON Pointer', async (_what, styles) => {
    const response = await call('POST', '/theme-sets', body({ name: 'Bad', styles }));
    expect(response.statusCode, response.body).toBe(400);
    const problem = response.json<{ errors: { pointer: string }[] }>();
    expect(problem.errors.length).toBeGreaterThan(0);
    expect(problem.errors.every(({ pointer }) => pointer.startsWith('/data/attributes'))).toBe(
      true,
    );
  });

  it('refuses a pair below its minimum with 422 naming each pair and its unrounded ratio', async () => {
    const before = await call('GET', '/theme-sets?page[size]=100');
    const response = await call(
      'POST',
      '/theme-sets',
      body({
        name: 'Low',
        styles: { light: { palette: { ink: '#777777', 'ink-muted': '#777777' } } },
      }),
    );

    expect(response.statusCode, response.body).toBe(422);
    const problem = response.json<{ code: string; pairs: Record<string, unknown>[] }>();
    expect(problem.code).toBe('theme_contrast_insufficient');
    expect(problem.pairs).toContainEqual({
      pointer: '/data/attributes/styles/light/palette/ink',
      foreground: 'ink',
      background: 'surface',
      ratio: contrastRatio('#777777', '#ffffff'),
      required: 4.5,
    });
    expect(problem.pairs).toContainEqual(
      expect.objectContaining({
        pointer: '/data/attributes/styles/light/palette/ink-muted',
        background: 'canvas',
      }),
    );
    // Only failures: the pair passes 7:1 or warns, never a refusal.
    expect(
      problem.pairs.every(({ ratio, required }) => (ratio as number) < (required as number)),
    ).toBe(true);
    expect(response.body).not.toContain('#777777');
    const after = await call('GET', '/theme-sets?page[size]=100');
    expect(after.json<{ data: unknown[] }>().data.length).toBe(
      before.json<{ data: unknown[] }>().data.length,
    );
  });

  it('names the foreground cell of a built-in token too, and checks the dark palette', async () => {
    const response = await call(
      'POST',
      '/theme-sets',
      body({
        name: 'Dark',
        styles: {
          settings: { 'use-dark-theme': true },
          dark: { palette: { primary: '#101828' } },
          light: { palette: { surface: '#4a5565' } },
        },
      }),
    );

    expect(response.statusCode, response.body).toBe(422);
    const pairs = response.json<{ pairs: { pointer: string; foreground: string }[] }>().pairs;
    // The built-in ink (unchanged) now fails on the operator's surface: its pointer is still ink's.
    expect(pairs).toContainEqual(
      expect.objectContaining({
        pointer: '/data/attributes/styles/light/palette/ink',
        background: 'surface',
      }),
    );
    expect(pairs).toContainEqual(
      expect.objectContaining({
        pointer: '/data/attributes/styles/dark/palette/primary',
        background: 'surface',
      }),
    );
  });

  it('refuses use-dark-theme without a dark palette as a contradiction (422)', async () => {
    const response = await call(
      'POST',
      '/theme-sets',
      body({ name: 'No dark', styles: { settings: { 'use-dark-theme': true } } }),
    );

    expect(response.statusCode, response.body).toBe(422);
    expect(response.json()).toMatchObject({
      errors: [{ pointer: '/data/attributes/styles/dark' }],
    });
  });

  it('refuses a logo that names no asset of the environment, and one with no alt key', async () => {
    const unknown = await call(
      'POST',
      '/theme-sets',
      body({
        name: 'Logo',
        styles: {
          branding: {
            logo: {
              'asset-id': 'tsa_01M5CK16P0D13FXHZSS4TCFBVH',
              'alt-key': 'brand.logo.alt',
              decorative: false,
            },
          },
        },
      }),
    );
    expect(unknown.statusCode, unknown.body).toBe(422);
    expect(unknown.json()).toMatchObject({
      errors: [{ pointer: '/data/attributes/styles/branding/logo/asset-id' }],
    });

    const font = await call(
      'POST',
      '/theme-sets',
      body({
        name: 'Font',
        styles: {
          typography: { font: { kind: 'uploaded', 'asset-id': 'tsa_01M5CK16P0D13FXHZSS4TCFBVH' } },
        },
      }),
    );
    expect(font.statusCode, font.body).toBe(422);
    expect(font.json()).toMatchObject({
      errors: [{ pointer: '/data/attributes/styles/typography/font/asset-id' }],
    });
  });

  it('needs theme-sets:write; a reader is refused', async () => {
    const reader = await api.newApiKey(api.environmentId, { scopes: ['theme-sets:read'] });
    const response = await call('POST', '/theme-sets', body({ name: 'Nope' }), reader);
    expect(response.statusCode).toBe(403);
  });
});

describe('GET /theme-sets and /theme-sets/:id (C160.1, C160.2)', () => {
  it('lists the environment’s sets newest first, by filter[status], with links.next', async () => {
    const tenant = await api.newTenant();
    onTestFinished(wallClockStepsBack());
    const clock = createdAtClock(api.database.db, new Date('2026-11-01T00:00:00Z'));
    const first = await createSet({ name: 'First' }, tenant.token);
    await clock.at('theme_sets', first.id);
    const second = await createSet({ name: 'Second' }, tenant.token);
    await clock.at('theme_sets', second.id);
    const third = await createSet({ name: 'Third' }, tenant.token);
    await clock.at('theme_sets', third.id);
    expectStatus(await call('DELETE', `/theme-sets/${second.id}`, undefined, tenant.token), 200);

    const all = expectStatus(
      await call('GET', '/theme-sets?page[size]=2', undefined, tenant.token),
      200,
    );
    expect((all as unknown as { data: { id: string }[] }).data.map(({ id }) => id)).toEqual([
      third.id,
      second.id,
    ]);
    expect(all.links?.next).toBe(`/api/v1/theme-sets?page[after]=${second.id}&page[size]=2`);
    const rest = expectStatus(
      await call(
        'GET',
        `/theme-sets?page[after]=${second.id}&page[size]=2`,
        undefined,
        tenant.token,
      ),
      200,
    ) as unknown as { data: { id: string }[]; links: { next: string | null } };
    expect(rest.data.map(({ id }) => id)).toEqual([first.id]);
    expect(rest.links.next).toBeNull();

    const archived = expectStatus(
      await call('GET', '/theme-sets?filter[status]=archived', undefined, tenant.token),
      200,
    ) as unknown as { data: { id: string }[] };
    expect(archived.data.map(({ id }) => id)).toEqual([second.id]);
  });

  it('never shows another environment’s set: 404 to read, change or archive, and absent from its list', async () => {
    const other = await api.newTenant();
    const theirs = await createSet({ name: 'Theirs' }, other.token);

    expect((await call('GET', `/theme-sets/${theirs.id}`)).statusCode).toBe(404);
    expect(
      (await call('PATCH', `/theme-sets/${theirs.id}`, body({ name: 'Mine' }))).statusCode,
    ).toBe(404);
    expect((await call('DELETE', `/theme-sets/${theirs.id}`)).statusCode).toBe(404);
    expect((await call('GET', `/theme-sets/${theirs.id}/revisions`)).statusCode).toBe(404);
    expect(
      (await call('POST', `/theme-sets/${theirs.id}/restore`, { meta: { revision: 1 } }))
        .statusCode,
    ).toBe(404);
    const listed = (await call('GET', '/theme-sets?page[size]=100')).json<{
      data: { id: string }[];
    }>();
    expect(listed.data.map(({ id }) => id)).not.toContain(theirs.id);
  });

  it('serves is-default for the environment’s default-theme-set-id', async () => {
    const tenant = await api.newTenant();
    const set = await createSet({ name: 'Default' }, tenant.token);
    await setDefault(tenant.environmentId, set.id);

    const read = expectStatus(
      await call('GET', `/theme-sets/${set.id}`, undefined, tenant.token),
      200,
    );
    expect(read.data.attributes['is-default']).toBe(true);
  });

  it('needs theme-sets:read', async () => {
    const none = await api.newApiKey(api.environmentId, { scopes: ['inquiries:read'] });
    expect((await call('GET', '/theme-sets', undefined, none)).statusCode).toBe(403);
  });
});

describe('PATCH /theme-sets/:id (C160.1, C160.5)', () => {
  it('writes a new revision per save: an omitted attribute is unchanged, styles replace the tree', async () => {
    const set = await createSet({ name: 'Edit', styles: { shape: { radius: 4 } } });

    const renamed = expectStatus(
      await call('PATCH', `/theme-sets/${set.id}`, body({ name: 'Edited' })),
      200,
    );
    expect(renamed.data.attributes).toMatchObject({
      name: 'Edited',
      revision: 2,
      styles: { shape: { radius: 4 } },
    });
    const restyled = expectStatus(
      await call(
        'PATCH',
        `/theme-sets/${set.id}`,
        body({ styles: { light: { palette: { primary: '#2563eb' } } } }),
      ),
      200,
    );
    expect(restyled.data.attributes).toMatchObject({
      name: 'Edited',
      revision: 3,
      styles: { light: { palette: { primary: '#2563eb' } } },
    });
    expect(
      api.audit
        .withAction('theme-set.updated')
        .filter((entry) => entry.resourceId === set.id)
        .map((entry) => entry.metadata),
    ).toEqual([{ revision: 2 }, { revision: 3 }]);
  });

  it('refuses a failing palette and keeps the revision it had', async () => {
    const set = await createSet({ name: 'Keep' });
    const response = await call(
      'PATCH',
      `/theme-sets/${set.id}`,
      body({ styles: { light: { palette: { 'on-primary': '#1447e6' } } } }),
    );
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json()).toMatchObject({ code: 'theme_contrast_insufficient' });

    const read = expectStatus(await call('GET', `/theme-sets/${set.id}`), 200);
    expect(read.data.attributes).toMatchObject({ revision: 1, styles: {} });
  });

  it('refuses a change to an archived set', async () => {
    const set = await createSet({ name: 'Gone' });
    expectStatus(await call('DELETE', `/theme-sets/${set.id}`), 200);
    const response = await call('PATCH', `/theme-sets/${set.id}`, body({ name: 'Back' }));
    expect(response.statusCode, response.body).toBe(422);
  });
});

describe('revisions and restore (C160.5)', () => {
  it('lists every save newest first, paged by page[before], each naming its creator', async () => {
    const set = await createSet({ name: 'R1' });
    for (const name of ['R2', 'R3', 'R4']) {
      expectStatus(await call('PATCH', `/theme-sets/${set.id}`, body({ name })), 200);
    }

    const first = expectStatus(
      await call('GET', `/theme-sets/${set.id}/revisions?page[size]=3`),
      200,
    ) as unknown as {
      data: { id: string; attributes: Record<string, unknown> }[];
      links: { next: string | null };
    };
    expect(first.data.map(({ attributes }) => attributes.revision)).toEqual([4, 3, 2]);
    expect(first.data[0]).toMatchObject({
      type: 'theme-set-revision',
      id: `${set.id}:4`,
      attributes: { name: 'R4', creator: { type: 'api-key' }, 'restored-from': null },
    });
    expect(first.links.next).toBe(
      `/api/v1/theme-sets/${set.id}/revisions?page[before]=2&page[size]=3`,
    );
    const rest = expectStatus(
      await call('GET', `/theme-sets/${set.id}/revisions?page[before]=2&page[size]=3`),
      200,
    ) as unknown as {
      data: { attributes: Record<string, unknown> }[];
      links: { next: string | null };
    };
    expect(rest.data.map(({ attributes }) => attributes.revision)).toEqual([1]);
    expect(rest.links.next).toBeNull();
  });

  it('restores an earlier revision as a new one, audited with both numbers', async () => {
    const set = await createSet({ name: 'Old', styles: { shape: { radius: 2 } } });
    expectStatus(
      await call(
        'PATCH',
        `/theme-sets/${set.id}`,
        body({ name: 'New', styles: { shape: { radius: 12 } } }),
      ),
      200,
    );

    const restored = expectStatus(
      await call('POST', `/theme-sets/${set.id}/restore`, { meta: { revision: 1 } }),
      200,
    );
    expect(restored.data.attributes).toMatchObject({
      name: 'Old',
      revision: 3,
      styles: { shape: { radius: 2 } },
    });
    const revisions = (await call('GET', `/theme-sets/${set.id}/revisions`)).json<{
      data: { attributes: Record<string, unknown> }[];
    }>();
    expect(revisions.data[0]?.attributes).toMatchObject({ revision: 3, 'restored-from': 1 });
    expect(
      api.audit.withAction('theme-set.restored').find((entry) => entry.resourceId === set.id)
        ?.metadata,
    ).toEqual({ revision: 3, 'restored-from': 1 });
  });

  it('refuses a revision the set does not have (422 at /meta/revision)', async () => {
    const set = await createSet({ name: 'Short' });
    const response = await call('POST', `/theme-sets/${set.id}/restore`, { meta: { revision: 7 } });
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json()).toMatchObject({ errors: [{ pointer: '/meta/revision' }] });
  });
});

describe('DELETE /theme-sets/:id archives (C160.7)', () => {
  it('archives and detaches, audited; a second archive answers the same set', async () => {
    const set = await createSet({ name: 'Archive me' });
    const archived = expectStatus(await call('DELETE', `/theme-sets/${set.id}`), 200);
    expect(archived.data.attributes).toMatchObject({ status: 'archived', 'is-default': false });
    expect(archived.data.attributes['archived-at']).not.toBeNull();
    expect(
      api.audit.withAction('theme-set.archived').some((entry) => entry.resourceId === set.id),
    ).toBe(true);

    const again = expectStatus(await call('DELETE', `/theme-sets/${set.id}`), 200);
    expect(again.data.attributes['archived-at']).toBe(archived.data.attributes['archived-at']);
  });

  it('refuses to archive the environment’s default with 409 theme_set_default', async () => {
    const tenant = await api.newTenant();
    const set = await createSet({ name: 'Default' }, tenant.token);
    await setDefault(tenant.environmentId, set.id);

    const response = await call('DELETE', `/theme-sets/${set.id}`, undefined, tenant.token);
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json()).toMatchObject({ code: 'theme_set_default' });
  });
});
