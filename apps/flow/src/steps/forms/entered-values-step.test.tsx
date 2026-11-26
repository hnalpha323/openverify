import type { RetryHint } from '@openverify/contracts';
import type { Flow } from '@openverify/flow-spec';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FlowApiError } from '../../api/flow-api-client';
import type { AamvaStep, DatabaseStep, FlowPosition } from '../../flow/flow-position';
import { FakeFlowApi } from '../../testing/fake-flow-api';
import { renderWithFlow } from '../../test-utils';
import { EnteredValuesStep, type EnteredValuesFlowStep } from './entered-values-step';

type CapturePosition = Extract<FlowPosition, { kind: 'capture' }> & {
  step: EnteredValuesFlowStep;
};

/** Synthetic values: an invented person at an invented address. */
const PERSON = {
  first: 'Alex',
  last: 'Example',
  birthdate: '1990-04-01',
  street: '1 Example Street',
  city: 'Exampleton',
  postalCode: 'EX1 1AA',
};

const RECORDS: DatabaseStep = {
  id: 'records',
  type: 'database',
  fields: [
    'name_first',
    'name_last',
    'birthdate',
    'address_street_1',
    'address_city',
    'address_postal_code',
    'address_country_code',
  ],
  requiredFields: ['name_first', 'name_last', 'birthdate'],
};

const CONTACT_RECORDS: DatabaseStep = {
  id: 'records',
  type: 'database',
  fields: ['name_first', 'name_last', 'address_country_code', 'phone_number', 'email_address'],
};

const LICENCE: AamvaStep = { id: 'licence', type: 'aamva', source: 'form' };

const PO_BOX: RetryHint = { name: 'database_po_box_detection', reasons: ['po_box_detected'] };

function flowWith(step: EnteredValuesFlowStep): Flow {
  return {
    metadata: { specVersion: 1, id: 'records', version: 1, name: 'Records' },
    steps: [
      { id: 'consent', type: 'consent', textKeys: ['consent.biometric'], required: true },
      step,
      { id: 'done', type: 'completion' },
    ],
    transitions: [],
  };
}

function capture(
  step: EnteredValuesFlowStep,
  overrides: Partial<CapturePosition> = {},
): CapturePosition {
  return {
    kind: 'capture',
    step,
    attempt: 1,
    maxAttempts: 1,
    verificationId: null,
    hints: [],
    ...overrides,
  };
}

function renderStep(
  position: CapturePosition,
  { api = new FakeFlowApi(), language = 'en' }: { api?: FakeFlowApi; language?: 'en' | 'es' } = {},
) {
  api.consent = { textKeys: ['consent.biometric'], locale: 'en' };
  api.flow = flowWith(position.step);
  const onSubmitted = vi.fn(() => Promise.resolve());
  renderWithFlow(
    <EnteredValuesStep position={position} client={api.client} onSubmitted={onSubmitted} />,
    { language },
  );
  return { api, onSubmitted };
}

