// @vitest-environment node
/** C172.2: the case checklist read and write through the server API with the operator's session. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { REVIEWER_IDS as IDS } from '../../testing/reviewer-fixtures';
import { checklistPath, checklistState, serveChecklist } from '../../testing/routes/cases-reports';
import { SESSION_COOKIE } from '../session-cookie';
import { getCaseChecklist, setCaseChecklistItem } from './case-checklists';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
});

describe('getCaseChecklist', () => {
  it('reads every item of the case with who checked it and when, as the API answered', async () => {
    const state = checklistState([
      { checklist: 'kyc', item: 'id-seen', by: IDS.me },
      { checklist: 'kyc', item: 'address-seen' },
    ]);
    serveChecklist(api, state);

    const document = await getCaseChecklist(IDS.case);

    expect(document).toEqual(state);
    const request = api.find('GET', checklistPath());
    expect(request?.headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  it('encodes the case id into the path', async () => {
    const odd = 'case_x/../y';
    api.on('GET', `/cases/${encodeURIComponent(odd)}/checklist`, 200, checklistState([]));

    await getCaseChecklist(odd).catch(() => undefined);

    expect(api.requests[0]?.path).toBe(`/cases/${encodeURIComponent(odd)}/checklist`);
  });
});

describe('setCaseChecklistItem', () => {
  it('posts one item’s new state with the lock version and answers the whole state', async () => {
    const state = checklistState([{ checklist: 'kyc', item: 'id-seen', by: IDS.me }], 4);
    api.on('POST', checklistPath(), 200, state);

    const document = await setCaseChecklistItem(IDS.case, {
      'checklist-key': 'kyc',
      'item-key': 'id-seen',
      checked: true,
      'lock-version': 3,
    });

    expect(document.data.attributes['lock-version']).toBe(4);
    expect(api.find('POST', checklistPath())?.body).toEqual({
      meta: { 'checklist-key': 'kyc', 'item-key': 'id-seen', checked: true, 'lock-version': 3 },
    });
  });
});
