// @vitest-environment node
import { OpenVerifyApiError, OpenVerifyResponseValidationError } from '@openverify/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import {
  casesAnswer,
  checksAnswer,
  funnelAnswer,
  inquiriesAnswer,
  signalsAnswer,
  verificationsAnswer,
} from '../../testing/routes/analytics';
import { ANALYTICS_DOCUMENT_SCHEMAS, readAnalytics } from './analytics';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: MockApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = mockApi();
});

afterEach(() => {
  api.restore();
});

const QUERY = { 'filter[from]': '2026-10-01', 'filter[to]': '2026-10-03', bucket: 'day' };

describe('the fixtures', () => {
  it('pass their answer schemas, suppression included', () => {
    expect(ANALYTICS_DOCUMENT_SCHEMAS.inquiries.safeParse(inquiriesAnswer()).success).toBe(true);
    expect(ANALYTICS_DOCUMENT_SCHEMAS.funnel.safeParse(funnelAnswer()).success).toBe(true);
    expect(
      ANALYTICS_DOCUMENT_SCHEMAS.funnel.safeParse(funnelAnswer({ stepDataFrom: null })).success,
    ).toBe(true);
    expect(ANALYTICS_DOCUMENT_SCHEMAS.verifications.safeParse(verificationsAnswer()).success).toBe(
      true,
    );
    expect(ANALYTICS_DOCUMENT_SCHEMAS.checks.safeParse(checksAnswer()).success).toBe(true);
    expect(ANALYTICS_DOCUMENT_SCHEMAS.cases.safeParse(casesAnswer()).success).toBe(true);
    expect(
      ANALYTICS_DOCUMENT_SCHEMAS.cases.safeParse(casesAnswer({ assignees: true })).success,
    ).toBe(true);
    expect(ANALYTICS_DOCUMENT_SCHEMAS.signals.safeParse(signalsAnswer()).success).toBe(true);
  });
});

describe('readAnalytics', () => {
  it('reads one answer with the session, the query as the route takes it', async () => {
    api.replyTo('GET /analytics/funnel', 200, funnelAnswer());

    const answer = await readAnalytics('funnel', {
      ...QUERY,
      'filter[inquiry-template-id]': 'itmpl_01JF0000000000000000000001',
    });

    expect(answer.data.type).toBe('analytics-funnel');
    const request = api.last();
    expect(request.headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(Object.fromEntries(request.query)).toEqual({
      ...QUERY,
      'filter[inquiry-template-id]': 'itmpl_01JF0000000000000000000001',
    });
  });

  it('refuses an answer that shows a small count, so none is ever drawn', async () => {
    const leaking = inquiriesAnswer();
    leaking.data.attributes.totals.counts.created = 3;
    api.replyTo('GET /analytics/inquiries', 200, leaking);

    await expect(readAnalytics('inquiries', QUERY)).rejects.toBeInstanceOf(
      OpenVerifyResponseValidationError,
    );
  });

  it('passes the API’s refusals on as errors', async () => {
    api.replyProblemTo('GET /analytics/checks', 400);

    await expect(readAnalytics('checks', QUERY)).rejects.toBeInstanceOf(OpenVerifyApiError);
  });
});
