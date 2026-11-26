// @vitest-environment node
import type { Permission } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEMPLATE_FORMS_COPY } from '../../../../lib/copy/template-forms';
import { SESSION_COOKIE } from '../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../../testing/api-routes';
import { fakeRequest } from '../../../../testing/fake-request';
import {
  LIFECYCLE_IDS as IDS,
  RESOLVED_SETTINGS,
  draft,
  single,
} from '../../../../testing/lifecycle-fixtures';
import { saveTemplateMember } from './actions';

vi.mock('next/headers', () =>
  import('../../../../testing/fake-request').then((m) => m.nextHeaders),
);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const ETAG = '"1111111111111111111111111111111111111111111111111111111111111111"';
const NEXT_ETAG = '"2222222222222222222222222222222222222222222222222222222222222222"';
const VERSION_PATH = `/inquiry-template-versions/${IDS.draft}`;
let api: RouteApi;

beforeEach(() => {
  vi.mocked(revalidatePath).mockReset();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  as('inquiry-templates:read', 'inquiry-templates:write');
});

afterEach(() => {
  api.restore();
});

function as(...permissions: Permission[]) {
  api.me({ permissions });
}

const form = (member: string, value: unknown, extra: Record<string, string> = {}) => {
  const data = new FormData();
  data.set('inquiry-template-id', IDS.template);
  data.set('version-id', IDS.draft);
  data.set('etag', ETAG);
  data.set('member', member);
  data.set('value', typeof value === 'string' ? value : JSON.stringify(value));
  for (const [name, each] of Object.entries(extra)) data.set(name, each);
  return data;
};

describe('saveTemplateMember (C153.3, C154.2, C154.3)', () => {
  it('saves the member to the draft with If-Match and allow-invalid, then refreshes the tab', async () => {
    api.on('PATCH', VERSION_PATH, 200, single(draft()), { etag: NEXT_ETAG });
    const settings = { ...RESOLVED_SETTINGS, 'max-sessions': 5 };

    await expect(saveTemplateMember(null, form('settings', settings))).resolves.toEqual({
      ok: true,
      data: undefined,
    });

    const sent = api.find('PATCH', VERSION_PATH);
    expect(sent?.headers.get('if-match')).toBe(ETAG);
    expect(sent?.body).toEqual({
      data: { type: 'inquiry-template-version', attributes: { settings } },
      meta: { 'allow-invalid': true },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/templates/${IDS.template}/settings`);
  });

  it('sends the links as attributes of their own', async () => {
    api.on('PATCH', VERSION_PATH, 200, single(draft()), { etag: NEXT_ETAG });

    await saveTemplateMember(
      null,
      form('links', { 'help-url': null, 'redirect-include-status': true }),
    );

    expect(api.find('PATCH', VERSION_PATH)?.body).toMatchObject({
      data: { attributes: { 'help-url': null, 'redirect-include-status': true } },
    });
  });

  it('saves the verification checks as the whole verification-config', async () => {
    api.on('PATCH', VERSION_PATH, 200, single(draft()), { etag: NEXT_ETAG });
    const config = {
      selfie: { checks: { selfie_liveness_detection: { enabled: true, required: true } } },
    };

    await expect(saveTemplateMember(null, form('verification-config', config))).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(api.find('PATCH', VERSION_PATH)?.body).toMatchObject({
      data: { attributes: { 'verification-config': config } },
    });
  });

  it('refuses what the contract refuses at its pointer, before calling the API', async () => {
    const result = await saveTemplateMember(null, form('settings', { 'max-sessions': 0 }));

    expect(result).toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/data/attributes/settings/max-sessions' }] },
    });
    expect(api.find('PATCH', VERSION_PATH)).toBeUndefined();
  });

  it('refuses a member the forms do not hold, and a value that is not JSON', async () => {
    await expect(saveTemplateMember(null, form('flow', {}))).resolves.toMatchObject({ ok: false });
    await expect(saveTemplateMember(null, form('settings', '{'))).resolves.toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/data/attributes/settings' }] },
    });
    expect(api.find('PATCH', VERSION_PATH)).toBeUndefined();
  });

  it('says the draft changed when the API answers 412, and saves nothing', async () => {
    api.onProblem('PATCH', VERSION_PATH, 412, undefined, { code: 'precondition_failed' });

    await expect(saveTemplateMember(null, form('settings', {}))).resolves.toEqual({
      ok: false,
      problem: expect.objectContaining({
        title: TEMPLATE_FORMS_COPY.memberForm.stale,
        code: 'precondition_failed',
      }) as unknown,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('needs inquiry-templates:write', async () => {
    as('inquiry-templates:read');

    await expect(saveTemplateMember(null, form('settings', {}))).resolves.toMatchObject({
      ok: false,
      problem: { title: 'You do not have access' },
    });
  });
});
