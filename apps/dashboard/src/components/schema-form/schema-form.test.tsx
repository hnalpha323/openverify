import { templateSettingsSchema } from '@openverify/contracts';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { TEMPLATE_FORMS_COPY } from '../../lib/copy/template-forms';
import { jsonSchemaOf } from './model';
import { SchemaForm, type SchemaFormProps, type SchemaWidgetProps } from './schema-form';

const COPY = TEMPLATE_FORMS_COPY.schemaForm;

const SCHEMA = z.strictObject({
  name: z.string().max(40).optional(),
  seconds: z.int().min(300).max(2_592_000).optional(),
  days: z.int().min(1).max(3650).nullable().optional(),
  on: z.boolean().optional(),
  mode: z.enum(['all', 'none']).optional(),
  lists: z.array(z.string()).optional(),
});

type Value = Readonly<Record<string, unknown>>;

/** The form with its value held, as a page holds it; `seen` gets every change. */
function Holder({
  initial = {},
  seen,
  ...rest
}: Partial<SchemaFormProps> & { initial?: Value; seen?: (value: Value) => void }) {
  const [value, setValue] = useState<Value>(initial);
  return (
    <SchemaForm
      legend="Synthetic member"
      schema={SCHEMA}
      {...rest}
      value={value}
      onChange={(next) => {
        setValue(next);
        seen?.(next);
      }}
    />
  );
}

const group = () => screen.getByRole('group', { name: 'Synthetic member' });

describe('SchemaForm (C153.1): a form generated from a contract schema', () => {
  it('renders a labelled control for every member of the schema, none written by hand', () => {
    render(<Holder schema={templateSettingsSchema} />);

    const members = Object.keys(jsonSchemaOf(templateSettingsSchema).properties ?? {});
    expect(members.length).toBeGreaterThan(7);
    for (const member of members) {
      expect(within(group()).getByLabelText(member, { exact: true })).toBeInTheDocument();
    }
  });

  it('offers only the values the contract takes: a boolean’s Not set, Yes, No, and an enum’s values', () => {
    render(<Holder />);

    const on = within(group()).getByRole('combobox', { name: 'on' });
    expect(
      within(on)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([COPY.notSet, COPY.yes, COPY.no]);
    const mode = within(group()).getByRole('combobox', { name: 'mode' });
    expect(
      within(mode)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([COPY.notSet, 'all', 'none']);
  });

  it('applies a typed value, and leaves a member out when its control is emptied', async () => {
    const seen = vi.fn<(value: Value) => void>();
    render(<Holder initial={{ seconds: 600 }} seen={seen} />);

    const seconds = within(group()).getByRole('textbox', { name: 'seconds' });
    expect(seconds).toHaveValue('600');
    await userEvent.clear(seconds);
    expect(seen).toHaveBeenLastCalledWith({});
    await userEvent.type(seconds, '3600');
    expect(seen).toHaveBeenLastCalledWith({ seconds: 3600 });
    await userEvent.selectOptions(within(group()).getByRole('combobox', { name: 'on' }), 'false');
    expect(seen).toHaveBeenLastCalledWith({ seconds: 3600, on: false });
  });

  it('says at its field why the contract refuses a value, and keeps the text as typed', async () => {
    render(<Holder />);

    const seconds = within(group()).getByRole('textbox', { name: 'seconds' });
    await userEvent.type(seconds, '60');

    expect(seconds).toHaveAttribute('aria-invalid', 'true');
    expect(seconds).toHaveAccessibleDescription(/300/);
    expect(seconds).toHaveValue('60');

    await userEvent.clear(seconds);
    await userEvent.type(seconds, 'soon');
    expect(seconds).toHaveAccessibleDescription(/Enter a whole number/);
  });

  it('sets a nullable member to none, which is not the same as leaving it out', async () => {
    const seen = vi.fn<(value: Value) => void>();
    render(<Holder initial={{ days: 30 }} seen={seen} />);

    const none = within(group()).getByRole('checkbox', { name: COPY.none('days') });
    expect(none).toHaveAccessibleDescription(COPY.noneHint);
    await userEvent.click(none);

    expect(seen).toHaveBeenLastCalledWith({ days: null });
    expect(within(group()).getByRole('textbox', { name: 'days' })).toBeDisabled();
    await userEvent.click(none);
    expect(seen).toHaveBeenLastCalledWith({ days: 30 });
  });

  it('edits anything else as JSON, and says when the JSON does not parse', () => {
    const seen = vi.fn<(value: Value) => void>();
    render(<Holder seen={seen} />);

    const lists = within(group()).getByRole('textbox', { name: 'lists' });
    fireEvent.change(lists, { target: { value: '["a", "b"]' } });
    expect(seen).toHaveBeenLastCalledWith({ lists: ['a', 'b'] });
    fireEvent.change(lists, { target: { value: '["a",' } });
    expect(lists).toHaveAccessibleDescription(/Enter JSON/);
  });

  it('renders a member through its widget override instead of the generated control', async () => {
    const seen = vi.fn<(value: Value) => void>();
    function ModeWidget({ id, value, onValue, describedBy }: SchemaWidgetProps) {
      return (
        <button
          id={id}
          type="button"
          aria-describedby={describedBy}
          onClick={() => {
            onValue(value === 'all' ? 'none' : 'all');
          }}
        >
          Toggle mode
        </button>
      );
    }
    render(<Holder seen={seen} widgets={{ mode: ModeWidget }} />);

    expect(within(group()).queryByRole('combobox', { name: 'mode' })).toBeNull();
    // The field's label names the widget.
    await userEvent.click(within(group()).getByRole('button', { name: 'mode' }));
    expect(seen).toHaveBeenLastCalledWith({ mode: 'all' });
  });

  it('describes a field with its note, and shows the API’s errors at their fields', () => {
    render(
      <Holder
        notes={{ seconds: 'Below 20 hours: a synthetic warning.' }}
        errors={[
          { pointer: '/name', detail: 'a synthetic refusal' },
          { pointer: '', detail: 'the whole member is refused' },
        ]}
      />,
    );

    expect(within(group()).getByRole('textbox', { name: 'seconds' })).toHaveAccessibleDescription(
      /Below 20 hours: a synthetic warning\./,
    );
    const name = within(group()).getByRole('textbox', { name: 'name' });
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription(/a synthetic refusal/);
    expect(within(group()).getByText(/the whole member is refused/)).toBeVisible();
  });

  it('shows the values read-only, with no control', () => {
    render(
      <SchemaForm
        legend="Synthetic member"
        schema={SCHEMA}
        value={{ seconds: 600, days: null, on: true }}
        readOnly
      />,
    );

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    const terms = screen.getAllByRole('term').map((term) => term.textContent);
    const values = screen.getAllByRole('definition').map((value) => value.textContent);
    expect(Object.fromEntries(terms.map((term, index) => [term, values[index]]))).toEqual({
      name: COPY.readOnlyNotSet,
      seconds: '600',
      days: COPY.readOnlyNone,
      on: COPY.yes,
      mode: COPY.readOnlyNotSet,
      lists: COPY.readOnlyNotSet,
    });
  });
});
