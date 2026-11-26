// @vitest-environment node
import { OpenVerifyApiError } from '@openverify/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import {
  LIFECYCLE_IDS as IDS,
  inquiryDocument,
  inquiryEvent,
  inquiryList,
} from '../../testing/lifecycle-fixtures';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { fakeRequest } from '../../testing/fake-request';
import { redirectTarget } from '../../testing/next-errors';
import { SESSION_COOKIE } from '../session-cookie';
import {
  INQUIRY_PAGE_SIZE,
  TIMELINE_PAGE_SIZE,
  getInquiry,
  listInquiries,
  listInquiryEvents,
} from './inquiries';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: RouteApi;

beforeEach(() => {
  api = routeApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

describe('listInquiries', () => {
  // C165.3, C165.5 (Workflow 9C; requested by dashboard-analytics): the server API's list, which
  // applies every list filter; the dashboard route accepts the new filters but ignores them.
  it('reads one page of the server API list with every filter, as the session', async () => {
    api.on('GET', '/inquiries', 200, inquiryList());

    const page = await listInquiries(
      {
        statuses: ['failed', 'needs_review'],
        tags: ['vip'],
        accountId: IDS.account,
        referenceId: 'ref-1',
        createdFrom: '2026-10-01',
        createdTo: '2026-10-01',
      },
      IDS.otherInquiry,
    );

    expect(page.data[0]?.id).toBe(IDS.inquiry);
    const request = api.find('GET', '/inquiries');
    expect(Object.fromEntries(request?.query ?? [])).toEqual({
      'filter[status]': 'failed,needs_review',
      'filter[tag]': 'vip',
      'filter[account-id]': IDS.account,
      'filter[reference-id]': 'ref-1',
      'filter[created-at-start]': '2026-10-01T00:00:00.000Z',
      'filter[created-at-end]': '2026-10-02T00:00:00.000Z',
      'page[after]': IDS.otherInquiry,
      'page[size]': String(INQUIRY_PAGE_SIZE),
    });
    expect(request?.headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  it('sends only the page size without filters', async () => {
    api.on('GET', '/inquiries', 200, inquiryList([]));

    await listInquiries({ statuses: [], tags: [] });

    expect([...(api.find('GET', '/inquiries')?.query.keys() ?? [])]).toEqual(['page[size]']);
  });

  it('sends a signed-out operator to sign in without calling the API', async () => {
    fakeRequest.cookies.clear();

    await expect(redirectTarget(listInquiries({ statuses: [], tags: [] }))).resolves.toBe('/login');
    expect(api.requests).toHaveLength(0);
  });
});

describe('getInquiry', () => {
  it('reads the inquiry with its verifications, checks and files', async () => {
    api.on('GET', `/dashboard/inquiries/${IDS.inquiry}`, 200, inquiryDocument());

    const document = await getInquiry(IDS.inquiry);

    expect(document.data.id).toBe(IDS.inquiry);
    expect(document.included).toHaveLength(5);
  });

  it("raises the API's 404 for renderPage to map", async () => {
    api.onProblem('GET', `/dashboard/inquiries/${IDS.inquiry}`, 404);

    await expect(getInquiry(IDS.inquiry)).rejects.toBeInstanceOf(OpenVerifyApiError);
  });
});

describe('listInquiryEvents', () => {
  it('reads the events of the inquiry, its verifications and sessions, newest first, one page at a time (C25.7)', async () => {
    api.on('GET', '/events', 200, {
      data: [inquiryEvent('inquiry.approved')],
      links: { next: null },
    });

    const page = await listInquiryEvents(IDS.inquiry, IDS.otherEvent);

    expect(page.data[0]?.attributes.name).toBe('inquiry.approved');
    expect(Object.fromEntries(api.find('GET', '/events')?.query ?? [])).toEqual({
      'filter[inquiry-id]': IDS.inquiry,
      'page[size]': String(TIMELINE_PAGE_SIZE),
      'page[after]': IDS.otherEvent,
    });
  });
});
