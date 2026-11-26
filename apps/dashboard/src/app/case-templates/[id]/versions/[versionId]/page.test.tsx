import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../../components/toasts';
import { SESSION_COOKIE } from '../../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../../../testing/api-routes';
import {
  CASE_FIELD_SCHEMAS,
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
  CASE_REVIEWER,
  serveAssignmentPolicies,
  serveCaseQueues,
  serveCaseTemplate,
  serveCaseTemplateVersion,
  serveSlaPolicies,
} from '../../../../../testing/routes/cases';
import CaseTemplateVersionPage, { metadata } from './page';

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

const element = (versionId: string = CASE_IDS.draft, id: string = CASE_IDS.template) =>
  CaseTemplateVersionPage({ params: Promise.resolve({ id, versionId }) });
const page = async (versionId?: string) =>
  render(<ToastProvider>{await element(versionId)}</ToastProvider>);

describe('one case template version (C130.2, C142.1)', () => {
  it('edits a draft: fields and statuses as JSON, the moves as a grid, resolutions, SLA, attachments and modules', async () => {
    expect(metadata.title).toBe('Case template version');
    api.me({ permissions: [...CASE_DEVELOPER] });
    serveCaseTemplateVersion(
      api,
      caseTemplateVersion({
        status: 'draft',
        transitions: {
          open: ['pending'],
          pending: ['open', 'approved'],
          approved: [],
          declined: [],
        },
        slaPolicyId: CASE_IDS.slaPolicy,
      }),
    );

    await page();

    expect(screen.getByRole('heading', { level: 1, name: 'Version 2' })).toBeVisible();
    const editor = screen.getByRole('form', { name: 'Edit the draft' });
    expect(
      JSON.parse(
        within(editor).getByRole<HTMLTextAreaElement>('textbox', { name: 'Fields' }).value,
      ),
    ).toEqual(CASE_FIELD_SCHEMAS);
    expect(within(editor).getByRole('textbox', { name: 'Statuses' })).toHaveAccessibleDescription(
      /exactly one initial status and at least one end status/u,
    );
    const moves = within(editor).getByRole('group', { name: 'Allowed moves' });
    expect(within(moves).getByRole('checkbox', { name: 'From Open to Pending' })).toBeChecked();
    expect(
      within(moves).getByRole('checkbox', { name: 'From Open to Approved' }),
    ).not.toBeChecked();
    expect(within(moves).getByRole('checkbox', { name: 'From Pending to Approved' })).toBeChecked();
    expect(within(moves).queryByRole('checkbox', { name: 'From Open to Open' })).toBeNull();
    expect(within(editor).getByRole('textbox', { name: /^Resolutions/u })).toHaveValue(
      'Approved\nDeclined',
    );
    const sla = within(editor).getByRole('combobox', { name: 'SLA policy' });
    expect(sla).toHaveValue(CASE_IDS.slaPolicy);
    expect(within(sla).getByRole('option', { name: 'Synthetic four hours' })).toBeVisible();
    expect(within(editor).getByRole('combobox', { name: 'Default queue' })).toHaveValue('');
    expect(
      within(editor).getByRole('option', { name: 'Synthetic first line' }),
    ).toBeInTheDocument();
    expect(within(editor).getByRole('spinbutton', { name: /^Attachments per case/u })).toHaveValue(
      20,
    );
    const types = within(editor).getByRole('group', { name: 'Attachment types' });
    expect(within(types).getByRole('checkbox', { name: 'PDF' })).toBeChecked();
    expect(within(types).getByRole('checkbox', { name: 'WebP' })).not.toBeChecked();
    const modules = within(editor).getByRole('group', { name: 'Default modules' });
    expect(within(modules).getByRole('checkbox', { name: 'Timeline' })).toBeChecked();
    expect(within(modules).getByRole('checkbox', { name: 'Comments' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeVisible();
  });

  it('offers no publish without case-templates:publish', async () => {
    api.me({ permissions: CASE_DEVELOPER.filter((each) => each !== 'case-templates:publish') });
    serveCaseTemplateVersion(api, caseTemplateVersion({ status: 'draft' }));

    await page();

    expect(screen.getByRole('form', { name: 'Edit the draft' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
  });

  it('shows a published version read-only, every member in words', async () => {
    api.me({ permissions: CASE_REVIEWER });
    serveCaseTemplateVersion(
      api,
      caseTemplateVersion({
        transitions: { open: ['pending'], pending: [], approved: [], declined: [] },
      }),
    );

    await page(CASE_IDS.version);

    expect(screen.queryByRole('form', { name: 'Edit the draft' })).toBeNull();
    expect(screen.getByText('Published')).toBeVisible();
    const statuses = screen.getByRole('table', { name: 'Statuses' });
    const approved = within(
      within(statuses).getByRole('rowheader', { name: 'Approved' }).closest('tr') as HTMLElement,
    );
    expect(approved.getByText('End')).toBeVisible();
    expect(approved.getByText('No moves out')).toBeVisible();
    const open = within(
      within(statuses).getByRole('rowheader', { name: 'Open' }).closest('tr') as HTMLElement,
    );
    expect(open.getByText('Pending')).toBeVisible();
    expect(screen.getByText('When the case is created')).toBeVisible();
    expect(screen.getByText('JPEG, PNG, PDF; at most 20 a case')).toBeVisible();
  });

  it('answers not found for a version of another template', async () => {
    api.me({ permissions: CASE_REVIEWER });
    serveCaseTemplateVersion(api, caseTemplateVersion({ templateId: CASE_IDS.otherTemplate }));

    await expect(element(CASE_IDS.version)).rejects.toThrow();
  });
});
