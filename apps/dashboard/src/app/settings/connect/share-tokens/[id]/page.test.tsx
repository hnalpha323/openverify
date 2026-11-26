import { PERMISSIONS, type Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PEEKED_NAME,
  SHARE_TOKEN_ID,
  SOURCE_CONSENT_RECORD_ID,
  CLONED_INQUIRY_ID,
  SHARED_INQUIRY_ID,
  shareToken,
} from '../../../../../components/connect/connect-fixtures';
import { CONNECT_PROBLEM_WORDS } from '../../../../../components/connect/connect-problem-words';
import { ToastProvider } from '../../../../../components/toasts';
import { SESSION_COOKIE } from '../../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../../testing/api-fixtures';
import { problemDocument } from '../../../../../testing/api-mock';
import { routeApi, type RouteApi } from '../../../../../testing/api-routes';
import { fakeRequest } from '../../../../../testing/fake-request';
import { expectNotFound } from '../../../../../testing/next-errors';
import { rscPayloadOf } from '../../../../../testing/rsc-payload';
import ShareTokenPage, { metadata } from './page';

vi.mock('../../actions', () => ({
  expireShareTokenAction: vi.fn(),
  redeemShareTokenAction: vi.fn(),
}));
vi.mock('next/headers', () =>
  import('../../../../../testing/fake-request').then((m) => m.nextHeaders),
);

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
});

const PATH = `/connect/share-tokens/${SHARE_TOKEN_ID}`;
const ADMIN: readonly Permission[] = PERMISSIONS;
const WITHOUT_PII = PERMISSIONS.filter((permission) => permission !== 'pii:view');
const as = (permissions: readonly Permission[]) => api.me({ permissions });
const serve = (token: ReturnType<typeof shareToken>, peeked?: ReturnType<typeof shareToken>) =>
  api.handle('GET', PATH, (request) => ({
    status: 200,
    body: { data: request.query.get('peek-source-data') === 'true' ? (peeked ?? token) : token },
  }));
const element = (searchParams: Record<string, string> = {}) =>
  ShareTokenPage({
    params: Promise.resolve({ id: SHARE_TOKEN_ID }),
    searchParams: Promise.resolve(searchParams),
  });
const page = async (searchParams?: Record<string, string>) =>
  render(<ToastProvider>{await element(searchParams)}</ToastProvider>);
const detail = (term: string) =>
  screen.getByText(term, { selector: 'dt' }).nextElementSibling as HTMLElement;
const peeks = () => api.all('GET', PATH).filter((request) => request.query.has('peek-source-data'));

