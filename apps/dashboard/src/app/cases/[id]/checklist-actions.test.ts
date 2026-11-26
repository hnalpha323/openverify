// @vitest-environment node
/** C172.2: the checklist server action checks one item as the operator, and says a refusal in words. */
import type { Permission } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import { REVIEWER_IDS as IDS } from '../../../testing/reviewer-fixtures';
import { checklistPath, checklistState } from '../../../testing/routes/cases-reports';
import { CASE_PROBLEM_WORDS } from '../../../components/cases/case-words';
import { checkCaseChecklistItem, setCaseStatus } from './actions';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;
const as = (...permissions: Permission[]) => api.me({ permissions });

beforeEach(() => {
  vi.mocked(revalidatePath).mockReset();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  as('cases:read', 'cases:write');
});

afterEach(() => {
  api.restore();
});

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
const ITEM = {
  'case-id': IDS.case,
  'checklist-key': 'kyc',
  'item-key': 'address-seen',
  checked: 'true',
  'lock-version': '3',
};

describe('checkCaseChecklistItem', () => {
  it('posts the item, its new state and the lock version, and refreshes the case page', async () => {
    api.on(
      'POST',
      checklistPath(),
      200,
      checklistState([{ checklist: 'kyc', item: 'address-seen', by: IDS.me }], 4),
    );

    const result = await checkCaseChecklistItem(null, form(ITEM));

    expect(result).toEqual({ ok: true, data: undefined });
    expect(api.find('POST', checklistPath())?.body).toEqual({
      meta: {
        'checklist-key': 'kyc',
        'item-key': 'address-seen',
        checked: true,
        'lock-version': 3,
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/cases/${IDS.case}`);
  });

  it('sends an uncheck as false', async () => {
    api.on('POST', checklistPath(), 200, checklistState([], 4));

    await checkCaseChecklistItem(null, form({ ...ITEM, checked: 'false' }));

    expect(api.find('POST', checklistPath())?.body).toMatchObject({ meta: { checked: false } });
  });

  it('titles a case refusal in the console’s words', async () => {
    api.onProblem('POST', checklistPath(), 409, undefined, { code: 'case_version_conflict' });

    const result = await checkCaseChecklistItem(null, form(ITEM));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.problem.code).toBe('case_version_conflict');
    expect(!result.ok && result.problem.title).not.toBe('not built yet');
  });

  it('calls nothing without cases:write', async () => {
    as('cases:read');

    const result = await checkCaseChecklistItem(null, form(ITEM));

    expect(result.ok).toBe(false);
    expect(api.find('POST', checklistPath())).toBeUndefined();
  });

  it('refuses a malformed item key without calling the API', async () => {
    const result = await checkCaseChecklistItem(null, form({ ...ITEM, 'item-key': 'Not A Key' }));

    expect(result.ok).toBe(false);
    expect(api.find('POST', checklistPath())).toBeUndefined();
  });
});

describe('setCaseStatus refused by the version’s requirements (C172.2, C172.3)', () => {
  it.each(['case_checklist_incomplete', 'case_fields_required'] as const)(
    'titles %s in the console’s words, keeping the pointer',
    async (code) => {
      api.onProblem('POST', `/cases/${IDS.case}/set-status`, 422, undefined, {
        code,
        errors: [{ pointer: '/meta/status', detail: 'refused' }],
      });

      const result = await setCaseStatus(
        null,
        form({ 'case-id': IDS.case, status: 'approved', 'lock-version': '3' }),
      );

      expect(result.ok).toBe(false);
      expect(!result.ok && result.problem.title).toBe(CASE_PROBLEM_WORDS[code]);
      expect(!result.ok && result.problem.errors?.[0]?.pointer).toBe('/meta/status');
    },
  );
});
