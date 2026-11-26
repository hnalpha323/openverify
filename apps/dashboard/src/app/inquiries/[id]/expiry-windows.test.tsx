/**
 * C151.10 (Workflow 9B, the Handover to 9C): the inquiry's own expiry windows, read-only; a window
 * the inquiry does not set (`null` or absent) is the template version's, said in words, never 0.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/toasts';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import { LIFECYCLE_IDS as IDS, inquiryDocument } from '../../../testing/lifecycle-fixtures';
import { serveDecisions } from '../../../testing/routes/workflows';
import InquiryPage from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  serveDecisions(api, []);
  api.me({ permissions: ['inquiries:read'] });
});

afterEach(() => {
  api.restore();
});

const term = (name: string) => screen.getByText(name, { selector: 'dt' }).nextElementSibling;

describe('the inquiry’s expiry windows (C151.10)', () => {
  it('shows a window the inquiry sets, and the template’s default for one it does not', async () => {
    api.on(
      'GET',
      `/dashboard/inquiries/${IDS.inquiry}`,
      200,
      inquiryDocument({
        'expiration-after-start-interval-seconds': 7_200,
        'expiration-after-resume-interval-seconds': null,
      }),
    );

    render(
      <ToastProvider>
        {await InquiryPage({
          params: Promise.resolve({ id: IDS.inquiry }),
          searchParams: Promise.resolve({}),
        })}
      </ToastProvider>,
    );

    expect(term('Expires after start')).toHaveTextContent('2 hours (7,200 seconds)');
    expect(term('Expires after resume')).toHaveTextContent('The template’s default');
    expect(term('One-time link lifetime')).toHaveTextContent('The template’s default');
  });
});
