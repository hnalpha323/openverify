import { REPORT_TEMPLATE_CONFIG_SCHEMAS } from '@openverify/contracts';
import { REPORT_TYPES, reportConfigDefaultValues } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { TEMPLATE_FORMS_COPY } from '../../lib/copy/template-forms';
import { jsonSchemaOf } from '../schema-form/model';
import { ToastProvider } from '../toasts';
import { CreateReportTemplateForm, ReportDraftForm } from './report-config-forms';
import { reportConfigNotes } from './report-config-model';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;
type CreateAction = (
  state: ActionState<{ path: string }>,
  formData: FormData,
) => Promise<ActionResult<{ path: string }>>;

const COPY = TEMPLATE_FORMS_COPY.reportForms;
const TEMPLATE = 'rptp_01JB0000000000000000000001';
const DRAFT = 'rptpv_01JB0000000000000000000002';
const LIST = 'lst_01JB0000000000000000000001';
const LISTS = [{ id: LIST, name: 'Synthetic watch names', kind: 'name' }];

const valueOf = (data: FormData | undefined, name = 'config'): unknown => {
  const value = data?.get(name);
  return typeof value === 'string' ? JSON.parse(value) : undefined;
};

describe('reportConfigNotes (C153.4)', () => {
  it('states the default of every key of every type, from the registry', () => {
    for (const type of REPORT_TYPES) {
      const notes = reportConfigNotes(type);
      for (const [key, value] of Object.entries(reportConfigDefaultValues(type))) {
        if (key === 'search-lists' && value === null) {
          expect(notes[key]).toBe(COPY.searchListsDefault);
        } else if (key === 'list-ids') {
          expect(notes[key]).toContain(COPY.listIdsNull);
        } else {
          expect(notes[key], `${type} ${key}`).toContain(JSON.stringify(value));
        }
      }
    }
  });
});

describe('ReportDraftForm (C153.4): a report template draft as a generated form', () => {
  function renderDraft(type: (typeof REPORT_TYPES)[number], config: Record<string, unknown>) {
    const action = vi.fn<Action>(() => Promise.resolve({ ok: true, data: undefined }));
    render(
      <ToastProvider>
        <ReportDraftForm
          reportType={type}
          templateId={TEMPLATE}
          versionId={DRAFT}
          config={config}
          lists={LISTS}
          action={action}
        />
      </ToastProvider>,
    );
    return action;
  }

  it('renders a control for every member of the type’s contract schema, for every type', () => {
    for (const type of REPORT_TYPES) {
      const { unmount } = render(
        <ToastProvider>
          <ReportDraftForm
            reportType={type}
            templateId={TEMPLATE}
            versionId={DRAFT}
            config={{}}
            lists={LISTS}
            action={vi.fn<Action>()}
          />
        </ToastProvider>,
      );
      const form = screen.getByRole('form', { name: COPY.draftForm });
      for (const member of Object.keys(
        jsonSchemaOf(REPORT_TEMPLATE_CONFIG_SCHEMAS[type]).properties ?? {},
      )) {
        expect(
          within(form).getByLabelText(member, { exact: true }),
          `${type} ${member}`,
        ).toBeInTheDocument();
      }
      unmount();
    }
  });

  it('saves the configuration as JSON with the draft’s ids, keys left empty left out', async () => {
    const action = renderDraft('watchlist', { 'screen-weak-aliases': true });

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'screen-weak-aliases' }),
      '',
    );
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'country-filter' }), 'off');
    await userEvent.click(screen.getByRole('button', { name: COPY.save }));

    const data = action.mock.calls[0]?.[1];
    expect(data?.get('report-template-id')).toBe(TEMPLATE);
    expect(data?.get('version-id')).toBe(DRAFT);
    expect(valueOf(data)).toEqual({ 'country-filter': 'off' });
    expect(await screen.findByText(COPY.saved)).toBeVisible();
  });

  it('picks a custom-list template’s lists, or says each report names its own', async () => {
    const action = renderDraft('custom-list', { 'list-ids': null });

    const picker = screen.getByRole('radiogroup', { name: 'list-ids' });
    expect(picker).toHaveAccessibleDescription(expect.stringContaining(COPY.listIdsNull));
    expect(within(picker).queryByRole('checkbox', { name: 'list-ids: none' })).toBeNull();
    expect(within(picker).getByRole('radio', { name: COPY.listIdsMode.own })).toBeChecked();
    await userEvent.click(within(picker).getByRole('radio', { name: COPY.listIdsMode.chosen }));
    await userEvent.click(
      within(picker).getByRole('checkbox', { name: 'Synthetic watch names (name)' }),
    );
    await userEvent.click(screen.getByRole('button', { name: COPY.save }));

    expect(valueOf(action.mock.calls[0]?.[1])).toEqual({ 'list-ids': [LIST] });
  });
});

describe('CreateReportTemplateForm (C153.4, K14)', () => {
  it('creates a template of a chosen type with a name and a generated configuration', async () => {
    const action = vi.fn<CreateAction>(() =>
      Promise.resolve({ ok: true, data: { path: `/report-templates/${TEMPLATE}` } }),
    );
    render(
      <ToastProvider>
        <CreateReportTemplateForm action={action} lists={LISTS} />
      </ToastProvider>,
    );

    const form = screen.getByRole('form', { name: COPY.newTitle });
    await userEvent.type(
      within(form).getByRole('textbox', { name: COPY.name }),
      'Synthetic screening',
    );
    await userEvent.selectOptions(
      within(form).getByRole('combobox', { name: COPY.type }),
      'email-address',
    );
    expect(within(form).getByLabelText('min-domain-age-days')).toBeInTheDocument();
    expect(within(form).queryByLabelText('search-lists')).toBeNull();
    await userEvent.type(within(form).getByRole('textbox', { name: 'min-domain-age-days' }), '30');
    await userEvent.click(within(form).getByRole('button', { name: COPY.create }));

    const data = action.mock.calls[0]?.[1];
    expect(data?.get('name')).toBe('Synthetic screening');
    expect(data?.get('report-type')).toBe('email-address');
    expect(valueOf(data)).toEqual({ 'min-domain-age-days': 30 });
  });

  it('offers every report type the contract takes, and nothing else', () => {
    render(
      <ToastProvider>
        <CreateReportTemplateForm action={vi.fn<CreateAction>()} lists={[]} />
      </ToastProvider>,
    );

    const type = screen.getByRole('combobox', { name: COPY.type });
    expect(
      within(type)
        .getAllByRole('option')
        .map((option) => option.getAttribute('value')),
    ).toEqual([...REPORT_TYPES]);
  });
});
