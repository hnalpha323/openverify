// @vitest-environment node
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SIGNAL_PROBLEM_WORDS } from '../../lib/version-problem-words';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import {
  LIFECYCLE_IDS as IDS,
  RESOLVED_SETTINGS,
  VERSION_CONTENT,
  draft,
  single,
} from '../../testing/lifecycle-fixtures';
import { SIGNAL_IDS } from '../../testing/signals-fixtures';
import { publishVersion, updateDraftVersion } from './actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const PATCH = `/inquiry-template-versions/${IDS.draft}`;
const PUBLISH = `${PATCH}/publish`;
let api: RouteApi;

beforeEach(() => {
  vi.mocked(revalidatePath).mockReset();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({
    permissions: ['inquiry-templates:read', 'inquiry-templates:write', 'inquiry-templates:publish'],
  });
  api.on('PATCH', PATCH, 200, single(draft()));
});

afterEach(() => {
  api.restore();
});

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
};

const ids = { 'inquiry-template-id': IDS.template, 'version-id': IDS.draft };

describe('updateDraftVersion: signal-config and list-config (C90.6, C99.5)', () => {
  it('sends both documents with the draft', async () => {
    const result = await updateDraftVersion(
      null,
      form({
        ...ids,
        flow: JSON.stringify(VERSION_CONTENT.flow),
        'verification-config': JSON.stringify(VERSION_CONTENT['verification-config']),
        settings: JSON.stringify(RESOLVED_SETTINGS),
        'signal-config': '{ "on-signal": "needs_review" }',
        'list-config': JSON.stringify({ screen: [SIGNAL_IDS.list], 'on-list-match': 'none' }),
      }),
    );

    expect(result).toEqual({ ok: true, data: undefined });
    expect(api.find('PATCH', PATCH)?.body).toMatchObject({
      data: {
        attributes: {
          'signal-config': { 'on-signal': 'needs_review' },
          'list-config': { screen: [SIGNAL_IDS.list], 'on-list-match': 'none' },
        },
      },
    });
  });

  it('refuses a list-config the contract refuses, at its path', async () => {
    const result = await updateDraftVersion(
      null,
      form({
        ...ids,
        flow: JSON.stringify(VERSION_CONTENT.flow),
        'verification-config': JSON.stringify(VERSION_CONTENT['verification-config']),
        settings: JSON.stringify(RESOLVED_SETTINGS),
        'list-config': '{ "screen": "some" }',
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/data/attributes/list-config/screen' }] },
    });
    expect(api.find('PATCH', PATCH)).toBeUndefined();
  });
});

describe('publishVersion: refusals in words, on their document (C108)', () => {
  it.each([
    ['unknown_signal', '/data/attributes/signal-config/collect/0', 'Signal config, at /collect/0'],
    ['kind_not_collected', '/data/attributes/list-config/screen/0', 'List config, at /screen/0'],
    ['display_name_required', '/data/attributes/flow/steps/1', 'Flow, at /steps/1'],
  ] as const)('says %s', async (code, pointer, place) => {
    api.onProblem('POST', PUBLISH, 422, undefined, {
      code,
      errors: [{ pointer, detail: code }],
    });

    const result = await publishVersion(null, form(ids));

    expect(result).toMatchObject({
      ok: false,
      problem: {
        title: SIGNAL_PROBLEM_WORDS[code],
        errors: [{ pointer, detail: `${place}: ${SIGNAL_PROBLEM_WORDS[code]}` }],
      },
    });
  });
});
