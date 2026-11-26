import { COMPONENT_KINDS, type Component, type ScreenClientView } from '@openverify/flow-spec';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test-utils';
import { SCREEN_COMPONENTS } from './screen-components';
import { ScreenStep, type ScreenSubmission } from './screen-step';

// C148.2, C148.7: every kind of the catalogue, each with a visible label from its copy key and the
// built-in behaviour (WCAG 2.2) whatever the operator configured.

const copy = (key: string): string | null => (key.startsWith('x.') ? `Text of ${key}` : null);

const option = (key: string, value: string) => ({ key, value, labelKey: `x.${key}` });

const EVERY_KIND: Component[] = [
  { id: 'title', kind: 'text', variant: 'title', copyKey: 'x.title' },
  { id: 'caption', kind: 'text', variant: 'caption', copyKey: 'x.caption' },
  {
    id: 'logo',
    kind: 'image',
    assetId: 'tsa_01M5CJXHG07XPHF3HRM6NREDH7',
    altKey: 'x.logo',
    decorative: false,
  },
  { id: 'gap', kind: 'spacer', size: 'm' },
  { id: 'steps', kind: 'stepper', labelKeys: ['x.one', 'x.two'], current: 1 },
  {
    id: 'row',
    kind: 'container',
    direction: 'horizontal',
    children: [
      { id: 'name', kind: 'text_input', field: 'name', labelKey: 'x.name' },
      { id: 'notes', kind: 'text_area', field: 'notes', labelKey: 'x.notes' },
    ],
  },
  { id: 'age', kind: 'number', field: 'age', labelKey: 'x.age' },
  { id: 'birth', kind: 'date', field: 'birthdate', labelKey: 'x.birth' },
  { id: 'mail', kind: 'email', field: 'email', labelKey: 'x.mail' },
  { id: 'tel', kind: 'phone', field: 'phone', labelKey: 'x.tel', allowedCountries: ['US'] },
  { id: 'site', kind: 'url', field: 'site', labelKey: 'x.site' },
  { id: 'secret', kind: 'masked_text', field: 'secret', labelKey: 'x.secret' },
  {
    id: 'colour',
    kind: 'select',
    field: 'colour',
    labelKey: 'x.colour',
    options: [option('red', 'r'), option('blue', 'b')],
  },
  {
    id: 'size',
    kind: 'radio_group',
    field: 'size',
    labelKey: 'x.size',
    options: [option('small', 's'), option('large', 'l')],
  },
  { id: 'agree', kind: 'checkbox', field: 'agree', labelKey: 'x.agree' },
  {
    id: 'pets',
    kind: 'checkbox_group',
    field: 'pets',
    labelKey: 'x.pets',
    options: [option('cat', 'c'), option('dog', 'd')],
  },
  {
    id: 'tags',
    kind: 'multi_select',
    field: 'tags',
    labelKey: 'x.tags',
    options: [option('one', '1'), option('two', '2')],
  },
  {
    id: 'home',
    kind: 'country_select',
    field: 'country',
    labelKey: 'x.home',
    allowedCountries: ['FR', 'DE'],
  },
  {
    id: 'addr',
    kind: 'address',
    labelKey: 'x.addr',
    required: true,
    fields: {
      street1: 'street',
      street2: 'street_2',
      city: 'city',
      subdivision: 'region',
      postalCode: 'postcode',
      country: 'address_country',
    },
  },
  {
    id: 'foot',
    kind: 'footer',
    children: [
      { id: 'help', kind: 'button', labelKey: 'x.help', action: 'link', link: 'help-url' },
      { id: 'privacy', kind: 'button', labelKey: 'x.privacy', action: 'link', link: 'privacy-url' },
      { id: 'go', kind: 'button', labelKey: 'x.go', action: 'submit' },
    ],
  },
];

const STEP: ScreenClientView = { id: 'everything', type: 'screen', components: EVERY_KIND };

