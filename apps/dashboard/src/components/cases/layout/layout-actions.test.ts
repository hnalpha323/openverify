// @vitest-environment node
/**
 * C172.1, C172.2, C172.4: the layout and the checklists and preset comments are each saved alone,
 * naming only their own members in the draft's PATCH; a malformed document never reaches the API.
 */
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { CASE_IDS, caseTemplateVersion } from '../../../testing/cases-fixtures';
import { fakeRequest } from '../../../testing/fake-request';
import { saveCaseVersionChecklists, saveCaseVersionLayout } from './layout-actions';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const VERSION = `/case-template-versions/${CASE_IDS.draft}`;
let api: RouteApi;

beforeEach(() => {
  vi.mocked(revalidatePath).mockReset();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: ['case-templates:read', 'case-templates:write'] });
  api.on('PATCH', VERSION, 200, { data: caseTemplateVersion({ status: 'draft' }) });
});

afterEach(() => {
  api.restore();
});

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  data.set('case-template-id', CASE_IDS.template);
  data.set('version-id', CASE_IDS.draft);
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
const LAYOUT = {
  columns: 1,
  modules: [{ key: 'comments', column: 1, order: 0, collapsed: false }],
};

describe('saveCaseVersionLayout', () => {
  it('patches the layout alone and refreshes the version page', async () => {
    const result = await saveCaseVersionLayout(null, form({ layout: JSON.stringify(LAYOUT) }));

    expect(result).toEqual({ ok: true, data: undefined });
    expect(api.find('PATCH', VERSION)?.body).toEqual({
      data: { type: 'case-template-version', attributes: { layout: LAYOUT } },
    });
    expect(revalidatePath).toHaveBeenCalledWith(
      `/case-templates/${CASE_IDS.template}/versions/${CASE_IDS.draft}`,
    );
  });

  it('patches null for the default layout', async () => {
    await saveCaseVersionLayout(null, form({ layout: 'null' }));

    expect(api.find('PATCH', VERSION)?.body).toMatchObject({
      data: { attributes: { layout: null } },
    });
  });

  it('refuses a layout the contract refuses without calling the API', async () => {
    const result = await saveCaseVersionLayout(
      null,
      form({ layout: JSON.stringify({ columns: 4, modules: [] }) }),
    );

    expect(result.ok).toBe(false);
    expect(api.find('PATCH', VERSION)).toBeUndefined();
  });
});

describe('saveCaseVersionChecklists', () => {
  const CHECKLISTS = [
    {
      key: 'kyc',
      label: 'Identity review',
      items: [{ key: 'id-seen', label: 'Document seen', 'required-for-statuses': ['closed'] }],
    },
  ];
  const PRESETS = [{ key: 'docs', label: 'Asked for documents', text: 'We asked for a document.' }];

  it('patches the checklists and the preset comments alone', async () => {
    const result = await saveCaseVersionChecklists(
      null,
      form({ checklists: JSON.stringify(CHECKLISTS), 'preset-comments': JSON.stringify(PRESETS) }),
    );

    expect(result).toEqual({ ok: true, data: undefined });
    expect(api.find('PATCH', VERSION)?.body).toEqual({
      data: {
        type: 'case-template-version',
        attributes: { checklists: CHECKLISTS, 'preset-comments': PRESETS },
      },
    });
  });

  it('says which document is not JSON, at its pointer, without calling the API', async () => {
    const result = await saveCaseVersionChecklists(
      null,
      form({ checklists: '[{', 'preset-comments': '[]' }),
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.problem.errors?.[0]?.pointer).toBe('/data/attributes/checklists');
    expect(api.find('PATCH', VERSION)).toBeUndefined();
  });

  it('refuses a preset comment holding a placeholder before the API sees it', async () => {
    const result = await saveCaseVersionChecklists(
      null,
      form({
        checklists: '[]',
        'preset-comments': JSON.stringify([{ key: 'x', label: 'X', text: 'Hello {name}' }]),
      }),
    );

    expect(result.ok).toBe(false);
    expect(api.find('PATCH', VERSION)).toBeUndefined();
  });
});
