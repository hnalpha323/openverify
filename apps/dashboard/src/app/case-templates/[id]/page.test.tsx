import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/toasts';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { CASE_IDS, caseTemplate, caseTemplateVersion } from '../../../testing/cases-fixtures';
import { fakeRequest } from '../../../testing/fake-request';
import {
  CASE_DEVELOPER,
  CASE_REVIEWER,
  CASE_TEMPLATE_VERSIONS_PATH,
  serveCaseTemplate,
  serveCaseTemplateVersion,
  serveCaseTemplateVersions,
} from '../../../testing/routes/cases';
import CaseTemplatePage, { metadata } from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  serveCaseTemplateVersion(api, caseTemplateVersion());
  serveCaseTemplateVersions(api, [caseTemplateVersion({ status: 'draft' }), caseTemplateVersion()]);
});

afterEach(() => {
  api.restore();
});

const page = async (id: string = CASE_IDS.template) =>
  render(
    <ToastProvider>
      {await CaseTemplatePage({
        params: Promise.resolve({ id }),
        searchParams: Promise.resolve({}),
      })}
    </ToastProvider>,
  );

describe('one case template (C130, C142.1)', () => {
  it('shows its key, who sees its cases, every version and the published version’s statuses in words', async () => {
    expect(metadata.title).toBe('Case template');
    api.me({ permissions: CASE_REVIEWER });
    serveCaseTemplate(api, caseTemplate({ draftVersion: 2 }));

    await page();

    expect(screen.getByRole('heading', { level: 1, name: 'Synthetic KYC review' })).toBeVisible();
    expect(screen.getByText('KYC')).toBeVisible();
    expect(screen.getByText(/Every role that holds cases:read sees its cases/u)).toBeVisible();
    const versions = screen.getByRole('table', { name: 'Versions' });
    expect(within(versions).getByRole('link', { name: 'Version 2' })).toHaveAttribute(
      'href',
      `/case-templates/${CASE_IDS.template}/versions/${CASE_IDS.draft}`,
    );
    expect(Object.fromEntries(api.find('GET', CASE_TEMPLATE_VERSIONS_PATH)?.query ?? [])).toEqual({
      'filter[case-template-id]': CASE_IDS.template,
      'page[size]': '25',
    });
    const published = screen.getByRole('region', { name: 'Published version' });
    const statuses = within(published).getByRole('table', { name: 'Statuses' });
    const pending = within(
      within(statuses).getByRole('rowheader', { name: 'Pending' }).closest('tr') as HTMLElement,
    );
    expect(pending.getByText('In progress')).toBeVisible();
    expect(pending.getByText('Pauses the SLA')).toBeVisible();
    expect(within(published).getByRole('table', { name: 'Fields' })).toHaveTextContent('note');
    // A reviewer reads: no edit, draft or archive control.
    expect(screen.queryByRole('link', { name: 'Open the latest draft' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive template' })).toBeNull();
    expect(screen.queryByRole('form', { name: 'Name and visibility' })).toBeNull();
  });

  it('opens the open draft, archives and renames with case-templates:write', async () => {
    api.me({ permissions: CASE_DEVELOPER });
    serveCaseTemplate(api, caseTemplate({ draftVersion: 2, visibleToRoles: [CASE_IDS.role] }));

    await page();

    expect(screen.getByRole('link', { name: 'Open the latest draft' })).toHaveAttribute(
      'href',
      `/case-templates/${CASE_IDS.template}/versions/${CASE_IDS.draft}`,
    );
    expect(screen.queryByRole('button', { name: 'New draft' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Archive template' })).toBeVisible();
    const form = screen.getByRole('form', { name: 'Name and visibility' });
    expect(within(form).getByRole('textbox', { name: /^Name/u })).toHaveValue(
      'Synthetic KYC review',
    );
    expect(within(form).getByRole('textbox', { name: /^Roles that see its cases/u })).toHaveValue(
      CASE_IDS.role,
    );
  });

  it('offers a new draft when none is open, and no archive once archived', async () => {
    api.me({ permissions: CASE_DEVELOPER });
    serveCaseTemplate(api, caseTemplate({ status: 'archived' }));

    await page();

    expect(screen.getByRole('button', { name: 'New draft' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Archive template' })).toBeNull();
    expect(screen.getByText(/Archived: it takes no new case/u)).toBeVisible();
  });

  it('says so when no version is published yet', async () => {
    api.me({ permissions: CASE_REVIEWER });
    serveCaseTemplate(api, caseTemplate({ publishedVersion: null, draftVersion: 1 }));

    await page();

    expect(screen.getByRole('region', { name: 'Published version' })).toHaveTextContent(
      'No version is published yet, so no case can be created with this template.',
    );
  });

  it('answers not found for an id that is not a template’s', async () => {
    api.me({ permissions: CASE_REVIEWER });

    await expect(page('not-a-template')).rejects.toThrow();
  });
});
