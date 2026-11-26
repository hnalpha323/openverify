// @vitest-environment node
import type { Permission } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { redirectTarget } from '../../testing/next-errors';
import {
  REPORT_CONFIG_IDS as IDS,
  reportDraft,
  reportTemplate,
  reportTemplateVersion,
  single,
} from '../../testing/report-config-fixtures';
import { CONFIG_EDITOR } from '../../testing/routes/report-config';
import {
  createReportDraft,
  publishReportDraft,
  updateReportDraft,
  updateReportTemplateStatus,
} from './actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const TEMPLATE_PAGE = `/report-templates/${IDS.template}`;
const DRAFT_PAGE = `${TEMPLATE_PAGE}/versions/${IDS.draft}`;
const PUBLISH = `/report-template-versions/${IDS.draft}/publish`;
let api: RouteApi;

beforeEach(() => {
  vi.mocked(revalidatePath).mockReset();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  as(...CONFIG_EDITOR);
  api.on(
    'GET',
    `/report-templates/${IDS.template}`,
    200,
    single(
      reportTemplate({
        config: { 'search-lists': ['openverify-sandbox'], 'pause-on-match': true },
      }),
    ),
  );
  api.on('POST', '/report-template-versions', 201, single(reportDraft()));
  api.on('GET', `/report-template-versions/${IDS.draft}`, 200, single(reportDraft()));
  api.on('PATCH', `/report-template-versions/${IDS.draft}`, 200, single(reportDraft()));
  api.on('POST', PUBLISH, 200, single(reportTemplateVersion({ id: IDS.draft, versionNumber: 2 })));
  api.on('PATCH', `/report-templates/${IDS.template}`, 200, single(reportTemplate()));
});

afterEach(() => {
  api.restore();
});

function as(...permissions: Permission[]) {
  api.me({ permissions });
}

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
};

const ids = { 'report-template-id': IDS.template, 'version-id': IDS.draft };

