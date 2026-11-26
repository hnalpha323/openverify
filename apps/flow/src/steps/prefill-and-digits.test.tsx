import type { Flow } from '@openverify/flow-spec';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseStep, FlowPosition, PhoneOtpStep } from '../flow/flow-position';
import { FakeFlowApi } from '../testing/fake-flow-api';
import { renderWithFlow } from '../test-utils';
import { EnteredValuesStep } from './forms/entered-values-step';
import { OneTimeCodeStep } from './otp/one-time-code-step';

// C148.7 (3.3.7, review H22): a verification step with `prefillFrom` shows the value the person
// entered earlier, filled and editable, from the session's `values` (the client view leaves
// `prefillFrom` out, C151.5). C161.4: Arabic-Indic digits typed into a code, phone, date or ID field
// are normalised to ASCII as they are typed.

const PHONE: PhoneOtpStep = { id: 'phone', type: 'phone_otp', allowedCountries: ['US', 'GB'] };
const RECORDS: DatabaseStep = {
  id: 'records',
  type: 'database',
  fields: ['name_first', 'name_last', 'address_country_code', 'phone_number', 'birthdate'],
  maxAttempts: 1,
};

function flowWith(step: PhoneOtpStep | DatabaseStep): Flow {
  return {
    metadata: { specVersion: 1, id: 'prefill', version: 1, name: 'Prefill' },
    steps: [
      { id: 'consent', type: 'consent', textKeys: ['consent.biometric'], required: true },
      step,
      { id: 'done', type: 'completion' },
    ],
    transitions: [],
  };
}

const CAPTURE = {
  kind: 'capture',
  attempt: 1,
  maxAttempts: 5,
  verificationId: null,
  hints: [],
} as const satisfies Omit<Extract<FlowPosition, { kind: 'capture' }>, 'step'>;

function api(step: PhoneOtpStep | DatabaseStep): FakeFlowApi {
  const fake = new FakeFlowApi();
  fake.consent = { textKeys: ['consent.biometric'], locale: 'en' };
  fake.flow = flowWith(step);
  return fake;
}

describe('a phone step after a screen (C148.7, 3.3.7)', () => {
  it('shows the number the person entered earlier, filled and editable', () => {
    const fake = api(PHONE);
    renderWithFlow(
      <OneTimeCodeStep
        position={{ ...CAPTURE, step: PHONE }}
        client={fake.client}
        onSubmitted={vi.fn(() => Promise.resolve())}
        prefill={{ mobile: '+12025550143' }}
      />,
    );

    const field = screen.getByRole('textbox', { name: 'Phone number' });
    expect(field).toHaveValue('+12025550143');
    expect(field).not.toHaveAttribute('readonly');
  });

  it('normalises Arabic-Indic digits typed into the number and the code (C161.4)', async () => {
    const fake = api(PHONE);
    renderWithFlow(
      <OneTimeCodeStep
        position={{ ...CAPTURE, step: PHONE }}
        client={fake.client}
        onSubmitted={vi.fn(() => Promise.resolve())}
      />,
      { environment: { currentTime: () => fake.nowMs, countdownIntervalMs: 5 } },
    );

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Country' }), 'US');
    await userEvent.type(screen.getByRole('textbox', { name: 'Phone number' }), '٢٠٢ ٥٥٥ ۰١٤٣');
    expect(screen.getByRole('textbox', { name: 'Phone number' })).toHaveValue('202 555 0143');
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }));

    const code = await screen.findByRole('textbox', { name: 'Code' });
    await userEvent.type(code, '١٢٣٤٥٦');
    expect(code).toHaveValue('123456');
  });
});

describe('a database step after a screen (C148.7, 3.3.7)', () => {
  it('shows the values the person entered earlier, by the inputs they fill', () => {
    const fake = api(RECORDS);
    renderWithFlow(
      <EnteredValuesStep
        position={{ ...CAPTURE, step: RECORDS }}
        client={fake.client}
        onSubmitted={vi.fn(() => Promise.resolve())}
        prefill={{ name_first: 'Casey', phone_number: '+12025550143', unrelated: 'x' }}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'First name' })).toHaveValue('Casey');
    expect(screen.getByRole('textbox', { name: 'Phone number' })).toHaveValue('+12025550143');
    expect(screen.getByRole('textbox', { name: 'Last name' })).toHaveValue('');
  });

  it('normalises Arabic-Indic digits typed into a phone number or a date (C161.4)', async () => {
    const fake = api(RECORDS);
    renderWithFlow(
      <EnteredValuesStep
        position={{ ...CAPTURE, step: RECORDS }}
        client={fake.client}
        onSubmitted={vi.fn(() => Promise.resolve())}
      />,
    );

    await userEvent.type(screen.getByRole('textbox', { name: 'Phone number' }), '+١٢٠٢٥٥٥٠١٤٣');

    expect(screen.getByRole('textbox', { name: 'Phone number' })).toHaveValue('+12025550143');
  });
});
