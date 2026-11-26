import { screenStepSchema, type ScreenStep } from '@openverify/flow-spec';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ScreenEditor } from './screen-editor';

/** A title, a container holding a checkbox and a middle-name field, and a continue button. */
function details(): ScreenStep {
  return screenStepSchema.parse({
    id: 's_screen00',
    type: 'screen',
    name: 'Your details',
    components: [
      { id: 'title', kind: 'text', variant: 'title', copyKey: 's_screen00.title.title' },
      {
        id: 'group',
        kind: 'container',
        direction: 'vertical',
        children: [
          { id: 'has', kind: 'checkbox', field: 'has_middle', labelKey: 's_screen00.has.label' },
          {
            id: 'middle',
            kind: 'text_input',
            field: 'name_middle',
            labelKey: 's_screen00.middle.label',
          },
        ],
      },
      { id: 'continue', kind: 'button', labelKey: 'screen.continue', action: 'submit' },
    ],
  });
}

const FIELDS = [
  { key: 'has_middle', type: 'boolean', pii: false },
  { key: 'name_middle', type: 'string', pii: true },
  { key: 'email_address', type: 'string', pii: true },
];

function show() {
  const onChange = vi.fn();
  render(<ScreenEditor step={details()} fields={FIELDS} editable onChange={onChange} />);
  const last = () => onChange.mock.calls.at(-1) as [ScreenStep, string] | undefined;
  return { onChange, last, user: userEvent.setup() };
}

const actionsOf = (id: string) => screen.getByRole('group', { name: `Actions for ${id}` });

// K9-4 (C155.5): the screen editor, outline and keyboard first; every move has a button, never a
// drag only (2.5.7), and every change is the format's own (C155.6).
describe('the screen editor’s component list (C155.5)', () => {
  it('lists the components in order with their nesting, each with its actions', async () => {
    const { last, user } = show();

    const list = screen.getByRole('list', { name: 'Components of the screen' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((row) => row.firstChild?.textContent),
    ).toEqual([
      'Text title',
      'Container group',
      'Checkbox has, inside a container (level 2)',
      'Text input middle, inside a container (level 2)',
      'Button continue',
    ]);
    expect(within(actionsOf('title')).getByRole('button', { name: 'Move up' })).toBeDisabled();
    expect(
      within(actionsOf('title')).getByRole('button', { name: 'Into the container before it' }),
    ).toBeDisabled();

    await user.click(
      within(actionsOf('continue')).getByRole('button', { name: 'Into the container before it' }),
    );
    expect(last()?.[1]).toBe('Moved the component continue.');
    const group = last()?.[0].components[1];
    expect(group?.kind === 'container' ? group.children.map((child) => child.id) : []).toEqual([
      'has',
      'middle',
      'continue',
    ]);
  });

  it('adds a component from the library, bound to the first field the screen does not fill yet', async () => {
    const { last, user } = show();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Kind' }), 'email');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(last()?.[0].components.at(-1)).toMatchObject({ kind: 'email', field: 'email_address' });
    expect(
      within(screen.getByRole('combobox', { name: 'Kind' })).getByRole('option', { name: /Image/ }),
    ).toBeDisabled();
  });
});

describe('a component’s Data, Logic and Design tabs (C155.5)', () => {
  it('binds the field and marks it required in Data', async () => {
    const { last, user } = show();

    await user.click(within(actionsOf('middle')).getByRole('button', { name: 'Edit' }));
    const tabs = screen.getByRole('tablist', { name: 'Component settings' });
    expect(within(tabs).getByRole('tab', { name: 'Data' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const panel = screen.getByRole('tabpanel', { name: 'Data' });
    const field = within(panel).getByRole('combobox', { name: 'Field it fills' });
    expect(field).toHaveValue('name_middle');
    await user.click(within(panel).getByRole('checkbox', { name: 'Required' }));

    const group = last()?.[0].components[1];
    expect(group?.kind === 'container' ? group.children[1] : null).toMatchObject({
      id: 'middle',
      required: true,
    });
  });

  it('writes a visibility rule over the screen’s own fields in Logic', async () => {
    const { last, user } = show();

    await user.click(within(actionsOf('middle')).getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('tab', { name: 'Logic' }));
    const rule = screen.getByRole('region', { name: 'Show middle when' });
    await user.click(within(rule).getByRole('button', { name: 'Add a comparison' }));

    const group = last()?.[0].components[1];
    expect(group?.kind === 'container' ? group.children[1]?.visibleWhen : null).toEqual({
      '===': [{ var: 'screen.has_middle' }, true],
    });
    expect(within(rule).queryByRole('combobox', { name: /unknown/ })).toBeNull();
  });

  it('says in Design where a component’s look comes from', async () => {
    const { user } = show();

    await user.click(within(actionsOf('middle')).getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('tab', { name: 'Design' }));

    expect(screen.getByRole('tabpanel', { name: 'Design' })).toHaveTextContent(
      /no style of its own.*theme set/,
    );
  });
});
