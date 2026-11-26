/**
 * C172 on the case page: the checklist section read through `GET /cases/:id/checklist` only when
 * the pinned version has a checklist; the version's layout arranging the modules; each case action
 * in its placement only; the preset comments beside the comment box.
 */
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/toasts';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import {
  NOW,
  REVIEWER_IDS as IDS,
  availableActions,
  caseTemplateVersion,
} from '../../../testing/reviewer-fixtures';
import {
  checklistPath,
  checklistState,
  serveChecklist,
} from '../../../testing/routes/cases-reports';
import {
  CASE_PATH,
  CASE_REVIEWER,
  serveCase,
  serveHeldObjects,
  serveModules,
} from '../../../testing/routes/reviewer';
import CasePage from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@panzoom/panzoom', async () => {
  const entry = '@panzoom/panzoom/dist/panzoom.es.js';
  return (await import(/* @vite-ignore */ entry)) as typeof import('@panzoom/panzoom');
});
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

let api: RouteApi;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: [...CASE_REVIEWER] });
});

afterEach(() => {
  api.restore();
  vi.useRealTimers();
});

const COMPLETED = caseTemplateVersion({
  checklists: [
    {
      key: 'kyc',
      label: 'Identity review',
      items: [{ key: 'id-seen', label: 'Document seen', 'required-for-statuses': ['approved'] }],
    },
  ],
  presetComments: [{ key: 'docs', label: 'Asked for documents', text: 'We asked for a document.' }],
  layout: {
    columns: 2,
    modules: [
      { key: 'comments', column: 1, order: 0, collapsed: false },
      { key: 'timeline', column: 2, order: 0, collapsed: true },
    ],
  },
});

function placed(id: string, placement: string) {
  const base = availableActions().data[0];
  if (base === undefined) throw new Error('fixture');
  return {
    ...base,
    id,
    attributes: { ...base.attributes, label: `Action ${placement}`, placement },
  };
}

async function renderCase() {
  const page = await CasePage({
    params: Promise.resolve({ id: IDS.case }),
    searchParams: Promise.resolve({}),
  });
  render(<ToastProvider>{page}</ToastProvider>);
}

describe('the case page’s completions (C172)', () => {
  it('reads the checklist for a version with one and shows who checked each item', async () => {
    serveCase(api, { version: COMPLETED });
    serveHeldObjects(api);
    serveModules(api);
    serveChecklist(api, checklistState([{ checklist: 'kyc', item: 'id-seen', by: IDS.me }]));

    await renderCase();

    const section = within(screen.getByRole('region', { name: 'Checklists' }));
    expect(section.getByRole('group', { name: 'Identity review' })).toBeVisible();
    expect(section.getByRole('button', { name: 'Uncheck Document seen' })).toBeVisible();
  });

  it('reads no checklist for a version without one', async () => {
    serveCase(api);
    serveHeldObjects(api);
    serveModules(api);

    await renderCase();

    expect(api.find('GET', checklistPath())).toBeUndefined();
    expect(screen.queryByRole('region', { name: 'Checklists' })).toBeNull();
  });

  it('arranges the modules in the version’s columns, a collapsed one closed, and leaves out what the layout does not place', async () => {
    serveCase(api, { version: COMPLETED });
    serveHeldObjects(api);
    serveModules(api);
    serveChecklist(api, checklistState([]));

    await renderCase();

    expect(
      within(screen.getByRole('region', { name: 'Column 1' })).getByRole('region', {
        name: 'Comments',
      }),
    ).toBeVisible();
    const second = screen.getByRole('region', { name: 'Column 2' });
    expect(second.querySelector('details')?.open).toBe(false);
    expect(screen.queryByRole('region', { name: 'Held objects' })).toBeNull();
  });

  it('shows each case action in its placement only, and a preset comment beside the box', async () => {
    serveCase(api, { version: COMPLETED });
    serveHeldObjects(api);
    serveModules(api);
    serveChecklist(api, checklistState([]));
    api.on('GET', `${CASE_PATH}/available-actions`, 200, {
      data: [
        placed('cact_01JE00000000000000000000H1', 'header'),
        placed('cact_01JE00000000000000000000S1', 'status-switcher'),
        placed('cact_01JE00000000000000000000M1', 'module:comments'),
      ],
      links: { next: null },
    });

    await renderCase();

    const header = within(screen.getByRole('region', { name: 'Case actions' }));
    expect(header.getByRole('group', { name: 'Action header' })).toBeVisible();
    expect(header.queryByRole('group', { name: 'Action status-switcher' })).toBeNull();
    expect(header.queryByRole('group', { name: 'Action module:comments' })).toBeNull();
    expect(
      within(screen.getByRole('region', { name: 'Status' })).getByRole('group', {
        name: 'Action status-switcher',
      }),
    ).toBeVisible();
    const comments = within(screen.getByRole('region', { name: 'Comments' }));
    expect(comments.getByRole('group', { name: 'Action module:comments' })).toBeVisible();
    expect(comments.getByRole('combobox', { name: 'Preset comment' })).toBeVisible();
  });
});
