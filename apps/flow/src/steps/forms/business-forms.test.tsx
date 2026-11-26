import { isLei } from '@openverify/contracts';
import type { Flow } from '@openverify/flow-spec';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FlowApiError } from '../../api/flow-api-client';
import type {
  BusinessWebsiteStep,
  DatabaseBusinessStep,
  FlowPosition,
} from '../../flow/flow-position';
import { FakeFlowApi } from '../../testing/fake-flow-api';
import { flowVerification } from '../../testing/flow-fixtures';
import { renderWithFlow } from '../../test-utils';
import { EnteredValuesStep } from './entered-values-step';

type FormStep = DatabaseBusinessStep | BusinessWebsiteStep;
type CapturePosition = Extract<FlowPosition, { kind: 'capture' }> & { step: FormStep };

const BUSINESS: DatabaseBusinessStep = { id: 'business', type: 'database_business' };
const BUSINESS_WITH_PERSONS: DatabaseBusinessStep = { ...BUSINESS, collectAssociatedPersons: true };
const WEBSITE: BusinessWebsiteStep = { id: 'website', type: 'business_website' };

/** An invented business; nothing here names a real company. */
const COMPANY = 'Example Widgets Ltd';

/**
 * A synthetic LEI (ISO 17442): 18 invented characters, then the ISO 7064 MOD 97-10 check digits
 * that make it pass `isLei`; it names no registered entity.
 */
