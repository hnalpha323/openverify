import type { Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeApi, type RouteApi } from '../../../../../testing/api-routes';
import {
  LIFECYCLE_IDS as IDS,
  draft,
  single,
  template,
  version,
} from '../../../../../testing/lifecycle-fixtures';
import { ToastProvider } from '../../../../../components/toasts';
import { SESSION_COOKIE } from '../../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../../testing/api-fixtures';
import { fakeRequest } from '../../../../../testing/fake-request';
import { expectNotFound } from '../../../../../testing/next-errors';
import VersionPage, { metadata } from './page';

vi.mock('next/headers', () =>
  import('../../../../../testing/fake-request').then((m) => m.nextHeaders),
);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

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
  api.on('GET', `/inquiry-templates/${IDS.template}`, 200, single(template()));
  api.on('GET', `/inquiry-template-versions/${IDS.draft}`, 200, single(draft()));
  api.on('GET', `/inquiry-template-versions/${IDS.version}`, 200, single(version()));
});

afterEach(() => {
  api.restore();
});

const page = (versionId: string = IDS.draft, id: string = IDS.template) =>
  VersionPage({ params: Promise.resolve({ id, versionId }) });

async function renderVersion(versionId: string = IDS.draft) {
  render(<ToastProvider>{await page(versionId)}</ToastProvider>);
}

describe('template version page', () => {
  it('edits a draft as JSON: flow, verification config and settings', async () => {
    await renderVersion();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Version 2');
    expect(screen.getByText('Draft', { selector: '[data-status]' })).toBeVisible();
    const editor = screen.getByRole('form', { name: 'Edit the draft' });
    const flow = within(editor).getByRole<HTMLTextAreaElement>('textbox', { name: 'Flow' });
    expect(JSON.parse(flow.value)).toMatchObject({
      metadata: { id: 'default-gov-id-selfie' },
    });
    expect(within(editor).getByRole('textbox', { name: 'Verification config' })).toBeVisible();
    expect(
      JSON.parse(
        within(editor).getByRole<HTMLTextAreaElement>('textbox', { name: 'Settings' }).value,
      ),
    ).toEqual({
      'inquiry-expiration-seconds': 86_400,
      'session-expiration-seconds': 86_400,
      'one-time-link-expiration-seconds': 86_400,
      'retention-days': null,
      'max-sessions': 25,
      'expire-inquiry-on-session-limit': false,
    });
    expect(within(editor).getByRole('button', { name: 'Save draft' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeVisible();
  });

  it('offers no publish without inquiry-templates:publish', async () => {
    api.me({ permissions: ['inquiry-templates:read', 'inquiry-templates:write'] });

    await renderVersion();

    expect(screen.getByRole('form', { name: 'Edit the draft' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
  });

  it('shows a draft read-only without inquiry-templates:write', async () => {
    api.me({ permissions: ['inquiry-templates:read'] });

    await renderVersion();

    expect(screen.queryByRole('form', { name: 'Edit the draft' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Flow' })).toHaveTextContent('default-gov-id-selfie');
  });

  it('shows a published version read-only, with when it was published', async () => {
    await renderVersion(IDS.version);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Version 1');
    expect(screen.queryByRole('form', { name: 'Edit the draft' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
    expect(screen.getByText('Published (UTC)').nextElementSibling).toHaveTextContent(
      'Oct 20, 2026',
    );
    expect(screen.getByRole('region', { name: 'Settings' })).toHaveTextContent(
      'inquiry-expiration-seconds',
    );
  });

  it('lets a keyboard scroll each JSON block of a published version (WCAG 2.1.1; the 9C console axe sweep)', async () => {
    await renderVersion(IDS.version);

    for (const name of ['Flow as JSON', 'Settings as JSON']) {
      expect(screen.getByRole('region', { name })).toHaveAttribute('tabindex', '0');
    }
  });

  it('links its preview, so a draft is previewed from its editor (C156; requested by dashboard-preview)', async () => {
    await renderVersion();

    expect(screen.getByRole('link', { name: 'Preview this version' })).toHaveAttribute(
      'href',
      `/templates/${IDS.template}/preview?version=${IDS.draft}`,
    );
  });

  it('leads back to the template', async () => {
    await renderVersion();

    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(
      within(breadcrumb).getByRole('link', { name: 'Synthetic ID and selfie' }),
    ).toHaveAttribute('href', `/templates/${IDS.template}`);
  });

  it('is not found when the version belongs to another template', async () => {
    await expectNotFound(page(IDS.draft, 'itmpl_01JB0000000000000000000009'));
  });

  it('is not found for a malformed version id, without calling the API', async () => {
    await expectNotFound(page('itmplv_x'));

    expect(api.requests).toHaveLength(0);
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('Template version');
  });
});
