import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { LIFECYCLE_IDS as IDS, template } from '../../testing/lifecycle-fixtures';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { fakeRequest } from '../../testing/fake-request';
import { redirectTarget } from '../../testing/next-errors';
import TemplatesPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: ['inquiry-templates:read'] });
  api.on('GET', '/inquiry-templates', 200, { data: [template()], links: { next: null } });
});

afterEach(() => {
  api.restore();
});

const page = (params: Record<string, string> = {}) =>
  TemplatesPage({ searchParams: Promise.resolve(params) });

describe('templates page', () => {
  it('lists the templates with their status and current version', async () => {
    render(await page());

    expect(screen.getByRole('heading', { level: 1, name: 'Templates' })).toBeVisible();
    const table = screen.getByRole('table', { name: 'Templates' });
    const row = within(table)
      .getByRole('rowheader', { name: 'Synthetic ID and selfie' })
      .closest('tr');
    if (row === null) throw new Error('no row');
    expect(within(row).getByRole('link', { name: 'Synthetic ID and selfie' })).toHaveAttribute(
      'href',
      `/templates/${IDS.template}`,
    );
    expect(within(row).getByText('Active')).toHaveAttribute('data-status', 'active');
    expect(within(row).getByText('Version 1')).toBeVisible();
    expect(within(row).getByText(IDS.template)).toBeVisible();
  });

  it('pages with the C1 cursor, and sends no created-at filter (F029)', async () => {
    api.on('GET', '/inquiry-templates', 200, {
      data: [template()],
      links: { next: `/api/v1/inquiry-templates?page%5Bafter%5D=${IDS.template}` },
    });

    render(await page({ after: 'itmpl_01JB0000000000000000000009' }));

    expect(Object.fromEntries(api.find('GET', '/inquiry-templates')?.query ?? [])).toEqual({
      'page[size]': '25',
      'page[after]': 'itmpl_01JB0000000000000000000009',
    });
    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      `/templates?after=${IDS.template}`,
    );
  });

  it('says when there are no templates', async () => {
    api.on('GET', '/inquiry-templates', 200, { data: [], links: { next: null } });

    render(await page());

    expect(screen.getByRole('heading', { name: 'No templates yet' })).toBeVisible();
  });

  it('shows the forbidden panel without inquiry-templates:read', async () => {
    api.me({ permissions: ['inquiries:read'] });

    render(await page());

    expect(screen.getByRole('heading', { level: 1, name: 'You do not have access' })).toBeVisible();
    expect(api.find('GET', '/inquiry-templates')).toBeUndefined();
  });

  it('sends the operator to sign in when the session has ended', async () => {
    api.onProblem('GET', '/inquiry-templates', 401);

    await expect(redirectTarget(page())).resolves.toBe('/login');
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('Templates');
  });
});