/** Matches a text that contains `text`, such as an error inside a field's description. */
function including(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

/** A refusal of the entered values with a JSON Pointer per member (C52.3). */
function refused(status: 400 | 422, pointers: readonly string[]): FlowApiError {
  return new FlowApiError('http', `POST /inputs failed with HTTP ${String(status)}`, {
    status,
    problem: {
      type: 'about:blank',
      title: status === 400 ? 'Bad Request' : 'Unprocessable Content',
      status,
      detail: 'The values were refused.',
      instance: '/inputs',
      requestId: 'test',
      errors: pointers.map((pointer) => ({ location: 'body', pointer, detail: 'is invalid' })),
    },
  });
}

async function fillPerson() {
  await userEvent.type(screen.getByRole('textbox', { name: 'First name' }), ` ${PERSON.first} `);
  await userEvent.type(screen.getByRole('textbox', { name: 'Last name' }), PERSON.last);
  await userEvent.type(screen.getByLabelText('Date of birth'), PERSON.birthdate);
}

/** C52.3: every database body carries the country (`DATABASE_REQUIRED_FIELDS`). */
async function chooseCountry(code = 'GB') {
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Country' }), code);
}

async function fillAddress() {
  await userEvent.type(screen.getByRole('textbox', { name: 'Address line 1' }), PERSON.street);
  await userEvent.type(screen.getByRole('textbox', { name: 'Town or city' }), PERSON.city);
  await userEvent.type(screen.getByRole('textbox', { name: 'Postal code' }), PERSON.postalCode);
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Country' }), 'GB');
}

const enteredCalls = (api: FakeFlowApi) =>
  api.client.enterInputs.mock.calls.map(([id, body]) => [id, body] as const);

describe('EnteredValuesStep: database (C52.3, C64.1)', () => {
  it('asks for the step’s fields, grouping the address and marking the required ones', () => {
    renderStep(capture(RECORDS));

    expect(screen.getByRole('heading', { level: 1, name: 'Enter your details' })).toBeVisible();
    expect(screen.getByText('Fields marked * are required.')).toBeVisible();
    const first = screen.getByRole('textbox', { name: 'First name' });
    expect(first).toBeRequired();
    expect(first).toHaveAttribute('autocomplete', 'given-name');
    expect(screen.getByRole('textbox', { name: 'Last name' })).toHaveAttribute(
      'autocomplete',
      'family-name',
    );
    const birthdate = screen.getByLabelText('Date of birth');
    expect(birthdate).toHaveAttribute('type', 'date');
    expect(birthdate).toHaveAttribute('autocomplete', 'bday');
    expect(birthdate).toBeRequired();
    const address = screen.getByRole('group', { name: 'Address' });
    expect(within(address).getByRole('textbox', { name: 'Address line 1' })).not.toBeRequired();
    expect(within(address).getByRole('textbox', { name: 'Town or city' })).toHaveAttribute(
      'autocomplete',
      'address-level2',
    );
    expect(within(address).getByRole('textbox', { name: 'Postal code' })).toBeVisible();
    const country = within(address).getByRole('combobox', { name: 'Country' });
    expect(within(country).getByRole('option', { name: 'United Kingdom' })).toBeInTheDocument();
    // The step collects no middle name, phone or email.
    expect(screen.queryByRole('textbox', { name: 'Middle name' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Phone number' })).not.toBeInTheDocument();
  });

  it('sends the entered values, without the empty ones, then submits the verification', async () => {
    const { api, onSubmitted } = renderStep(capture(RECORDS));
    await fillPerson();
    await userEvent.type(screen.getByRole('textbox', { name: 'Address line 1' }), PERSON.street);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Country' }), 'GB');

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
    const id = api.verifications[0]?.id;
    expect(api.client.createVerification).toHaveBeenCalledWith(
      { type: 'database' },
      expect.any(AbortSignal),
    );
    expect(enteredCalls(api)).toEqual([
      [
        id,
        {
          'name-first': PERSON.first,
          'name-last': PERSON.last,
          birthdate: PERSON.birthdate,
          'address-street-1': PERSON.street,
          'address-country-code': 'GB',
        },
      ],
    ]);
    expect(api.submits).toEqual([{ verificationId: id, body: undefined }]);
  });

  it('sends the whole address the step collects', async () => {
    const { api } = renderStep(capture(RECORDS));
    await fillPerson();
    await fillAddress();

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(api.client.enterInputs).toHaveBeenCalledTimes(1);
    });
    expect(api.client.enterInputs.mock.calls[0]?.[1]).toMatchObject({
      'address-street-1': PERSON.street,
      'address-city': PERSON.city,
      'address-postal-code': PERSON.postalCode,
      'address-country-code': 'GB',
    });
  });

  it('asks for the required fields before anything is sent', async () => {
    const { api } = renderStep(capture(RECORDS));

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Check the details marked below.');
    const first = screen.getByRole('textbox', { name: 'First name' });
    expect(first).toHaveAttribute('aria-invalid', 'true');
    expect(first).toHaveAccessibleDescription('Enter your first name.');
    expect(first).toHaveFocus();
    expect(screen.getByRole('textbox', { name: 'Last name' })).toHaveAccessibleDescription(
      'Enter your last name.',
    );
    expect(screen.getByLabelText('Date of birth')).toHaveAccessibleDescription(
      'Enter your date of birth.',
    );
    expect(screen.getByRole('textbox', { name: 'Address line 1' })).not.toHaveAttribute(
      'aria-invalid',
    );
    expect(api.client.createVerification).not.toHaveBeenCalled();
    expect(api.client.enterInputs).not.toHaveBeenCalled();
  });

  it('checks each value as the server does, before anything is sent', async () => {
    const { api } = renderStep(capture(CONTACT_RECORDS));

    await userEvent.click(screen.getByRole('textbox', { name: 'First name' }));
    await userEvent.paste('A'.repeat(201));
    await userEvent.type(screen.getByRole('textbox', { name: 'Phone number' }), 'call me');
    await userEvent.type(screen.getByRole('textbox', { name: 'Email address' }), 'alex@');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByRole('textbox', { name: 'First name' })).toHaveAccessibleDescription(
      'Enter no more than 200 characters.',
    );
    expect(screen.getByRole('textbox', { name: 'Phone number' })).toHaveAccessibleDescription(
      including('Enter the number with its country code, like +1 202 555 0143.'),
    );
    expect(screen.getByRole('textbox', { name: 'Email address' })).toHaveAccessibleDescription(
      'Enter an email address in the correct format, like name@example.com.',
    );
    expect(api.client.enterInputs).not.toHaveBeenCalled();
  });

  it('sends a phone number typed with spaces in E.164', async () => {
    const { api } = renderStep(capture(CONTACT_RECORDS));
    await userEvent.type(screen.getByRole('textbox', { name: 'First name' }), PERSON.first);
    await userEvent.type(screen.getByRole('textbox', { name: 'Last name' }), PERSON.last);
    // Synthetic: the NANP 555-01xx range is kept for fiction.
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Phone number' }),
      '+1 (202) 555-0143',
    );
    await chooseCountry('US');

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(api.client.enterInputs).toHaveBeenCalledTimes(1);
    });
    expect(api.client.enterInputs.mock.calls[0]?.[1]).toEqual({
      'name-first': PERSON.first,
      'name-last': PERSON.last,
      'address-country-code': 'US',
      'phone-number': '+12025550143',
    });
  });

  it.each([
    [422, '/birthdate'],
    [400, '/data/attributes/birthdate'],
  ] as const)('shows a %d refusal at the field its pointer %s names', async (status, pointer) => {
    const { api, onSubmitted } = renderStep(capture(RECORDS));
    api.failures.enterInputs = [refused(status, [pointer])];
    await fillPerson();
    await chooseCountry();

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    const birthdate = screen.getByLabelText('Date of birth');
    await waitFor(() => {
      expect(birthdate).toHaveAttribute('aria-invalid', 'true');
    });
    expect(birthdate).toHaveAccessibleDescription('This was not accepted. Check it and try again.');
    expect(screen.getByRole('alert')).toHaveTextContent('Check the details marked below.');
    expect(api.client.submitVerification).not.toHaveBeenCalled();
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it('says some details were refused when no pointer names a field on the screen', async () => {
    const { api } = renderStep(capture(RECORDS));
    api.failures.enterInputs = [refused(422, ['/identification-number'])];
    await fillPerson();
    await chooseCountry();

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(
      await screen.findByText('Some details were not accepted. Check them and try again.'),
    ).toBeVisible();
  });

  it('moves focus to the field a refusal’s pointer names (WCAG 2.2 AA)', async () => {
    const { api } = renderStep(capture(RECORDS));
    api.failures.enterInputs = [refused(422, ['/birthdate'])];
    await fillPerson();
    await chooseCountry();

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Date of birth')).toHaveFocus();
    });
  });

  it('moves focus to the summary when no pointer names a field on the screen (WCAG 2.2 AA)', async () => {
    const { api } = renderStep(capture(RECORDS));
    api.failures.enterInputs = [refused(422, ['/identification-number'])];
    await fillPerson();
    await chooseCountry();

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    const summary = await screen.findByRole('alert');
    expect(summary).toHaveTextContent('Some details were not accepted. Check them and try again.');
    await waitFor(() => {
      expect(summary).toHaveFocus();
    });
  });

  it('explains a request that failed, and sends again on request', async () => {
    const { api, onSubmitted } = renderStep(capture(RECORDS));
    api.failures.enterInputs = [new FlowApiError('network', 'POST /inputs failed')];
    await fillPerson();
    await chooseCountry();

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      await screen.findByText(
        'We could not reach the verification service. Check your connection and try again.',
      ),
    ).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
    expect(api.client.createVerification).toHaveBeenCalledTimes(1);
  });

  it('reloads the session when the verification has moved on', async () => {
    const { api, onSubmitted } = renderStep(capture(RECORDS));
    api.failures.enterInputs = [new FlowApiError('http', 'POST /inputs failed', { status: 409 })];
    await fillPerson();
    await chooseCountry();

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
  });

  it('sends values already received for checking, without entering them again', async () => {
    const api = new FakeFlowApi();
    api.flow = flowWith(RECORDS);
    api.consent = { textKeys: ['consent.biometric'], locale: 'en' };
    const created = await api.client.createVerification({ type: 'database' });
    const received = await api.client.enterInputs(created.id, {
      'name-first': PERSON.first,
      'name-last': PERSON.last,
      birthdate: PERSON.birthdate,
      'address-country-code': 'GB',
    });
    api.client.enterInputs.mockClear();
    api.client.createVerification.mockClear();
    const { onSubmitted } = renderStep(
      capture(RECORDS, { verificationId: created.id, verification: received }),
      { api },
    );

    expect(
      screen.getByText('We received your details. Send them for checking, or change them below.'),
    ).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Send for checking' }));

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
    expect(api.client.enterInputs).not.toHaveBeenCalled();
    expect(api.submits).toEqual([{ verificationId: created.id, body: undefined }]);
  });

  it('shows why the previous attempt failed', () => {
    renderStep(capture(RECORDS, { attempt: 2, maxAttempts: 2, hints: [PO_BOX] }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'A post office box cannot be used as your address. Enter the address where you live.',
    );
    expect(screen.getByText('Attempt 2 of 2')).toBeVisible();
  });

  it('speaks Spanish', () => {
    renderStep(capture(RECORDS), { language: 'es' });

    expect(screen.getByRole('heading', { level: 1, name: 'Introduce tus datos' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Nombre' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'Reino Unido' })).toBeInTheDocument();
  });
});

describe('EnteredValuesStep: the AAMVA form (C52.3, C59.5, C64.1)', () => {
  it('asks for the license as printed, with its state or territory', () => {
    renderStep(capture(LICENCE));

    expect(
      screen.getByRole('heading', { level: 1, name: 'Enter your driver’s license details' }),
    ).toBeVisible();
    for (const name of ['First name', 'Last name', 'Driver’s license or ID card number']) {
      expect(screen.getByRole('textbox', { name })).toBeRequired();
    }
    expect(screen.getByLabelText('Date of birth')).toBeRequired();
    const state = screen.getByRole('combobox', { name: 'Issuing state or territory' });
    expect(state).toBeRequired();
    const options = within(state)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options[0]).toBe('Choose a state or territory');
    expect(options).toHaveLength(57);
    expect(options).toContain('District of Columbia');
    expect(options).toContain('Puerto Rico');
    expect(options.indexOf('Alabama')).toBeLessThan(options.indexOf('Wyoming'));
    expect(screen.getByLabelText('Issue date')).not.toBeRequired();
    expect(screen.getByLabelText('Expiration date')).not.toBeRequired();
    const zip = screen.getByRole('textbox', { name: 'ZIP code' });
    expect(zip).not.toBeRequired();
    expect(zip).toHaveAttribute('autocomplete', 'postal-code');
  });

  it('sends the license details, then submits the verification', async () => {
    const { api, onSubmitted } = renderStep(capture(LICENCE));
    await fillPerson();
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Driver’s license or ID card number' }),
      'D1234567',
    );
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Issuing state or territory' }),
      'CA',
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'ZIP code' }), '00000');

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
    expect(api.client.createVerification).toHaveBeenCalledWith(
      { type: 'aamva' },
      expect.any(AbortSignal),
    );
    expect(enteredCalls(api)).toEqual([
      [
        api.verifications[0]?.id,
        {
          'name-first': PERSON.first,
          'name-last': PERSON.last,
          birthdate: PERSON.birthdate,
          'identification-number': 'D1234567',
          'issuing-authority': 'CA',
          'address-postal-code': '00000',
        },
      ],
    ]);
  });

  it('asks for the state and a ZIP code that is one', async () => {
    const { api } = renderStep(capture(LICENCE));
    await fillPerson();
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Driver’s license or ID card number' }),
      'D1234567',
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'ZIP code' }), '1234');

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(
      screen.getByRole('combobox', { name: 'Issuing state or territory' }),
    ).toHaveAccessibleDescription('Choose the state or territory that issued it.');
    expect(screen.getByRole('textbox', { name: 'ZIP code' })).toHaveAccessibleDescription(
      'Enter a 5-digit ZIP code, or a ZIP+4 like 12345-6789.',
    );
    expect(api.client.enterInputs).not.toHaveBeenCalled();
  });

  it('speaks Spanish', () => {
    renderStep(capture(LICENCE), { language: 'es' });

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Introduce los datos de tu licencia de conducir',
      }),
    ).toBeVisible();
    expect(screen.getByRole('option', { name: 'Nueva York' })).toBeInTheDocument();
  });
});
