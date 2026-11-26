// @vitest-environment node
import { migrateFlow } from '@openverify/flow-spec';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../../testing/api-routes';
import { fakeRequest } from '../../../../testing/fake-request';
import {
  LIFECYCLE_IDS as IDS,
  VERSION_CONTENT,
  draft,
} from '../../../../testing/lifecycle-fixtures';
import {
  serveDraftSaves,
  serveTemplateVersion,
  serveValidation,
  syntheticEtag,
  versionPath,
} from '../../../../testing/routes/flow-builder';
import { checkFlowPublish, publishFlowDraft, saveFlowDraft } from './actions';

vi.mock('next/headers', () =>
  import('../../../../testing/fake-request').then((m) => m.nextHeaders),
);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const ETAG = syntheticEtag('draft');
const flow = migrateFlow(VERSION_CONTENT.flow);

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
});

describe('the flow builder’s actions (C154.2, C154.3, C154.9, C155.6)', () => {
  it('saves the flow with If-Match and allow-invalid, answering the new ETag', async () => {
    api.me({ permissions: ['inquiry-templates:read', 'inquiry-templates:write'] });
    serveDraftSaves(api, draft(), ETAG);

    const result = await saveFlowDraft({ versionId: IDS.draft, flow, etag: ETAG });

    expect(result.ok && result.data.kind === 'saved' ? result.data.etag : null).not.toBe(ETAG);
    const sent = api.find('PATCH', versionPath(IDS.draft));
    expect(sent?.headers.get('if-match')).toBe(ETAG);
    expect(sent?.body).toEqual({
      data: { type: 'inquiry-template-version', attributes: { flow } },
      meta: { 'allow-invalid': true },
    });
  });

  it('saves the chosen theme set with the flow (C155.8, C160.7)', async () => {
    api.me({ permissions: ['inquiry-templates:read', 'inquiry-templates:write'] });
    serveDraftSaves(api, draft(), ETAG);

    await saveFlowDraft({
      versionId: IDS.draft,
      flow,
      etag: ETAG,
      themeSetId: 'theset_01JB0000000000000000000001',
    });

    expect(api.find('PATCH', versionPath(IDS.draft))?.body).toMatchObject({
      data: { attributes: { flow, 'theme-set-id': 'theset_01JB0000000000000000000001' } },
    });
  });

  it('answers a 412 with the latest draft migrated and its ETag, to reload', async () => {
    api.me({ permissions: ['inquiry-templates:read', 'inquiry-templates:write'] });
    serveDraftSaves(api, draft(), syntheticEtag('someone-else'));
    serveTemplateVersion(api, draft(), syntheticEtag('someone-else'));

    const result = await saveFlowDraft({ versionId: IDS.draft, flow, etag: ETAG });

    expect(result).toEqual({
      ok: true,
      data: { kind: 'conflict', latest: { flow, etag: syntheticEtag('someone-else') } },
    });
  });

  it('refuses a flow the format refuses, and a save without inquiry-templates:write', async () => {
    api.me({ permissions: ['inquiry-templates:read', 'inquiry-templates:write'] });
    const refused = await saveFlowDraft({ versionId: IDS.draft, flow: { steps: [] }, etag: ETAG });
    expect(refused.ok).toBe(false);

    api.me({ permissions: ['inquiry-templates:read'] });
    const forbidden = await saveFlowDraft({ versionId: IDS.draft, flow, etag: ETAG });
    expect(forbidden.ok).toBe(false);
    expect(api.all('PATCH', versionPath(IDS.draft))).toEqual([]);
  });

  it('checks a publish: every problem and every acknowledgement the API asks for', async () => {
    api.me({ permissions: ['inquiry-templates:read'] });
    serveValidation(api, IDS.draft, [], ['fallback:s_govid000']);

    const result = await checkFlowPublish({ versionId: IDS.draft });

    expect(result).toEqual({
      ok: true,
      data: { problems: [], acknowledgements: ['fallback:s_govid000'] },
    });
    expect(api.find('POST', `${versionPath(IDS.draft)}/validate`)?.body).toEqual({
      meta: { mode: 'publish' },
    });
  });

  it('publishes with If-Match, the acknowledgements and the note, under inquiry-templates:publish', async () => {
    api.me({ permissions: ['inquiry-templates:read', 'inquiry-templates:publish'] });
    api.handle('POST', `${versionPath(IDS.draft)}/publish`, () => ({
      status: 200,
      body: {
        data: {
          ...draft(),
          attributes: {
            ...draft().attributes,
            status: 'published',
            'published-at': '2026-10-21T04:35:00.000Z',
          },
        },
      },
      headers: { etag: syntheticEtag('published') },
    }));

    const result = await publishFlowDraft({
      versionId: IDS.draft,
      etag: ETAG,
      acknowledgements: ['fallback:s_govid000'],
      note: '',
    });

    expect(result).toEqual({ ok: true, data: { etag: syntheticEtag('published') } });
    const sent = api.find('POST', `${versionPath(IDS.draft)}/publish`);
    expect(sent?.headers.get('if-match')).toBe(ETAG);
    expect(sent?.body).toEqual({ meta: { acknowledgements: ['fallback:s_govid000'] } });
  });

  it('revalidates nothing, so the builder stays mounted with its Published status (Workflow 9C)', async () => {
    const { revalidatePath } = await import('next/cache');
    vi.mocked(revalidatePath).mockClear();
    api.me({ permissions: ['inquiry-templates:read', 'inquiry-templates:publish'] });
    api.handle('POST', `${versionPath(IDS.draft)}/publish`, () => ({
      status: 200,
      body: {
        data: {
          ...draft(),
          attributes: {
            ...draft().attributes,
            status: 'published',
            'published-at': '2026-10-21T04:35:00.000Z',
          },
        },
      },
      headers: { etag: syntheticEtag('published') },
    }));

    const result = await publishFlowDraft({
      versionId: IDS.draft,
      etag: ETAG,
      acknowledgements: [],
      note: '',
    });

    // A revalidation in a server action sends the current route again with the answer, and the
    // flow page of a template without a draft has no builder: the status that says Published
    // would be unmounted before it is read. Every console page renders per request (C170.1), so
    // the template pages read the published version on the next navigation.
    expect(result.ok).toBe(true);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
