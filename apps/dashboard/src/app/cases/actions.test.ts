// @vitest-environment node
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CASE_PROBLEM_WORDS } from '../../components/cases/case-words';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { CASE_IDS, bulkAction, caseResource, notification } from '../../testing/cases-fixtures';
import { fakeRequest } from '../../testing/fake-request';
import { CASE_REVIEWER, CASE_VIEWER } from '../../testing/routes/cases';
import { createCaseBulkAction, markNotificationRead, takeNextCase } from './actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  vi.mocked(revalidatePath).mockReset();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: CASE_REVIEWER });
  api.on('POST', '/cases/bulk', 202, { data: bulkAction({ status: 'pending' }) });
});

afterEach(() => {
  api.restore();
});

const form = (fields: Record<string, string | readonly string[]>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const each of typeof value === 'string' ? [value] : value) {
      data.append(name, each);
    }
  }
  return data;
};
const selected = { 'case-id': [CASE_IDS.case, CASE_IDS.otherCase] };
const bodyOf = () => api.find('POST', '/cases/bulk')?.body;

describe('bulk actions (C137.4, C142.1)', () => {
  it('sets the status of the selected cases, with an optional resolution and comment, and answers the action’s id', async () => {
    const result = await createCaseBulkAction(
      null,
      form({
        ...selected,
        action: 'set-status',
        status: 'approved',
        resolution: 'Approved',
        comment: '',
      }),
    );

    expect(result).toEqual({ ok: true, data: { id: CASE_IDS.bulk } });
    expect(bodyOf()).toEqual({
      data: {
        type: 'case-bulk-action',
        attributes: { action: 'set-status', 'case-ids': [CASE_IDS.case, CASE_IDS.otherCase] },
      },
      meta: { status: 'approved', resolution: 'Approved' },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/cases');
  });

  it('assigns to an operator or unassigns, moves to a queue or none, and adds or removes tags', async () => {
    await createCaseBulkAction(
      null,
      form({ ...selected, action: 'assign', 'user-id': CASE_IDS.member }),
    );
    expect(bodyOf()).toMatchObject({ meta: { 'user-id': CASE_IDS.member } });
    await createCaseBulkAction(null, form({ ...selected, action: 'assign', 'user-id': '' }));
    expect(bodyOf()).toMatchObject({ meta: { 'user-id': null } });
    await createCaseBulkAction(
      null,
      form({ ...selected, action: 'set-queue', 'case-queue-id': '' }),
    );
    expect(bodyOf()).toMatchObject({ meta: { 'case-queue-id': null } });
    await createCaseBulkAction(
      null,
      form({ ...selected, action: 'remove-tags', tags: 'urgent, synthetic\nreview' }),
    );
    expect(bodyOf()).toMatchObject({
      data: { attributes: { action: 'remove-tags' } },
      meta: { 'tag-names': ['urgent', 'synthetic', 'review'] },
    });
  });

  it('asks nothing to assign without cases:assign, or to act on no case', async () => {
    api.me({ permissions: CASE_REVIEWER.filter((each) => each !== 'cases:assign') });

    expect(
      await createCaseBulkAction(null, form({ ...selected, action: 'assign', 'user-id': '' })),
    ).toMatchObject({ ok: false, problem: { title: 'You do not have access' } });
    api.me({ permissions: CASE_REVIEWER });
    expect(
      await createCaseBulkAction(null, form({ action: 'add-tags', tags: 'urgent' })),
    ).toMatchObject({ ok: false, problem: { errors: [{ pointer: '/data/attributes/case-ids' }] } });
    expect(api.find('POST', '/cases/bulk')).toBeUndefined();
  });

  it('titles a refusal of the whole action in words', async () => {
    api.onProblem('POST', '/cases/bulk', 422, undefined, { code: 'case_bulk_too_large' });

    expect(
      await createCaseBulkAction(null, form({ ...selected, action: 'add-tags', tags: 'urgent' })),
    ).toMatchObject({ ok: false, problem: { title: CASE_PROBLEM_WORDS.case_bulk_too_large } });
  });
});

describe('next case and notifications (C132.3, C134.4, C142.1)', () => {
  it('pulls the most urgent case of the caller’s queues, or answers that none waits', async () => {
    api.on('POST', '/cases/next', 200, { data: caseResource({ assigneeId: CASE_IDS.user }) });
    expect(await takeNextCase(null, form({}))).toEqual({
      ok: true,
      data: { caseId: CASE_IDS.case },
    });
    expect(api.find('POST', '/cases/next')?.body).toEqual({});

    api.on('POST', '/cases/next', 200, { data: null });
    expect(await takeNextCase(null, form({}))).toEqual({ ok: true, data: { caseId: null } });
  });

  it('marks a notification read, on the dashboard API', async () => {
    api.on('POST', `/dashboard/notifications/${CASE_IDS.notification}/read`, 200, {
      data: notification({ readAt: '2026-11-03T11:00:00.000Z' }),
    });

    expect(
      await markNotificationRead(null, form({ 'notification-id': CASE_IDS.notification })),
    ).toEqual({ ok: true, data: undefined });
    expect(revalidatePath).toHaveBeenCalledWith('/cases/notifications');
  });

  it('pulls nothing for a viewer', async () => {
    api.me({ permissions: CASE_VIEWER });

    expect(await takeNextCase(null, form({}))).toMatchObject({ ok: false });
    expect(api.find('POST', '/cases/next')).toBeUndefined();
  });
});
