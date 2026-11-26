import type { Component, ScreenClientView } from '@openverify/flow-spec';
import { screen as view, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test-utils';
import { ScreenStep, type ScreenSubmission } from './screen-step';

const TEXTS: Readonly<Record<string, string>> = {
  'details.title.body': 'A few more details',
  'details.intro.body': 'We need these to finish.\nIt takes a minute.',
  'details.name.label': 'First name',
  'details.name.hint': 'As on your ID',
  'details.code.label': 'Member code',
  'details.pet.label': 'Do you have a pet?',
  'details.pet.yes': 'Yes',
  'details.pet.no': 'No',
  'details.pet_name.label': "Your pet's name",
  'details.tax.label': 'Tax number',
  'details.continue.button': 'Continue',
  'details.skip.button': 'Skip this',
  'details.cancel.button': 'Stop for now',
};

const copy = (key: string) => TEXTS[key] ?? null;

function step(components: Component[]): ScreenClientView {
  return { id: 'details', type: 'screen', components };
}

const title: Component = {
  id: 'title',
  kind: 'text',
  variant: 'title',
  copyKey: 'details.title.body',
};
const intro: Component = {
  id: 'intro',
  kind: 'text',
  variant: 'body',
  copyKey: 'details.intro.body',
};
const name: Component = {
  id: 'name',
  kind: 'text_input',
  field: 'name_first',
  labelKey: 'details.name.label',
  hintKey: 'details.name.hint',
  required: true,
};
const code: Component = {
  id: 'code',
  kind: 'text_input',
  field: 'member_code',
  labelKey: 'details.code.label',
  pattern: '[A-Z]{2}\\d{3}',
};
const pet: Component = {
  id: 'pet',
  kind: 'radio_group',
  field: 'has_pet',
  labelKey: 'details.pet.label',
  options: [
    { key: 'o1', value: 'yes', labelKey: 'details.pet.yes' },
    { key: 'o2', value: 'no', labelKey: 'details.pet.no' },
  ],
};
const petName: Component = {
  id: 'pet_name',
  kind: 'text_input',
  field: 'pet_name',
  labelKey: 'details.pet_name.label',
  required: true,
  visibleWhen: { '===': [{ var: 'screen.has_pet' }, 'yes'] },
};
const tax: Component = {
  id: 'tax',
  kind: 'masked_text',
  field: 'tax_number',
  labelKey: 'details.tax.label',
};
const submit: Component = {
  id: 'continue',
  kind: 'button',
  labelKey: 'details.continue.button',
  action: 'submit',
};
const skip: Component = {
  id: 'skip',
  kind: 'button',
  labelKey: 'details.skip.button',
  action: 'submit',
  port: 'skip',
};

function renderScreen(
  components: Component[],
  props: Partial<Parameters<typeof ScreenStep>[0]> = {},
) {
  const onSubmit = vi.fn<(submission: ScreenSubmission) => Promise<void>>(() => Promise.resolve());
  const result = renderWithI18n(
    <ScreenStep step={step(components)} copy={copy} onSubmit={onSubmit} {...props} />,
  );
  return { ...result, onSubmit };
}

describe('ScreenStep (C148)', () => {
  it('renders operator text as plain text, the first title as the heading', () => {
    renderScreen([title, intro, submit]);

    expect(view.getByRole('heading', { level: 1, name: 'A few more details' })).toBeInTheDocument();
    expect(view.getByText(/We need these to finish\./u)).toHaveClass('whitespace-pre-line');
  });

  it('labels each field from its copy key, with its hint as its description', () => {
    renderScreen([name, submit]);

    const field = view.getByRole('textbox', { name: 'First name' });
    expect(field).toHaveAccessibleDescription('As on your ID');
    expect(field).toBeRequired();
  });

  it('shows a value the session holds, and one it never sends back as already provided (3.3.7)', () => {
    renderScreen([name, tax, submit], { values: { name_first: 'Sam', tax_number: { set: true } } });

    expect(view.getByRole('textbox', { name: 'First name' })).toHaveValue('Sam');
    expect(view.getByLabelText('Tax number')).toHaveValue('');
    expect(view.getByLabelText('Tax number')).toHaveAccessibleDescription(/Already provided/u);
  });

  it('shows and hides a component as the person answers, through the strict evaluator', async () => {
    const user = userEvent.setup();
    renderScreen([pet, petName, submit]);

    expect(view.queryByRole('textbox', { name: "Your pet's name" })).not.toBeInTheDocument();
    await user.click(view.getByRole('radio', { name: 'Yes' }));
    expect(view.getByRole('textbox', { name: "Your pet's name" })).toBeInTheDocument();
  });

  it('summarises the errors at the top on submit and links each to its field', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderScreen([name, code, submit]);

    await user.type(view.getByRole('textbox', { name: 'Member code' }), 'ab1');
    await user.click(view.getByRole('button', { name: 'Continue' }));

    const summary = view.getByRole('alert');
    expect(within(summary).getByRole('link', { name: 'First name' })).toHaveAttribute(
      'href',
      `#${view.getByRole('textbox', { name: 'First name' }).id}`,
    );
    expect(view.getByRole('textbox', { name: 'Member code' })).toHaveAccessibleDescription(
      'This is not in the expected format.',
    );
    expect(view.getByRole('textbox', { name: 'First name' })).toBeInvalid();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits the visible values and the pressed button key (C148.5)', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderScreen([name, pet, petName, submit, skip]);

    await user.type(view.getByRole('textbox', { name: 'First name' }), 'Sam');
    await user.click(view.getByRole('radio', { name: 'No' }));
    await user.click(view.getByRole('button', { name: 'Skip this' }));

    expect(onSubmit).toHaveBeenCalledWith({
      values: { name_first: 'Sam', has_pet: 'no' },
      button: 'skip',
    });
  });

  it('submits through the primary button without a key', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderScreen([name, submit]);

    await user.type(view.getByRole('textbox', { name: 'First name' }), 'Sam');
    await user.click(view.getByRole('button', { name: 'Continue' }));

    expect(onSubmit).toHaveBeenCalledWith({ values: { name_first: 'Sam' } });
  });

  it('normalises Arabic-Indic digits as they are typed (C161.4)', async () => {
    const user = userEvent.setup();
    renderScreen([code, submit]);

    await user.type(view.getByRole('textbox', { name: 'Member code' }), 'AB١٢٣');

    expect(view.getByRole('textbox', { name: 'Member code' })).toHaveValue('AB123');
  });

  it('says it cannot show a screen whose rule is outside the strict subset, never guessing', () => {
    renderScreen([{ ...name, visibleWhen: { '>': [{ var: 'screen.age' }, 1] } }, submit]);

    expect(view.getByText('This screen cannot be shown in this version.')).toBeInTheDocument();
    expect(view.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('asks before a cancel button stops, and goes back on No', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderScreen(
      [
        name,
        { id: 'stop', kind: 'button', labelKey: 'details.cancel.button', action: 'cancel' },
        submit,
      ],
      { onCancel },
    );

    await user.click(view.getByRole('button', { name: 'Stop for now' }));
    await user.click(view.getByRole('button', { name: 'No, keep going' }));
    expect(onCancel).not.toHaveBeenCalled();
    await user.click(view.getByRole('button', { name: 'Stop for now' }));
    await user.click(view.getByRole('button', { name: 'Yes, stop for now' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
