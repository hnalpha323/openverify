import type { Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../components/toasts';
import { SESSION_COOKIE } from '../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../../testing/api-routes';
import { fakeRequest } from '../../../../testing/fake-request';
import {
  LIFECYCLE_IDS as IDS,
  draft,
  single,
  template,
  version,
} from '../../../../testing/lifecycle-fixtures';
import { expectNotFound } from '../../../../testing/next-errors';
import { serveDiff, serveTemplateVersion } from '../../../../testing/routes/flow-builder';
import FlowPage, { metadata } from './page';

vi.mock('next/headers', () =>
  import('../../../../testing/fake-request').then((m) => m.nextHeaders),
);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const DEVELOPER: Permission[] = ['inquiry-templates:read', 'inquiry-templates:write'];

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.on('GET', `/inquiry-templates/${IDS.template}`, 200, single(template()));
});

afterEach(() => {
  api.restore();
});

const show = async (id: string = IDS.template) => {
  render(
    <ToastProvider>
      {await FlowPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) })}
    </ToastProvider>,
  );
};

describe('the template’s flow page (C155)', () => {
  it('opens the draft under the template’s sections, Flow marked as the page', async () => {
    api.me({ permissions: DEVELOPER });
    api.on('GET', '/inquiry-template-versions', 200, {
      data: [draft(), version()],
      links: { next: null },
    });
    serveTemplateVersion(api, draft());
    serveDiff(api, IDS.draft, IDS.version);

    await show();

    expect(screen.getByRole('heading', { level: 1, name: 'Flow' })).toBeVisible();
    // The draft, stored as flow-spec 1, is opened migrated and edited through the outline.
    expect(screen.getByText(/migrated to flow-spec 2/)).toBeVisible();
    expect(screen.getByRole('tree', { name: 'Outline of the flow' })).toBeVisible();
    const sections = screen.getByRole('navigation', { name: 'Template sections' });
    expect(within(sections).getByRole('link', { name: 'Flow' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByText(/Draft version 2/)).toBeVisible();
    expect(
      api.find('GET', '/inquiry-template-versions')?.query.get('filter[inquiry-template-id]'),
    ).toBe(IDS.template);
  });

  it('mounts the theme picker with the active sets, and the languages panel (C155.8)', async () => {
    api.me({ permissions: [...DEVELOPER, 'theme-sets:read'] });
    api.on('GET', '/inquiry-template-versions', 200, { data: [draft()], links: { next: null } });
    serveTemplateVersion(api, draft());
    serveDiff(api, IDS.draft, IDS.version);
    api.on('GET', '/theme-sets', 200, { data: [], links: { next: null } });

    await show();

    expect(api.find('GET', '/theme-sets')?.query.get('filter[status]')).toBe('active');
    expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0);
    expect(screen.getByText(/review/i)).toBeVisible();
  });

  it('compares the draft with the current version, as badges and as a list (C155.7)', async () => {
    api.me({ permissions: DEVELOPER });
    api.on('GET', '/inquiry-template-versions', 200, {
      data: [draft(), version()],
      links: { next: null },
    });
    serveTemplateVersion(api, draft());
    serveDiff(api, IDS.draft, IDS.version, {
      steps: { added: [], removed: ['s_old00000'], changed: [] },
    });

    await show();

    expect(
      api.find('GET', `/inquiry-template-versions/${IDS.draft}/diff`)?.query.get('against'),
    ).toBe(IDS.version);
    const compared = screen.getByRole('region', { name: 'Compared with version 1' });
    expect(compared).toHaveTextContent('Step removed: s_old00000');
  });

  it('says there is no draft, and where one is made, when the template has none', async () => {
    api.me({ permissions: DEVELOPER });
    api.on('GET', '/inquiry-template-versions', 200, { data: [version()], links: { next: null } });

    await show();

    expect(screen.getByText(/no draft/i)).toBeVisible();
    expect(screen.getByRole('link', { name: 'the overview' })).toHaveAttribute(
      'href',
      `/templates/${IDS.template}`,
    );
  });

  it('is not found for a malformed id, without calling the API', async () => {
    api.me({ permissions: DEVELOPER });

    await expectNotFound(
      FlowPage({ params: Promise.resolve({ id: 'nope' }), searchParams: Promise.resolve({}) }),
    );
    expect(api.all('GET', `/inquiry-templates/${IDS.template}`)).toEqual([]);
  });

  it('shows the forbidden panel without inquiry-templates:read', async () => {
    api.me({ permissions: ['inquiries:read'] });

    await show();

    expect(screen.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('Template flow');
  });
});