describe('createReportDraft (C71.1)', () => {
  it('drafts what the current version sets as a new version and opens its editor', async () => {
    await expect(
      redirectTarget(createReportDraft(null, form({ 'report-template-id': IDS.template }))),
    ).resolves.toBe(DRAFT_PAGE);

    expect(api.find('POST', '/report-template-versions')?.body).toEqual({
      data: {
        type: 'report-template-version',
        attributes: {
          'report-template-id': IDS.template,
          config: { 'search-lists': ['openverify-sandbox'], 'pause-on-match': true },
        },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith(TEMPLATE_PAGE);
  });

  it('refuses without report-templates:write, without calling the API', async () => {
    as('report-templates:read');

    const result = await createReportDraft(null, form({ 'report-template-id': IDS.template }));

    expect(result).toMatchObject({ ok: false, problem: { title: 'You do not have access' } });
    expect(api.find('POST', '/report-template-versions')).toBeUndefined();
  });

  it('refuses a malformed template id at its field', async () => {
    const result = await createReportDraft(null, form({ 'report-template-id': 'rptp_x' }));

    expect(result).toMatchObject({
      ok: false,
      problem: { errors: [expect.objectContaining({ pointer: '/report-template-id' })] },
    });
  });
});

describe('updateReportDraft (C71.1, C71.2)', () => {
  it('saves the configuration typed as JSON and refreshes the version page', async () => {
    const result = await updateReportDraft(
      null,
      form({ ...ids, config: '{ "max-list-age-hours": 24, "search-lists": [] }' }),
    );

    expect(result).toEqual({ ok: true, data: undefined });
    expect(api.find('PATCH', `/report-template-versions/${IDS.draft}`)?.body).toEqual({
      data: {
        type: 'report-template-version',
        attributes: { config: { 'max-list-age-hours': 24, 'search-lists': [] } },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith(DRAFT_PAGE);
  });

  it('refuses text that is not JSON at the configuration, without calling the API', async () => {
    const result = await updateReportDraft(null, form({ ...ids, config: '{ "a": ' }));

    expect(result).toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/data/attributes/config', detail: 'is not valid JSON' }] },
    });
    expect(api.find('PATCH', `/report-template-versions/${IDS.draft}`)).toBeUndefined();
  });

  it('refuses a configuration that is not an object at the configuration', async () => {
    const result = await updateReportDraft(null, form({ ...ids, config: '["ofac-sdn"]' }));

    expect(result).toMatchObject({
      ok: false,
      problem: { errors: [expect.objectContaining({ pointer: '/data/attributes/config' })] },
    });
    expect(api.find('PATCH', `/report-template-versions/${IDS.draft}`)).toBeUndefined();
  });

  it('passes the API’s 422 pointers on, so the editor shows each at its place', async () => {
    api.onProblem('PATCH', `/report-template-versions/${IDS.draft}`, 422, undefined, {
      errors: [
        {
          location: 'body',
          pointer: '/data/attributes/config/max-list-age-hours',
          detail: 'Too small: expected number to be >=1',
        },
      ],
    });

    const result = await updateReportDraft(
      null,
      form({ ...ids, config: '{ "max-list-age-hours": 0 }' }),
    );

    expect(result).toMatchObject({
      ok: false,
      problem: {
        status: 422,
        errors: [
          {
            pointer: '/data/attributes/config/max-list-age-hours',
            detail: 'Too small: expected number to be >=1',
          },
        ],
      },
    });
  });

  it('refuses without report-templates:write', async () => {
    as('report-templates:read', 'report-templates:publish');

    const result = await updateReportDraft(null, form({ ...ids, config: '{}' }));

    expect(result).toMatchObject({ ok: false, problem: { title: 'You do not have access' } });
  });
});

describe('publishReportDraft (C71.1, C71.2, C72.4)', () => {
  it('publishes the saved draft and refreshes the template and version pages', async () => {
    const result = await publishReportDraft(null, form(ids));

    expect(result).toEqual({ ok: true, data: undefined });
    expect(api.find('POST', PUBLISH)).toBeDefined();
    expect(revalidatePath).toHaveBeenCalledWith(TEMPLATE_PAGE);
    expect(revalidatePath).toHaveBeenCalledWith(DRAFT_PAGE);
  });

  it('says in words that an empty list is never published', async () => {
    api.onProblem('POST', PUBLISH, 422, undefined, {
      code: 'watchlist_sources_empty',
      errors: [
        {
          location: 'body',
          pointer: '/data/attributes/config/search-lists',
          detail: 'must select at least one enabled source',
        },
      ],
    });

    const result = await publishReportDraft(null, form(ids));

    expect(result).toMatchObject({
      ok: false,
      problem: {
        title: 'The draft selects no list',
        status: 422,
        requestId: 'req-synthetic-0001',
        errors: [
          {
            pointer: '/data/attributes/config/search-lists',
            detail: 'Lists searched: must select at least one enabled source',
          },
        ],
      },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('names a refused source by the id the saved draft holds at that place', async () => {
    api.onProblem('POST', PUBLISH, 422, undefined, {
      code: 'watchlist_source_not_allowed',
      errors: [
        {
          location: 'body',
          pointer: '/data/attributes/config/search-lists/0',
          detail: 'is a sandbox-only list',
        },
      ],
    });

    const result = await publishReportDraft(null, form(ids));

    expect(result).toMatchObject({
      ok: false,
      problem: {
        title: 'The draft selects a source it may not screen here',
        errors: [
          {
            pointer: '/data/attributes/config/search-lists/0',
            detail: 'Lists searched, item 1 (openverify-sandbox): is a sandbox-only list',
          },
        ],
      },
    });
  });

  it('still words the problem when the saved draft cannot be read back', async () => {
    api.onProblem('POST', PUBLISH, 422, undefined, {
      code: 'watchlist_source_unknown',
      errors: [
        {
          location: 'body',
          pointer: '/data/attributes/config/search-lists/0',
          detail: 'is not a source of the manifest',
        },
      ],
    });
    api.onProblem('GET', `/report-template-versions/${IDS.draft}`, 404);

    const result = await publishReportDraft(null, form(ids));

    expect(result).toMatchObject({
      ok: false,
      problem: {
        title: 'The draft selects a source the manifest does not know',
        errors: [{ detail: 'Lists searched, item 1: is not a source of the manifest' }],
      },
    });
  });

  it('says a version that is no longer a draft cannot be published', async () => {
    api.onProblem('POST', PUBLISH, 409, 'invalid-transition');

    const result = await publishReportDraft(null, form(ids));

    expect(result).toMatchObject({
      ok: false,
      problem: { title: 'This version is no longer a draft', status: 409 },
    });
  });

  it('keeps the API’s words for any other refusal', async () => {
    api.onProblem('POST', PUBLISH, 403, 'forbidden');

    const result = await publishReportDraft(null, form(ids));

    expect(result).toMatchObject({ ok: false, problem: { title: 'Synthetic forbidden' } });
  });

  it('refuses without report-templates:publish, without calling the API', async () => {
    as('report-templates:read', 'report-templates:write');

    const result = await publishReportDraft(null, form(ids));

    expect(result).toMatchObject({ ok: false, problem: { title: 'You do not have access' } });
    expect(api.find('POST', PUBLISH)).toBeUndefined();
  });
});

describe('updateReportTemplateStatus (C71.1)', () => {
  it('archives a template', async () => {
    const result = await updateReportTemplateStatus(
      null,
      form({ 'report-template-id': IDS.template, status: 'archived' }),
    );

    expect(result).toEqual({ ok: true, data: undefined });
    expect(api.find('PATCH', `/report-templates/${IDS.template}`)?.body).toEqual({
      data: { type: 'report-template', attributes: { status: 'archived' } },
    });
    expect(revalidatePath).toHaveBeenCalledWith(TEMPLATE_PAGE);
  });

  it('refuses a status the API does not know at its field', async () => {
    const result = await updateReportTemplateStatus(
      null,
      form({ 'report-template-id': IDS.template, status: 'deleted' }),
    );

    expect(result).toMatchObject({
      ok: false,
      problem: { errors: [expect.objectContaining({ pointer: '/data/attributes/status' })] },
    });
    expect(api.find('PATCH', `/report-templates/${IDS.template}`)).toBeUndefined();
  });
});