describe('a share token’s page (C242.2)', () => {
  it('is titled Share token', () => {
    expect(metadata.title).toBe('Share token');
  });

  it('shows the source its token: the source object, the consent it cites, what it carries and how often it was peeked', async () => {
    as(ADMIN);
    serve(shareToken('outbound'));

    await page();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(SHARE_TOKEN_ID);
    expect(detail('Direction')).toHaveTextContent('Outbound');
    expect(within(detail('Source')).getByRole('link')).toHaveAttribute(
      'href',
      `/inquiries/${SHARED_INQUIRY_ID}`,
    );
    expect(detail('Consent record')).toHaveTextContent(SOURCE_CONSENT_RECORD_ID);
    expect(detail('Consent')).toHaveTextContent('Witnessed in the flow');
    expect(detail('Carries')).toHaveTextContent('Biometric data');
    expect(detail('Peeked')).toHaveTextContent('0 of 10 times');
    expect(screen.getByRole('button', { name: 'Expire' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Redeem' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Peek/ })).toBeNull();
  });

  it('shows the destination neither the source nor its consent record, and offers it the peek and the redemption', async () => {
    as(ADMIN);
    serve(shareToken('inbound'));

    await page();

    expect(screen.queryByText('Source', { selector: 'dt' })).toBeNull();
    expect(screen.queryByText('Consent record', { selector: 'dt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Expire' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Peek at the source data' })).toHaveAttribute(
      'href',
      `/settings/connect/share-tokens/${SHARE_TOKEN_ID}?peek=true`,
    );
    expect(screen.getByRole('button', { name: 'Redeem' })).toBeInTheDocument();
    expect(peeks()).toHaveLength(0);
  });

  it('peeks only when asked, and shows each attribute as its value or present / not present', async () => {
    as(ADMIN);
    serve(shareToken('inbound'), shareToken('peek'));

    await page({ peek: 'true' });

    expect(peeks()).toHaveLength(1);
    const peek = screen.getByRole('region', { name: 'Peek' });
    expect(peek).toHaveTextContent(PEEKED_NAME);
    expect(peek).toHaveTextContent('Present');
  });

  it('never peeks without pii:view, and says what the peek needs (C233.1)', async () => {
    as(WITHOUT_PII);
    serve(shareToken('inbound'), shareToken('peek'));

    await page({ peek: 'true' });

    expect(peeks()).toHaveLength(0);
    expect(screen.queryByRole('link', { name: 'Peek at the source data' })).toBeNull();
    expect(
      screen.getByText(/Peeking needs connect-share-tokens:peek and pii:view/),
    ).toBeInTheDocument();
  });

  it('says a refused peek in words and still shows the token', async () => {
    as(ADMIN);
    api.handle('GET', PATH, (request) =>
      request.query.get('peek-source-data') === 'true'
        ? { status: 429, body: { ...problemDocument(429), code: 'share_token_peek_limit' } }
        : { status: 200, body: { data: shareToken('inbound', { 'peek-count': 10 }) } },
    );

    await page({ peek: 'true' });

    expect(screen.getByRole('region', { name: 'Peek' })).toHaveTextContent(
      CONNECT_PROBLEM_WORDS.share_token_peek_limit,
    );
    expect(detail('Peeked')).toHaveTextContent('10 of 10 times');
  });

  it('shows a redeemed token’s summary, its destination and its status history', async () => {
    as(ADMIN);
    serve(
      shareToken('redeemed', {
        'pending-at': '2026-10-20T12:20:00.000Z',
        'redeemed-at': '2026-10-20T12:21:00.000Z',
      }),
    );

    await page();

    const summary = screen.getByRole('region', { name: 'What the redemption copied' });
    expect(
      within(summary).getByText('Verifications', { selector: 'dt' }).nextElementSibling,
    ).toHaveTextContent('2');
    expect(
      within(summary).getByText('Checks', { selector: 'dt' }).nextElementSibling,
    ).toHaveTextContent('14');
    expect(
      within(summary).getByText('Dropped fields', { selector: 'dt' }).nextElementSibling,
    ).toHaveTextContent('None');
    expect(within(detail('Destination')).getByRole('link')).toHaveAttribute(
      'href',
      `/inquiries/${CLONED_INQUIRY_ID}`,
    );
    const history = within(screen.getByRole('table', { name: 'Status history' })).getAllByRole(
      'row',
    );
    expect(
      history.slice(1).map((row) => (row as HTMLTableRowElement).cells[0]?.textContent),
    ).toEqual(['Created', 'Redemption started', 'Redeemed']);
    expect(screen.queryByRole('button', { name: 'Redeem' })).toBeNull();
  });

  it('says why a token expired or failed in its history', async () => {
    as(ADMIN);
    serve(
      shareToken('outbound', {
        status: 'expired',
        'expired-at': '2026-10-21T00:00:00.000Z',
        'expiry-reason': 'consent_withdrawn',
      }),
    );
    const { unmount } = await page();
    expect(screen.getByRole('table', { name: 'Status history' })).toHaveTextContent(
      'The consent it cited was withdrawn.',
    );
    expect(screen.queryByRole('button', { name: 'Expire' })).toBeNull();
    unmount();

    serve(
      shareToken('outbound', {
        status: 'failed',
        'failed-at': '2026-10-21T00:00:00.000Z',
        'failure-reason': 'consent_scope_exceeded',
      }),
    );
    await page();
    expect(screen.getByRole('table', { name: 'Status history' })).toHaveTextContent(
      'The source now holds data of a category the consent does not cover',
    );
  });

  it('answers not found for an id that is not a share token’s, and for the one 404', async () => {
    as(ADMIN);
    await expectNotFound(
      ShareTokenPage({
        params: Promise.resolve({ id: 'inq_01M5CN0000000000000011A100' }),
        searchParams: Promise.resolve({}),
      }),
    );

    api.onProblem('GET', PATH, 404);
    await expectNotFound(element());
  });
});

describe('what the share token page sends the browser (C242.5)', () => {
  it('sends no peek value to an operator without pii:view, even when asked to peek', async () => {
    as(WITHOUT_PII);
    serve(shareToken('inbound'), shareToken('peek'));

    expect(await rscPayloadOf(await element({ peek: 'true' }))).not.toContain(PEEKED_NAME);
  });

  it('sends the peek to an operator with both permissions', async () => {
    as(ADMIN);
    serve(shareToken('inbound'), shareToken('peek'));

    expect(await rscPayloadOf(await element({ peek: 'true' }))).toContain(PEEKED_NAME);
  });
});
