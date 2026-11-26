import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/toasts';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { CASE_IDS, caseTemplate } from '../../testing/cases-fixtures';
import { fakeRequest } from '../../testing/fake-request';
import {
  CASE_DEVELOPER,
  CASE_TEMPLATES_PATH,
  CASE_VIEWER,
  serveCaseTemplates,
} from '../../testing/routes/cases';
import CaseTemplatesPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: CASE_VIEWER });
});

afterEach(() => {
  api.restore();
});

const page = async (params: Record<string, string> = {}) =>
  render(
    <ToastProvider>
      {await CaseTemplatesPage({ searchParams: Promise.resolve(params) })}
    </ToastProvider>,
  );

const rowOf = (table: HTMLElement, name: string) =>
  within(within(table).getByRole('rowheader', { name }).closest('tr') as HTMLElement);

describe('the case templates (C130, C142.1)', () => {
  it('lists each template with its key, its status and its published and draft versions', async () => {
    expect(metadata.title).toBe('Case templates');
    serveCaseTemplates(
      api,
      [
        caseTemplate({ draftVersion: 2 }),
        caseTemplate({
          id: CASE_IDS.otherTemplate,
          name: 'Synthetic fraud review',
          key: 'FRD',
          status: 'archived',
          publishedVersion: null,
          draftVersion: 1,
        }),
      ],
      `/api/v1/case-templates?page[after]=${CASE_IDS.otherTemplate}`,
    );

    await page();

    const table = screen.getByRole('table', { name: 'Case templates' });
    const kyc = rowOf(table, 'Synthetic KYC review');
    expect(kyc.getByRole('link', { name: 'Synthetic KYC review' })).toHaveAttribute(
      'href',
      `/case-templates/${CASE_IDS.template}`,
    );
    expect(kyc.getByText('KYC')).toBeVisible();
    expect(kyc.getByText('Active')).toBeVisible();
    expect(kyc.getByText('v1')).toBeVisible();
    expect(kyc.getByText('v2')).toBeVisible();
    const fraud = rowOf(table, 'Synthetic fraud review');
    expect(fraud.getByText('Archived: takes no new case')).toBeVisible();
    expect(fraud.getByText('Not published yet')).toBeVisible();
    expect(Object.fromEntries(api.find('GET', CASE_TEMPLATES_PATH)?.query ?? [])).toEqual({
      'page[size]': '25',
    });
    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      `/case-templates?after=${CASE_IDS.otherTemplate}`,
    );
    expect(screen.queryByRole('form', { name: 'Create a case template' })).toBeNull();
  });

  it('offers creation by name and key with case-templates:write', async () => {
    api.me({ permissions: CASE_DEVELOPER });
    serveCaseTemplates(api, []);

    await page();

    expect(screen.getByRole('heading', { name: 'No case templates yet' })).toBeVisible();
    const create = screen.getByRole('form', { name: 'Create a case template' });
    expect(within(create).getByRole('textbox', { name: /^Name/u })).toBeRequired();
    const key = within(create).getByRole('textbox', { name: /^Key/u });
    expect(key).toBeRequired();
    expect(key).toHaveAccessibleDescription(/2 to 10 capital letters and digits/u);
    expect(within(create).getByRole('button', { name: 'Create template' })).toBeVisible();
  });

  it('shows the forbidden panel without case-templates:read', async () => {
    api.me({ permissions: ['cases:read'] });

    await page();

    expect(screen.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
    expect(api.find('GET', CASE_TEMPLATES_PATH)).toBeUndefined();
  });
});
