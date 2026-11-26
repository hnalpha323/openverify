// @vitest-environment node
import { PERMISSIONS, type Permission } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { withdrawConsentRecordAction } from './consent-actions';
import { consentRecord } from './connect-fixtures';
import { CONNECT_PROBLEM_WORDS } from './connect-problem-words';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  vi.mocked(revalidatePath).mockReset();
});

afterEach(() => {
  api.restore();
});

const RECORD = consentRecord('source-flow');
const PATH = `/connect/consent-records/${RECORD.id}/withdraw`;
const SUBJECT = 'inq_01M5CJXHG07XPHF3HRM6NREDH7';
const as = (permissions: readonly Permission[] = PERMISSIONS) => api.me({ permissions });
const formOf = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) {
    data.set(name, value);
  }
  return data;
};
const withdrawn = { data: consentRecord('withdrawn', { 'withdrawn-via': 'operator' }) };

describe('the console’s withdrawal (C237.1, C242.3)', () => {
  it('withdraws with the chosen reason and refreshes the subject’s page', async () => {
    as();
    api.on('POST', PATH, 200, withdrawn);

    const result = await withdrawConsentRecordAction(
      null,
      formOf({ 'consent-record-id': RECORD.id, 'withdrawal-reason': 'operator-decision' }),
    );

    expect(result).toEqual({ ok: true, data: undefined });
    expect(api.find('POST', PATH)?.body).toEqual({
      data: { type: 'consent-record', attributes: { 'withdrawal-reason': 'operator-decision' } },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/inquiries/${SUBJECT}`);
  });

  it('withdraws without a reason when none is chosen', async () => {
    as();
    api.on('POST', PATH, 200, withdrawn);

    await withdrawConsentRecordAction(
      null,
      formOf({ 'consent-record-id': RECORD.id, 'withdrawal-reason': '' }),
    );

    expect(api.find('POST', PATH)?.body).toEqual({
      data: { type: 'consent-record', attributes: {} },
    });
  });

  it('says a second withdrawal in words', async () => {
    as();
    api.onProblem('POST', PATH, 409, undefined, { code: 'consent_already_withdrawn' });

    expect(
      await withdrawConsentRecordAction(null, formOf({ 'consent-record-id': RECORD.id })),
    ).toMatchObject({
      ok: false,
      problem: { title: CONNECT_PROBLEM_WORDS.consent_already_withdrawn },
    });
  });

  it('refuses a reason outside the closed list and a malformed id, before calling anything', async () => {
    as();

    const reason = await withdrawConsentRecordAction(
      null,
      formOf({ 'consent-record-id': RECORD.id, 'withdrawal-reason': 'bored' }),
    );
    const id = await withdrawConsentRecordAction(null, formOf({ 'consent-record-id': 'cnsr_x' }));

    expect(reason).toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/withdrawal-reason' }] },
    });
    expect(id).toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/consent-record-id' }] },
    });
    expect(api.all('POST', PATH)).toHaveLength(0);
  });

  it('needs connect-share-tokens:write', async () => {
    as(['connect-share-tokens:read']);

    expect(
      await withdrawConsentRecordAction(null, formOf({ 'consent-record-id': RECORD.id })),
    ).toMatchObject({ ok: false, problem: { title: 'You do not have access' } });
  });
});
