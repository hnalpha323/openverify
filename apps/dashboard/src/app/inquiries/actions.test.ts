// @vitest-environment node
import type { Permission } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { LIFECYCLE_IDS as IDS, inquiry, session, single } from '../../testing/lifecycle-fixtures';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { fakeRequest } from '../../testing/fake-request';
import { redirectTarget } from '../../testing/next-errors';
import {
  addInquiryTag,
  expireAllInquirySessions,
  expireInquirySession,
  generateOneTimeLink,
  redactInquiry,
  removeInquiryTag,
  reopenInquiry,
  setInquiryTags,
  simulateInquiry,
  transitionInquiry,
  updateInquiryFields,
  updateInquiryNote,
} from './actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  vi.mocked(revalidatePath).mockReset();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
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

const as = (...permissions: Permission[]) => api.me({ permissions });

describe('transitionInquiry', () => {
  it.each([
    ['approve', 'approve'],
    ['decline', 'decline'],
    ['mark-for-review', 'mark-for-review'],
    ['expire', 'expire'],
  ])('runs %s through the server API and refreshes the inquiry page', async (action, path) => {
    as('inquiries:read', 'inquiries:write');
    api.on('POST', `/inquiries/${IDS.inquiry}/${path}`, 200, single(inquiry()));

    const result = await transitionInquiry(null, form({ 'inquiry-id': IDS.inquiry, action }));

    expect(result).toEqual({ ok: true, data: undefined });
    const request = api.find('POST', `/inquiries/${IDS.inquiry}/${path}`);
    expect(request?.headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/inquiries/${IDS.inquiry}`);
  });

  it('refuses without inquiries:write, without calling the API', async () => {
    as('inquiries:read');

    await expect(
      transitionInquiry(null, form({ 'inquiry-id': IDS.inquiry, action: 'approve' })),
    ).resolves.toMatchObject({ ok: false, problem: { title: 'You do not have access' } });
    expect(api.requests).toHaveLength(1);
  });

  it('refuses an unknown action or a malformed inquiry id', async () => {
    as('inquiries:read', 'inquiries:write');

    await expect(
      transitionInquiry(null, form({ 'inquiry-id': 'inq_x', action: 'delete' })),
    ).resolves.toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/inquiry-id' }, { pointer: '/action' }] },
    });
    expect(api.requests).toHaveLength(1);
  });

  it("shows the API's refusal of a transition the state machine does not allow", async () => {
    as('inquiries:read', 'inquiries:write');
    api.onProblem('POST', `/inquiries/${IDS.inquiry}/approve`, 409, 'invalid-transition');

    await expect(
      transitionInquiry(null, form({ 'inquiry-id': IDS.inquiry, action: 'approve' })),
    ).resolves.toEqual({
      ok: false,
      problem: {
        title: 'Synthetic invalid-transition',
        detail: 'Synthetic detail for 409.',
        status: 409,
        requestId: 'req-synthetic-0001',
      },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('sends a signed-out operator to sign in', async () => {
    as('inquiries:read', 'inquiries:write');
    api.onProblem('POST', `/inquiries/${IDS.inquiry}/expire`, 401);

    await expect(
      redirectTarget(
        transitionInquiry(null, form({ 'inquiry-id': IDS.inquiry, action: 'expire' })),
      ),
    ).resolves.toBe('/login');
  });
});

describe('redactInquiry', () => {
  it('redacts once the operator typed the confirmation', async () => {
    as('inquiries:read', 'inquiries:redact');
    api.on(
      'POST',
      `/inquiries/${IDS.inquiry}/redact`,
      200,
      single(inquiry({ 'redacted-at': '2026-10-20T05:00:00.000Z', fields: {}, note: null })),
    );

    await expect(
      redactInquiry(null, form({ 'inquiry-id': IDS.inquiry, confirmation: 'redact' })),
    ).resolves.toEqual({ ok: true, data: undefined });
    expect(api.find('POST', `/inquiries/${IDS.inquiry}/redact`)).toBeDefined();
    expect(revalidatePath).toHaveBeenCalledWith(`/inquiries/${IDS.inquiry}`);
  });

  it('refuses without the typed confirmation, without calling the API', async () => {
    as('inquiries:read', 'inquiries:redact');

    await expect(
      redactInquiry(null, form({ 'inquiry-id': IDS.inquiry, confirmation: 'yes' })),
    ).resolves.toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/confirmation', detail: 'Type redact to confirm.' }] },
    });
    expect(api.find('POST', `/inquiries/${IDS.inquiry}/redact`)).toBeUndefined();
  });

  it('refuses without inquiries:redact', async () => {
    as('inquiries:read', 'inquiries:write');

    await expect(
      redactInquiry(null, form({ 'inquiry-id': IDS.inquiry, confirmation: 'redact' })),
    ).resolves.toMatchObject({ ok: false, problem: { title: 'You do not have access' } });
    expect(api.requests).toHaveLength(1);
  });
});

const LINK = `https://flow.example.test/#inquiry-id=${IDS.inquiry}&one-time-token=ovo_${'T'.repeat(43)}`;

describe('tag actions', () => {
  beforeEach(() => {
    as('inquiries:read', 'inquiries:write');
    for (const action of ['add-tag', 'remove-tag', 'set-tags']) {
      api.on('POST', `/inquiries/${IDS.inquiry}/${action}`, 200, single(inquiry()));
    }
  });

  it('adds one tag', async () => {
    await expect(
      addInquiryTag(null, form({ 'inquiry-id': IDS.inquiry, 'tag-name': ' manual review ' })),
    ).resolves.toEqual({ ok: true, data: undefined });
    expect(api.find('POST', `/inquiries/${IDS.inquiry}/add-tag`)?.body).toEqual({
      meta: { 'tag-name': 'manual review' },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/inquiries/${IDS.inquiry}`);
  });

  it('refuses a tag the contract refuses, with the field error', async () => {
    await expect(
      addInquiryTag(null, form({ 'inquiry-id': IDS.inquiry, 'tag-name': '<b>' })),
    ).resolves.toMatchObject({ ok: false, problem: { errors: [{ pointer: '/meta/tag-name' }] } });
    expect(api.find('POST', `/inquiries/${IDS.inquiry}/add-tag`)).toBeUndefined();
  });

  it('removes one tag', async () => {
    await removeInquiryTag(null, form({ 'inquiry-id': IDS.inquiry, 'tag-name': 'vip' }));

    expect(api.find('POST', `/inquiries/${IDS.inquiry}/remove-tag`)?.body).toEqual({
      meta: { 'tag-name': 'vip' },
    });
  });

  it('replaces every tag with the lines of the list, blank lines left out', async () => {
    await setInquiryTags(
      null,
      form({
        'inquiry-id': IDS.inquiry,
        'tag-names': 'vip\n\n  manual review \nfraud:suspected\n',
      }),
    );

    expect(api.find('POST', `/inquiries/${IDS.inquiry}/set-tags`)?.body).toEqual({
      meta: { 'tag-names': ['vip', 'manual review', 'fraud:suspected'] },
    });
  });

  it('clears every tag with an empty list', async () => {
    await setInquiryTags(null, form({ 'inquiry-id': IDS.inquiry, 'tag-names': '' }));

    expect(api.find('POST', `/inquiries/${IDS.inquiry}/set-tags`)?.body).toEqual({
      meta: { 'tag-names': [] },
    });
  });

  it('needs inquiries:write', async () => {
    as('inquiries:read');

    await expect(
      addInquiryTag(null, form({ 'inquiry-id': IDS.inquiry, 'tag-name': 'vip' })),
    ).resolves.toMatchObject({ ok: false, problem: { title: 'You do not have access' } });
  });
});

describe('updateInquiryNote', () => {
  beforeEach(() => {
    as('inquiries:read', 'inquiries:write', 'pii:view');
    api.on('PATCH', `/inquiries/${IDS.inquiry}`, 200, single(inquiry()));
  });

  it('saves the note as typed', async () => {
    await expect(
      updateInquiryNote(null, form({ 'inquiry-id': IDS.inquiry, note: 'Checked by phone.\n' })),
    ).resolves.toEqual({ ok: true, data: undefined });
    expect(api.find('PATCH', `/inquiries/${IDS.inquiry}`)?.body).toEqual({
      data: { type: 'inquiry', attributes: { note: 'Checked by phone.\n' } },
    });
  });

  it('clears the note when it is left empty', async () => {
    await updateInquiryNote(null, form({ 'inquiry-id': IDS.inquiry, note: '  ' }));

    expect(api.find('PATCH', `/inquiries/${IDS.inquiry}`)?.body).toEqual({
      data: { type: 'inquiry', attributes: { note: null } },
    });
  });

  it('refuses a note over 2,000 characters', async () => {
    await expect(
      updateInquiryNote(null, form({ 'inquiry-id': IDS.inquiry, note: 'x'.repeat(2001) })),
    ).resolves.toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/data/attributes/note' }] },
    });
  });

  it('needs pii:view, so a note nobody could read is never overwritten blind', async () => {
    as('inquiries:read', 'inquiries:write');

    await expect(
      updateInquiryNote(null, form({ 'inquiry-id': IDS.inquiry, note: 'x' })),
    ).resolves.toMatchObject({ ok: false, problem: { title: 'You do not have access' } });
  });
});

describe('updateInquiryFields', () => {
  beforeEach(() => {
    as('inquiries:read', 'inquiries:write', 'pii:view');
    api.on('PATCH', `/inquiries/${IDS.inquiry}`, 200, single(inquiry()));
  });

  it('merges the JSON object into the fields', async () => {
    await expect(
      updateInquiryFields(
        null,
        form({ 'inquiry-id': IDS.inquiry, fields: '{ "name_last": "Example", "age": null }' }),
      ),
    ).resolves.toEqual({ ok: true, data: undefined });
    expect(api.find('PATCH', `/inquiries/${IDS.inquiry}`)?.body).toEqual({
      data: { type: 'inquiry', attributes: { fields: { name_last: 'Example', age: null } } },
    });
  });

  it('refuses text that is not JSON', async () => {
    await expect(
      updateInquiryFields(null, form({ 'inquiry-id': IDS.inquiry, fields: '{ name: ' })),
    ).resolves.toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/data/attributes/fields', detail: 'is not valid JSON' }] },
    });
    expect(api.find('PATCH', `/inquiries/${IDS.inquiry}`)).toBeUndefined();
  });

  it('refuses field names and values the contract refuses, by path', async () => {
    await expect(
      updateInquiryFields(
        null,
        form({ 'inquiry-id': IDS.inquiry, fields: '{ "Name": "x", "nested": { "a": 1 } }' }),
      ),
    ).resolves.toMatchObject({ ok: false, problem: { title: 'Check the values you entered' } });
    expect(api.find('PATCH', `/inquiries/${IDS.inquiry}`)).toBeUndefined();
  });

  it("shows the API's 409 for an inquiry that is no longer open", async () => {
    api.onProblem('PATCH', `/inquiries/${IDS.inquiry}`, 409, 'invalid-transition');

    await expect(
      updateInquiryFields(null, form({ 'inquiry-id': IDS.inquiry, fields: '{}' })),
    ).resolves.toMatchObject({ ok: false, problem: { status: 409 } });
  });
});

describe('generateOneTimeLink', () => {
  beforeEach(() => {
    as('inquiries:read', 'inquiries:write');
    api.on('POST', `/inquiries/${IDS.inquiry}/generate-one-time-link`, 200, {
      data: inquiry({ status: 'created' }),
      meta: { 'one-time-link': LINK, 'expires-at': '2026-10-20T05:35:00.000Z' },
    });
  });

  it('returns the link once, for the dialog, with the template default lifetime', async () => {
    await expect(
      generateOneTimeLink(null, form({ 'inquiry-id': IDS.inquiry, 'expires-in-seconds': '' })),
    ).resolves.toEqual({
      ok: true,
      data: { link: LINK, expiresAt: '2026-10-20T05:35:00.000Z' },
    });
    expect(api.find('POST', `/inquiries/${IDS.inquiry}/generate-one-time-link`)?.body).toEqual({});
  });

  it('asks for the chosen lifetime', async () => {
    await generateOneTimeLink(
      null,
      form({ 'inquiry-id': IDS.inquiry, 'expires-in-seconds': '3600' }),
    );

    expect(api.find('POST', `/inquiries/${IDS.inquiry}/generate-one-time-link`)?.body).toEqual({
      meta: { 'expires-in-seconds': 3600 },
    });
  });

  it('refuses a lifetime outside 5 minutes to 30 days', async () => {
    await expect(
      generateOneTimeLink(null, form({ 'inquiry-id': IDS.inquiry, 'expires-in-seconds': '60' })),
    ).resolves.toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/meta/expires-in-seconds' }] },
    });
  });
});

describe('session actions', () => {
  beforeEach(() => {
    as('inquiries:read', 'inquiry-sessions:read', 'inquiry-sessions:write');
  });

  it('expires one session and refreshes the inquiry page', async () => {
    api.on(
      'POST',
      `/inquiry-sessions/${IDS.session}/expire`,
      200,
      single(session({ status: 'expired' })),
    );

    await expect(
      expireInquirySession(
        null,
        form({ 'inquiry-id': IDS.inquiry, 'inquiry-session-id': IDS.session }),
      ),
    ).resolves.toEqual({ ok: true, data: undefined });
    expect(revalidatePath).toHaveBeenCalledWith(`/inquiries/${IDS.inquiry}`);
  });

  it('expires every active session of the inquiry', async () => {
    api.on('POST', '/inquiry-sessions/expire-all', 200, { meta: { 'expired-count': 2 } });

    await expect(
      expireAllInquirySessions(null, form({ 'inquiry-id': IDS.inquiry })),
    ).resolves.toEqual({ ok: true, data: { expiredCount: 2 } });
    expect(api.find('POST', '/inquiry-sessions/expire-all')?.body).toEqual({
      meta: { 'inquiry-id': IDS.inquiry },
    });
  });

  it('needs inquiry-sessions:write', async () => {
    as('inquiries:read', 'inquiry-sessions:read');

    await expect(
      expireAllInquirySessions(null, form({ 'inquiry-id': IDS.inquiry })),
    ).resolves.toMatchObject({ ok: false, problem: { title: 'You do not have access' } });
  });
});

describe('simulateInquiry', () => {
  beforeEach(() => {
    as('inquiries:read', 'inquiries:write');
  });

  it('runs one sandbox simulate action', async () => {
    api.on(
      'POST',
      `/inquiries/${IDS.inquiry}/perform-simulate-actions`,
      200,
      single(inquiry({ status: 'pending' })),
    );

    await expect(
      simulateInquiry(null, form({ 'inquiry-id': IDS.inquiry, type: 'start_inquiry' })),
    ).resolves.toEqual({ ok: true, data: undefined });
    expect(api.find('POST', `/inquiries/${IDS.inquiry}/perform-simulate-actions`)?.body).toEqual({
      meta: { actions: [{ type: 'start_inquiry' }] },
    });
  });

  it('refuses an unknown simulate action', async () => {
    await expect(
      simulateInquiry(null, form({ 'inquiry-id': IDS.inquiry, type: 'delete_inquiry' })),
    ).resolves.toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/meta/actions/0/type' }] },
    });
  });

  it("shows production's sandbox-only refusal as a problem, not as missing access", async () => {
    api.onProblem(
      'POST',
      `/inquiries/${IDS.inquiry}/perform-simulate-actions`,
      403,
      'sandbox-only',
    );

    await expect(
      simulateInquiry(null, form({ 'inquiry-id': IDS.inquiry, type: 'start_inquiry' })),
    ).resolves.toMatchObject({
      ok: false,
      problem: { title: 'Synthetic sandbox-only', status: 403 },
    });
  });
});

describe('reopenInquiry (C128.6)', () => {
  const REOPEN = `/inquiries/${IDS.inquiry}/reopen`;

  it('reopens a declined inquiry with the comment as meta.comment and refreshes the page', async () => {
    as('inquiries:read', 'inquiries:write');
    api.on('POST', REOPEN, 200, single(inquiry({ status: 'needs_review' })));

    const result = await reopenInquiry(
      null,
      form({ 'inquiry-id': IDS.inquiry, comment: '  The person sent a new document.  ' }),
    );

    expect(result).toEqual({ ok: true, data: undefined });
    expect(api.find('POST', REOPEN)?.body).toEqual({
      meta: { comment: 'The person sent a new document.' },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/inquiries/${IDS.inquiry}`);
  });

  it('refuses without a comment, naming the field, without calling the API', async () => {
    as('inquiries:read', 'inquiries:write');

    const result = await reopenInquiry(null, form({ 'inquiry-id': IDS.inquiry, comment: ' ' }));

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.problem.errors?.map((error) => error.pointer)).toEqual([
      '/comment',
    ]);
    expect(api.all('POST', REOPEN)).toHaveLength(0);
  });

  it('refuses without inquiries:write, without calling the API', async () => {
    as('inquiries:read');

    const result = await reopenInquiry(
      null,
      form({ 'inquiry-id': IDS.inquiry, comment: 'Synthetic' }),
    );

    expect(result.ok).toBe(false);
    expect(api.all('POST', REOPEN)).toHaveLength(0);
  });

  it("shows the API's refusal of a redacted inquiry (410)", async () => {
    as('inquiries:read', 'inquiries:write');
    api.onProblem('POST', REOPEN, 410);

    const result = await reopenInquiry(
      null,
      form({ 'inquiry-id': IDS.inquiry, comment: 'Synthetic' }),
    );

    expect(result.ok).toBe(false);
  });
});