function syntheticLei(base = 'OPENVERIFYSYNTH001'): string {
  let remainder = 0;
  for (const character of `${base}00`) {
    for (const digit of String(Number.parseInt(character, 36))) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return `${base}${String(98 - remainder).padStart(2, '0')}`;
}

const LEI = syntheticLei();
const ID = 'ver_01M5CK16P0D13FXHZSS4TCFBV0';

function flowWith(step: FormStep): Flow {
  return {
    metadata: { specVersion: 1, id: 'kyb', version: 1, name: 'KYB' },
    steps: [
      { id: 'consent', type: 'consent', textKeys: ['consent.biometric'], required: true },
      step,
      { id: 'done', type: 'completion' },
    ],
    transitions: [],
  };
}

/**
 * The form's screen. `resumed` resumes an initiated attempt of the fake (with its derived guidance
 * and `inputsReceived`), as the session would; otherwise the screen starts a new attempt.
 */
function renderForm(
  step: FormStep,
  {
    api = new FakeFlowApi(),
    resumed = false,
    inputsReceived = false,
    language = 'en',
  }: {
    api?: FakeFlowApi;
    resumed?: boolean;
    inputsReceived?: boolean;
    language?: 'en' | 'es';
  } = {},
) {
  api.consent = { textKeys: ['consent.biometric'], locale: 'en' };
  api.flow = flowWith(step);
  const type = step.type === 'database_business' ? 'database_business' : 'business_website';
  let position: CapturePosition = {
    kind: 'capture',
    step,
    attempt: 1,
    maxAttempts: 3,
    verificationId: null,
    hints: [],
  };
  if (resumed) {
    api.verifications.push({ type, status: 'initiated', id: ID, hints: [], inputsReceived });
    const guidance =
      step.type === 'database_business'
        ? {
            'collect-associated-persons': step.collectAssociatedPersons ?? false,
            'required-inputs': [...api.businessRequiredInputs],
          }
        : {};
    position = {
      ...position,
      verificationId: ID,
      verification: flowVerification(type, 'initiated', { id: ID, guidance, inputsReceived }),
    };
  }
  const onSubmitted = vi.fn(() => Promise.resolve());
  renderWithFlow(
    <EnteredValuesStep position={position} client={api.client} onSubmitted={onSubmitted} />,
    { language },
  );
  return { api, onSubmitted };
}

const textbox = (name: string, within_: HTMLElement = document.body) =>
  within(within_).getByRole('textbox', { name });

/** Matches a text that contains `text`, such as an error inside a field's description. */
function including(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

function refused(pointers: readonly string[]): FlowApiError {
  return new FlowApiError('http', 'POST /inputs failed with HTTP 422', {
    status: 422,
    problem: {
      type: 'about:blank',
      title: 'Unprocessable Content',
      status: 422,
      detail: 'The entered values were refused.',
      instance: '/inputs',
      requestId: 'test',
      errors: pointers.map((pointer) => ({ location: 'body', pointer, detail: 'is invalid' })),
    },
  });
}

const enteredBodies = (api: FakeFlowApi) =>
  api.client.enterInputs.mock.calls.map(([, body]) => body);

async function fillBusiness(country = 'GB') {
  await userEvent.type(textbox('Business name'), COMPANY);
  await userEvent.selectOptions(
    screen.getByRole('combobox', { name: 'Country of registration' }),
    country,
  );
}

describe('EnteredValuesStep: business registry (C52.3, C61, C64.1)', () => {
  it('asks for the business, its country and its optional identifiers, with the registered address grouped', () => {
    renderForm(BUSINESS, { resumed: true });

    expect(
      screen.getByRole('heading', { level: 1, name: 'Tell us about your business' }),
    ).toBeVisible();
    expect(screen.getByText('Fields marked * are required.')).toBeVisible();
    const name = textbox('Business name');
    const country = screen.getByRole('combobox', { name: 'Country of registration' });
    const number = textbox('Registration number');
    const lei = textbox('Legal Entity Identifier (LEI)');
    expect(name).toBeRequired();
    expect(name).toHaveAttribute('autocomplete', 'organization');
    expect(country).toBeRequired();
    expect(number).not.toBeRequired();
    expect(number).toHaveAccessibleDescription(
      'The number the business register gives the business: up to 20 letters and digits.',
    );
    expect(lei).not.toBeRequired();
    expect(lei).toHaveAccessibleDescription(
      'The 20-character code from the global LEI register. Leave it out if the business has none.',
    );
    const address = screen.getByRole('group', { name: 'Registered address' });
    expect(
      within(address)
        .getAllByRole('textbox')
        .map((field) => field.getAttribute('autocomplete')),
    ).toEqual(['off', 'off', 'off', 'off', 'off']);
    for (const label of [
      'Address line 1',
      'Address line 2',
      'Town or city',
      'State, province or region',
      'Postal code',
    ]) {
      expect(textbox(label, address)).not.toBeRequired();
    }
    expect(screen.queryByRole('group', { name: 'People who own or run the business' })).toBeNull();
  });

  it('makes its verification when the screen opens, to mark what every match group needs (C52.2)', async () => {
    const api = new FakeFlowApi();
    api.businessRequiredInputs = ['business-name', 'registration-number'];
    renderForm(BUSINESS, { api });

    await waitFor(() => {
      expect(textbox('Registration number')).toBeRequired();
    });
    expect(api.client.createVerification).toHaveBeenCalledTimes(1);
    expect(api.client.createVerification).toHaveBeenCalledWith(
      { type: 'database-business' },
      undefined,
    );
  });

  it('checks the registration number against the register of the chosen country, saying its format', async () => {
    const { api } = renderForm(BUSINESS, { resumed: true });
    await fillBusiness('GB');
    const number = textbox('Registration number');
    expect(number).toHaveAccessibleDescription(
      'For a UK company, the 8-character Companies House number, like 01234567 or SC123456.',
    );

    await userEvent.type(number, 'sc123456');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(number).toHaveAccessibleDescription(
      including('Enter the 8-character company number, like 01234567 or SC123456.'),
    );
    expect(number).toHaveFocus();

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Country of registration' }),
      'US',
    );
    await userEvent.clear(number);
    await userEvent.type(number, '12A');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(number).toHaveAccessibleDescription(including('Enter the CIK: up to 10 digits.'));

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Country of registration' }),
      'FR',
    );
    await userEvent.clear(number);
    await userEvent.type(number, 'AB 12');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(number).toHaveAccessibleDescription(
      including('Enter up to 20 letters and digits, without spaces.'),
    );
    expect(api.client.enterInputs).not.toHaveBeenCalled();
  });

  it('checks an LEI’s check digits (ISO 17442)', async () => {
    const { api } = renderForm(BUSINESS, { resumed: true });
    await fillBusiness('FR');
    const lei = textbox('Legal Entity Identifier (LEI)');
    const wrong = `${LEI.slice(0, 18)}${LEI.endsWith('00') ? '01' : '00'}`;
    expect(isLei(LEI)).toBe(true);
    expect(isLei(wrong)).toBe(false);

    await userEvent.type(lei, wrong);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(lei).toHaveAccessibleDescription(
      including('Enter the 20-character LEI exactly as it is registered.'),
    );
    expect(api.client.enterInputs).not.toHaveBeenCalled();

    await userEvent.clear(lei);
    await userEvent.type(lei, LEI);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => {
      expect(enteredBodies(api)).toEqual([
        { 'business-name': COMPANY, 'country-code': 'FR', lei: LEI },
      ]);
    });
  });

  it('sends the values without the empty ones, then submits the verification', async () => {
    const { api, onSubmitted } = renderForm(BUSINESS, { resumed: true });
    await fillBusiness('GB');
    await userEvent.type(textbox('Registration number'), '01234567');
    await userEvent.type(textbox('Town or city'), ' Exampleton ');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
    expect(enteredBodies(api)).toEqual([
      {
        'business-name': COMPANY,
        'country-code': 'GB',
        'registration-number': '01234567',
        'address-city': 'Exampleton',
      },
    ]);
    expect(api.submits.map(({ verificationId }) => verificationId)).toEqual([ID]);
  });

  it('marks what was left out and refuses nothing more, with focus on the first field', async () => {
    const { api } = renderForm(BUSINESS, { resumed: true });

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Check the details marked below.');
    expect(textbox('Business name')).toHaveFocus();
    expect(textbox('Business name')).toHaveAccessibleDescription('Enter the business name.');
    expect(
      screen.getByRole('combobox', { name: 'Country of registration' }),
    ).toHaveAccessibleDescription('Choose the country where the business is registered.');
    expect(api.client.enterInputs).not.toHaveBeenCalled();
  });

  it('shows a 422’s pointers at their fields, saying what is needed when the field was left empty', async () => {
    const api = new FakeFlowApi();
    api.failures.enterInputs = [refused(['/registration-number', '/lei'])];
    renderForm(BUSINESS, { api, resumed: true });
    await fillBusiness('FR');
    await userEvent.type(textbox('Legal Entity Identifier (LEI)'), LEI);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    const number = textbox('Registration number');
    await waitFor(() => {
      expect(number).toHaveAccessibleDescription(including('Enter the registration number.'));
    });
    expect(textbox('Legal Entity Identifier (LEI)')).toHaveAccessibleDescription(
      including('This was not accepted. Check it and try again.'),
    );
    expect(number).toHaveFocus();
  });

  it('resumes an attempt whose values the server holds: they can be sent for checking', async () => {
    const { api, onSubmitted } = renderForm(BUSINESS, { resumed: true, inputsReceived: true });

    await userEvent.click(screen.getByRole('button', { name: 'Send for checking' }));

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
    expect(api.client.enterInputs).not.toHaveBeenCalled();
    expect(api.submits).toHaveLength(1);
  });

  it('speaks Spanish', () => {
    renderForm(BUSINESS, { resumed: true, language: 'es' });

    expect(screen.getByRole('heading', { level: 1, name: 'Háblanos de tu empresa' })).toBeVisible();
    expect(textbox('Nombre de la empresa')).toBeRequired();
    expect(screen.getByRole('group', { name: 'Domicilio registrado' })).toBeVisible();
  });
});

