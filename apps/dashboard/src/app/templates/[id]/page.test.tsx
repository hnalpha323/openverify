import type { Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import {
  LIFECYCLE_IDS as IDS,
  draft,
  single,
  template,
  version,
} from '../../../testing/lifecycle-fixtures';
import { ToastProvider } from '../../../components/toasts';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { fakeRequest } from '../../../testing/fake-request';
import { expectNotFound } from '../../../testing/next-errors';
import { serveDiff, serveNoDeployments, serveUsage } from '../../../testing/routes/flow-builder';
import TemplatePage, { metadata } from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const TEMPLATE = `/inquiry-templates/${IDS.template}`;
const DEVELOPER: Permission[] = [
  'inquiry-templates:read',
  'inquiry-templates:write',
  'inquiry-templates:publish',
];

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: DEVELOPER });
  api.on('GET', TEMPLATE, 200, single(template()));
  api.on('GET', '/inquiry-template-versions', 200, {
    data: [draft(), version()],
    links: { next: null },
  });
  serveUsage(api, IDS.template);
});

afterEach(() => {
  api.restore();
});

const page = (id: string = IDS.template, searchParams: Record<string, string> = {}) =>
  TemplatePage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(searchParams) });

async function renderTemplate(searchParams: Record<string, string> = {}) {
  render(<ToastProvider>{await page(IDS.template, searchParams)}</ToastProvider>);
}

describe('the template’s versions (C155.7)', () => {
  it('compares two versions as a list, consequences in words', async () => {
    serveDiff(api, IDS.draft, IDS.version, {
      steps: { added: ['s_doc00000'], removed: [], changed: [] },
      consequences: [{ code: 'verification_step_removed', pointer: '/flow/steps/2' }],
    });

    await renderTemplate({ compare: IDS.draft, against: IDS.version });

    const section = screen.getByRole('region', { name: 'Compare versions' });
    expect(within(section).getByRole('combobox', { name: 'Version' })).toHaveValue(IDS.draft);
    expect(within(section).getByRole('combobox', { name: 'Against' })).toHaveValue(IDS.version);
    expect(within(section).getByRole('list', { name: 'Consequences' })).toHaveTextContent(
      'A verification step was removed',
    );
    expect(within(section).getByRole('list', { name: 'Changes' })).toHaveTextContent(
      'Step added: s_doc00000',
    );
  });

  it('says what uses the template, counting what the operator cannot see (review P34)', async () => {
    serveUsage(api, IDS.template, 2);

    await renderTemplate();

    expect(screen.getByRole('region', { name: 'Used by' })).toHaveTextContent(
      '2 workflows you cannot see',
    );
  });

  it('shows the deployment history with deployments:read', async () => {
    api.me({ permissions: [...DEVELOPER, 'deployments:read'] });
    serveNoDeployments(api);

    await renderTemplate();

    expect(screen.getByRole('region', { name: 'Deployments' })).toHaveTextContent(
      'Nothing has been published from this template yet.',
    );
  });

  it('offers restoring a published version as a draft with inquiry-templates:write', async () => {
    await renderTemplate();

    expect(screen.getByRole('button', { name: 'Restore version 1 as a draft' })).toBeVisible();
  });
});

describe('template page', () => {
  it('links the template’s sections, the overview marked as the page (Workflow 9C)', async () => {
    await renderTemplate();

    const sections = screen.getByRole('navigation', { name: 'Template sections' });
    expect(within(sections).getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(sections).getByRole('link', { name: 'Flow' })).toHaveAttribute(
      'href',
      `/templates/${IDS.template}/flow`,
    );
    expect(within(sections).getByRole('link', { name: 'Preview' })).toHaveAttribute(
      'href',
      `/templates/${IDS.template}/preview`,
    );
  });

  it('shows the template, its current version and its settings', async () => {
    await renderTemplate();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Synthetic ID and selfie' }),
    ).toBeVisible();
    const current = screen.getByRole('region', { name: 'Current version' });
    expect(within(current).getByText('Version 1')).toBeVisible();
    expect(within(current).getByText('Inquiry lifetime').nextElementSibling).toHaveTextContent(
      '86,400 seconds',
    );
    expect(within(current).getByText('Retention').nextElementSibling).toHaveTextContent(
      'Environment default',
    );
  });

  it('lists the versions, newest first, each linking to its page', async () => {
    await renderTemplate();

    const table = screen.getByRole('table', { name: 'Versions' });
    expect(within(table).getByRole('link', { name: 'Version 2' })).toHaveAttribute(
      'href',
      `/templates/${IDS.template}/versions/${IDS.draft}`,
    );
    expect(within(table).getByText('Draft')).toHaveAttribute('data-status', 'draft');
    expect(within(table).getByText('Published')).toBeVisible();
    expect(Object.fromEntries(api.find('GET', '/inquiry-template-versions')?.query ?? [])).toEqual({
      'filter[inquiry-template-id]': IDS.template,
      'page[size]': '25',
    });
  });

  it('offers a new draft and archiving with inquiry-templates:write', async () => {
    await renderTemplate();

    const actions = screen.getByRole('group', { name: 'Template actions' });
    expect(
      within(actions)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['New draft', 'Archive']);
  });

  it('offers copying and promoting the current version with inquiry-templates:write (C155.7)', async () => {
    await renderTemplate();

    const operations = screen.getByRole('group', { name: 'Copy and promote' });
    expect(
      within(operations)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Copy template…', 'Promote…']);
  });

  it('offers activation for an archived template', async () => {
    api.on('GET', TEMPLATE, 200, single(template({ status: 'archived' })));

    await renderTemplate();

    expect(
      within(screen.getByRole('group', { name: 'Template actions' })).getByRole('button', {
        name: 'Activate',
      }),
    ).toBeVisible();
  });

  it('is read-only for a viewer', async () => {
    api.me({ permissions: ['inquiry-templates:read'] });

    await renderTemplate();

    expect(screen.queryByRole('group', { name: 'Template actions' })).not.toBeInTheDocument();
    // C155.7 (Workflow 9C): comparing two versions only reads, so a viewer has its button alone.
    expect(screen.queryAllByRole('button').map((button) => button.textContent)).toEqual([
      'Compare',
    ]);
  });

  it('is not found for a malformed id, without calling the API', async () => {
    await expectNotFound(page('itmpl_x'));

    expect(api.requests).toHaveLength(0);
  });

  it('is not found when the API does not show it', async () => {
    api.onProblem('GET', TEMPLATE, 404);

    await expectNotFound(page());
  });

  it('shows the forbidden panel without inquiry-templates:read', async () => {
    api.me({ permissions: ['inquiries:read'] });

    render(await page());

    expect(screen.getByRole('heading', { level: 1, name: 'You do not have access' })).toBeVisible();
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('Template');
  });
});