describe('the component catalogue (C148.2)', () => {
  it('has an entry for every kind', () => {
    expect(Object.keys(SCREEN_COMPONENTS).sort()).toEqual([...COMPONENT_KINDS].sort());
  });

  it('renders every kind with its label, its autocomplete purpose and a 24 px choice target', () => {
    renderWithI18n(
      <ScreenStep
        step={STEP}
        copy={copy}
        onSubmit={() => Promise.resolve()}
        links={{ 'help-url': 'https://help.example.com/' }}
        asset={() => null}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Text of x.title' })).toBeInTheDocument();
    expect(screen.getByText('Text of x.caption').closest('p')).toHaveClass('text-sm');
    // An image not loaded shows its text alternative, never a broken image.
    expect(screen.getByText('Text of x.logo')).toBeInTheDocument();
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Text of x.two');
    expect(screen.getByRole('textbox', { name: 'Text of x.name' })).toHaveAttribute(
      'autocomplete',
      'off',
    );
    expect(screen.getByRole('textbox', { name: 'Text of x.notes' }).tagName).toBe('TEXTAREA');
    expect(screen.getByRole('textbox', { name: 'Text of x.age' })).toHaveAttribute(
      'inputmode',
      'decimal',
    );
    expect(screen.getByLabelText('Text of x.birth')).toHaveAttribute('autocomplete', 'bday');
    expect(screen.getByRole('textbox', { name: 'Text of x.mail' })).toHaveAttribute(
      'autocomplete',
      'email',
    );
    expect(screen.getByRole('textbox', { name: 'Text of x.tel' })).toHaveAttribute(
      'autocomplete',
      'tel',
    );
    expect(screen.getByRole('textbox', { name: 'Text of x.site' })).toHaveAttribute('type', 'url');
    expect(screen.getByLabelText('Text of x.secret')).toHaveAttribute('type', 'password');
    expect(
      within(screen.getByRole('combobox', { name: 'Text of x.colour' })).getAllByRole('option'),
    ).toHaveLength(3);
    expect(screen.getByRole('radio', { name: 'Text of x.small' })).toHaveClass('size-6');
    expect(screen.getByRole('checkbox', { name: 'Text of x.agree' })).toHaveClass('size-6');
    expect(screen.getByRole('group', { name: 'Text of x.pets' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Text of x.two' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('combobox', { name: 'Text of x.home' })).getAllByRole('option'),
    ).toHaveLength(3);
    const address = screen.getByRole('group', { name: 'Text of x.addr' });
    expect(within(address).getByRole('textbox', { name: 'Street address' })).toHaveAttribute(
      'autocomplete',
      'address-line1',
    );
    expect(within(address).getByRole('textbox', { name: 'Postal code' })).toBeRequired();
    expect(
      within(address).getByRole('textbox', { name: 'Apartment, suite or building (optional)' }),
    ).not.toBeRequired();
    expect(within(address).getByRole('combobox', { name: 'Country' })).toHaveAttribute(
      'autocomplete',
      'country',
    );
    // A link button opens the version's link with no opener or referrer; one without its link is left out.
    expect(screen.getByRole('link', { name: 'Text of x.help' })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    expect(screen.queryByRole('link', { name: 'Text of x.privacy' })).not.toBeInTheDocument();
  });

  it('collects every kind into one submission', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(submission: ScreenSubmission) => Promise<void>>(() =>
      Promise.resolve(),
    );
    renderWithI18n(
      <ScreenStep step={STEP} copy={copy} onSubmit={onSubmit} asset={() => 'blob:logo'} />,
    );

    expect(screen.getByRole('img', { name: 'Text of x.logo' })).toHaveAttribute('src', 'blob:logo');
    await user.type(screen.getByRole('textbox', { name: 'Text of x.name' }), 'Sam');
    await user.type(screen.getByRole('textbox', { name: 'Text of x.age' }), '٤٢');
    await user.type(screen.getByRole('textbox', { name: 'Text of x.mail' }), 'sam@example.com');
    await user.type(screen.getByRole('textbox', { name: 'Text of x.tel' }), '+1 202 555 0143');
    await user.type(screen.getByRole('textbox', { name: 'Text of x.site' }), 'https://example.org');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Text of x.colour' }), 'b');
    await user.click(screen.getByRole('radio', { name: 'Text of x.large' }));
    await user.click(screen.getByRole('checkbox', { name: 'Text of x.agree' }));
    await user.click(screen.getByRole('checkbox', { name: 'Text of x.cat' }));
    await user.click(screen.getByRole('checkbox', { name: 'Text of x.dog' }));
    await user.click(screen.getByRole('checkbox', { name: 'Text of x.cat' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Text of x.home' }), 'FR');
    const address = screen.getByRole('group', { name: 'Text of x.addr' });
    await user.type(within(address).getByRole('textbox', { name: 'Street address' }), '1 Main St');
    await user.type(within(address).getByRole('textbox', { name: 'City' }), 'Springfield');
    await user.type(within(address).getByRole('textbox', { name: 'Postal code' }), '١٢٣٤٥');
    await user.selectOptions(within(address).getByRole('combobox', { name: 'Country' }), 'US');
    await user.click(screen.getByRole('button', { name: 'Text of x.go' }));

    expect(onSubmit).toHaveBeenCalledWith({
      values: {
        name: 'Sam',
        notes: null,
        age: 42,
        birthdate: null,
        email: 'sam@example.com',
        phone: '+1 202 555 0143',
        site: 'https://example.org',
        secret: null,
        colour: 'b',
        size: 'l',
        agree: true,
        pets: ['d'],
        tags: null,
        country: 'FR',
        street: '1 Main St',
        street_2: null,
        city: 'Springfield',
        region: null,
        postcode: '12345',
        address_country: 'US',
      },
    });
  });

  it('names the problem of each kind of value at its field', async () => {
    const user = userEvent.setup();
    renderWithI18n(<ScreenStep step={STEP} copy={copy} onSubmit={() => Promise.resolve()} />);

    await user.type(screen.getByRole('textbox', { name: 'Text of x.age' }), 'many');
    await user.type(screen.getByRole('textbox', { name: 'Text of x.mail' }), 'sam');
    await user.type(screen.getByRole('textbox', { name: 'Text of x.tel' }), '12');
    await user.type(screen.getByRole('textbox', { name: 'Text of x.site' }), 'example');
    await user.click(screen.getByRole('button', { name: 'Text of x.go' }));

    expect(screen.getByRole('textbox', { name: 'Text of x.age' })).toHaveAccessibleDescription(
      'Enter a number.',
    );
    expect(screen.getByRole('textbox', { name: 'Text of x.mail' })).toHaveAccessibleDescription(
      'Enter an email address, such as name@example.com.',
    );
    expect(screen.getByRole('textbox', { name: 'Text of x.tel' })).toHaveAccessibleDescription(
      'Enter a phone number, with its country code.',
    );
    expect(screen.getByRole('textbox', { name: 'Text of x.site' })).toHaveAccessibleDescription(
      'Enter a web address that starts with https://.',
    );
    // The address is required: its required parts are named in the summary by their own labels.
    const summary = screen.getByRole('alert');
    expect(within(summary).getByRole('link', { name: 'Street address' })).toBeInTheDocument();
    expect(within(summary).getByRole('link', { name: 'Country' })).toBeInTheDocument();
  });
});