describe('EnteredValuesStep: a business registry step that collects people (C52.3)', () => {
  it('adds up to ten people, each in a group of their own, focusing the new person’s first name', async () => {
    renderForm(BUSINESS_WITH_PERSONS, { resumed: true });
    const people = screen.getByRole('group', { name: 'People who own or run the business' });
    expect(
      within(people).getByText(
        'You can add up to 10 directors, officers or owners for us to check against the register.',
      ),
    ).toBeVisible();

    await userEvent.click(within(people).getByRole('button', { name: 'Add a person' }));

    const first = screen.getByRole('group', { name: 'Person 1' });
    expect(textbox('First name', first)).toHaveFocus();
    expect(textbox('First name', first)).toBeRequired();
    expect(textbox('First name', first)).toHaveAttribute('autocomplete', 'off');
    expect(textbox('Last name', first)).toBeRequired();
    const birth = textbox('Month or date of birth', first);
    expect(birth).not.toBeRequired();
    expect(birth).toHaveAccessibleDescription('As YYYY-MM or YYYY-MM-DD.');
    expect(within(first).getByRole('button', { name: 'Remove person 1' })).toBeVisible();

    for (let count = 2; count <= 10; count += 1) {
      await userEvent.click(within(people).getByRole('button', { name: 'Add a person' }));
    }
    expect(screen.getByRole('group', { name: 'Person 10' })).toBeVisible();
    expect(within(people).queryByRole('button', { name: 'Add a person' })).toBeNull();
    expect(within(people).getByText('You have added as many people as you can.')).toBeVisible();
  });

  it('sends each person with their birth month or date when given', async () => {
    const { api } = renderForm(BUSINESS_WITH_PERSONS, { resumed: true });
    await fillBusiness('GB');
    const people = screen.getByRole('group', { name: 'People who own or run the business' });
    await userEvent.click(within(people).getByRole('button', { name: 'Add a person' }));
    await userEvent.click(within(people).getByRole('button', { name: 'Add a person' }));
    const first = screen.getByRole('group', { name: 'Person 1' });
    const second = screen.getByRole('group', { name: 'Person 2' });
    await userEvent.type(textbox('First name', first), 'Robin');
    await userEvent.type(textbox('Last name', first), 'Sample');
    await userEvent.type(textbox('Month or date of birth', first), '1980-04');
    await userEvent.type(textbox('First name', second), 'Casey');
    await userEvent.type(textbox('Last name', second), 'Placeholder');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(enteredBodies(api)).toEqual([
        {
          'business-name': COMPANY,
          'country-code': 'GB',
          'associated-persons': [
            { 'name-first': 'Robin', 'name-last': 'Sample', birthdate: '1980-04' },
            { 'name-first': 'Casey', 'name-last': 'Placeholder' },
          ],
        },
      ]);
    });
  });

  it('marks a person’s missing name and a birth date of the wrong shape', async () => {
    const { api } = renderForm(BUSINESS_WITH_PERSONS, { resumed: true });
    await fillBusiness('GB');
    await userEvent.click(screen.getByRole('button', { name: 'Add a person' }));
    const person = screen.getByRole('group', { name: 'Person 1' });
    await userEvent.type(textbox('First name', person), 'Robin');
    await userEvent.type(textbox('Month or date of birth', person), '04/1980');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(textbox('Last name', person)).toHaveFocus();
    expect(textbox('Last name', person)).toHaveAccessibleDescription(
      'Enter this person’s last name.',
    );
    expect(textbox('Month or date of birth', person)).toHaveAccessibleDescription(
      including('Enter the month as YYYY-MM, or the date as YYYY-MM-DD.'),
    );
    expect(api.client.enterInputs).not.toHaveBeenCalled();
  });

  it('keeps the other people’s values when one is removed', async () => {
    renderForm(BUSINESS_WITH_PERSONS, { resumed: true });
    await userEvent.click(screen.getByRole('button', { name: 'Add a person' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add a person' }));
    await userEvent.type(
      textbox('First name', screen.getByRole('group', { name: 'Person 1' })),
      'Robin',
    );
    await userEvent.type(
      textbox('First name', screen.getByRole('group', { name: 'Person 2' })),
      'Casey',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Remove person 1' }));

    expect(screen.queryByRole('group', { name: 'Person 2' })).toBeNull();
    expect(textbox('First name', screen.getByRole('group', { name: 'Person 1' }))).toHaveValue(
      'Casey',
    );
    expect(screen.getByRole('button', { name: 'Add a person' })).toHaveFocus();
  });

  it('shows a 422 pointer at a person’s field', async () => {
    const api = new FakeFlowApi();
    api.failures.enterInputs = [refused(['/associated-persons/1/name-last'])];
    renderForm(BUSINESS_WITH_PERSONS, { api, resumed: true });
    await fillBusiness('GB');
    await userEvent.click(screen.getByRole('button', { name: 'Add a person' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add a person' }));
    for (const [index, [first, last]] of [
      ['Robin', 'Sample'],
      ['Casey', 'Placeholder'],
    ].entries()) {
      const person = screen.getByRole('group', { name: `Person ${String(index + 1)}` });
      await userEvent.type(textbox('First name', person), first ?? '');
      await userEvent.type(textbox('Last name', person), last ?? '');
    }
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    const second = screen.getByRole('group', { name: 'Person 2' });
    await waitFor(() => {
      expect(textbox('Last name', second)).toHaveAccessibleDescription(
        including('This was not accepted. Check it and try again.'),
      );
    });
    expect(textbox('Last name', second)).toHaveFocus();
    expect(
      textbox('Last name', screen.getByRole('group', { name: 'Person 1' })),
    ).not.toHaveAttribute('aria-invalid');
  });
});

describe('EnteredValuesStep: business website (C52.3, C61, C64.1)', () => {
  it('asks for the website address and an optional business name', () => {
    renderForm(WEBSITE);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Enter your business website' }),
    ).toBeVisible();
    const url = textbox('Website address');
    expect(url).toBeRequired();
    expect(url).toHaveAttribute('type', 'url');
    expect(url).toHaveAttribute('autocomplete', 'url');
    expect(url).toHaveAttribute('inputmode', 'url');
    expect(url).toHaveAccessibleDescription(
      'Include https:// or http://, like https://www.example.com.',
    );
    const name = textbox('Business name');
    expect(name).not.toBeRequired();
    expect(name).toHaveAttribute('autocomplete', 'organization');
  });

  it('makes its verification only when the values are sent: it needs no guidance first', async () => {
    const { api, onSubmitted } = renderForm(WEBSITE);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.client.createVerification).not.toHaveBeenCalled();

    await userEvent.type(textbox('Website address'), 'https://www.example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
    expect(api.client.createVerification).toHaveBeenCalledWith(
      { type: 'business-website' },
      expect.any(AbortSignal),
    );
    expect(enteredBodies(api)).toEqual([{ 'website-url': 'https://www.example.com' }]);
  });

  it.each([
    'example.com',
    'ftp://example.com',
    'https://user:secret@example.com',
    'https://192.0.2.1',
    'https://localhost',
    'https://www.example.com:8443',
  ])('refuses %s as the server would, before sending it', async (address) => {
    const { api } = renderForm(WEBSITE, { resumed: true });
    const url = textbox('Website address');

    await userEvent.type(url, address);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(url).toHaveAccessibleDescription(
      including(
        'Enter the full web address, starting with https:// or http://, like https://www.example.com.',
      ),
    );
    expect(url).toHaveFocus();
    expect(api.client.enterInputs).not.toHaveBeenCalled();
  });

  it('speaks Spanish', () => {
    renderForm(WEBSITE, { language: 'es' });

    expect(
      screen.getByRole('heading', { level: 1, name: 'Introduce el sitio web de tu empresa' }),
    ).toBeVisible();
    expect(textbox('Dirección del sitio web')).toBeRequired();
  });
});
