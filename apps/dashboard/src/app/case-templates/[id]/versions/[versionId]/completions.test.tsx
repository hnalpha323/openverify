/**
 * C172.1 to C172.4 on the case template version page: a draft's editor gains the layout editor and
 * the checklists and preset comments editor; any other version shows its layout, checklists,
 * preset comments and each status's required fields in words.
 */
import type { CaseTemplateVersionResource } from '@openverify/contracts';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../../components/toasts';
import { SESSION_COOKIE } from '../../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../../../testing/api-routes';
import {
  CASE_IDS,
  assignmentPolicy,
  caseQueue,
  caseTemplate,
  caseTemplateVersion,
  slaPolicy,
} from '../../../../../testing/cases-fixtures';
import { fakeRequest } from '../../../../../testing/fake-request';
import {
  CASE_DEVELOPER,
  CASE_VIEWER,
  serveAssignmentPolicies,
  serveCaseQueues,
  serveCaseTemplate,
  serveCaseTemplateVersion,
  serveSlaPolicies,
} from '../../../../../testing/routes/cases';
import CaseTemplateVersionPage from './page';

vi.mock('next/headers', () =>
  import('../../../../../testing/fake-request').then((m) => m.nextHeaders),
);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  serveCaseTemplate(api, caseTemplate({ draftVersion: 2 }));
  serveCaseQueues(api, [caseQueue()]);
  serveAssignmentPolicies(api, [assignmentPolicy()]);
  serveSlaPolicies(api, [slaPolicy()]);
});

afterEach(() => {
  api.restore();
});

function completed(status: 'draft' | 'published'): CaseTemplateVersionResource {
  const version = caseTemplateVersion({ status });
  const [first, ...rest] = version.attributes.statuses;
  if (first === undefined) throw new Error('fixture');
  return {
    ...version,
    attributes: {
      ...version.attributes,
      statuses: [{ ...first, 'requires-fields': ['full-name'] }, ...rest],
      layout: {
        columns: 2,
        modules: [{ key: 'comments', column: 2, order: 0, collapsed: true }],
      },
      checklists: [
        {
          key: 'kyc',
          label: 'Identity review',
          items: [{ key: 'id-seen', label: 'Document seen', 'required-for-statuses': [] }],
        },
      ],
      'preset-comments': [
        { key: 'docs', label: 'Asked for documents', text: 'We asked for a document.' },
      ],
    },
  };
}

const show = async (versionId: string) =>
  render(
    <ToastProvider>
      {await CaseTemplateVersionPage({
        params: Promise.resolve({ id: CASE_IDS.template, versionId }),
      })}
    </ToastProvider>,
  );

describe('the case template version’s completions (C172)', () => {
  it('edits a draft’s layout and its checklists and preset comments, each with its own save', async () => {
    api.me({ permissions: [...CASE_DEVELOPER] });
    serveCaseTemplateVersion(api, completed('draft'));

    await show(CASE_IDS.draft);

    const layout = within(screen.getByRole('region', { name: 'Case page layout' }));
    expect(layout.getByRole('list', { name: 'Column 2' })).toHaveTextContent('Comments');
    expect(layout.getByRole('button', { name: 'Save layout' })).toBeVisible();
    const checklists = within(
      screen.getByRole('region', { name: 'Checklists and preset comments' }),
    );
    expect(checklists.getByRole('textbox', { name: 'Preset comments' })).toHaveDisplayValue(
      /We asked for a document\./,
    );
  });

  it('shows a published version’s layout, checklists, preset comments and required fields in words', async () => {
    api.me({ permissions: [...CASE_VIEWER] });
    serveCaseTemplateVersion(api, completed('published'));

    await show(CASE_IDS.version);

    expect(screen.queryByRole('button', { name: 'Save layout' })).toBeNull();
    expect(screen.getByText('2 columns: Comments in column 2 (collapsed at first)')).toBeVisible();
    expect(screen.getByRole('table', { name: 'Checklists' })).toHaveTextContent('Document seen');
    expect(screen.getByRole('table', { name: 'Preset comments' })).toHaveTextContent(
      'We asked for a document.',
    );
    expect(screen.getByRole('table', { name: 'Statuses' })).toHaveTextContent('full-name');
  });
});
