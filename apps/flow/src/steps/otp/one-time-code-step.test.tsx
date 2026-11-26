import type { RetryHint } from '@openverify/contracts';
import type { Flow } from '@openverify/flow-spec';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { wholeText } from '../../testing/flow-renderer';
import { describe, expect, it, vi } from 'vitest';
import { FlowApiError } from '../../api/flow-api-client';
import type { EmailOtpStep, FlowPosition, OtpStep, PhoneOtpStep } from '../../flow/flow-position';
import { FakeFlowApi } from '../../testing/fake-flow-api';
import { AT_ISO, flowVerification } from '../../testing/flow-fixtures';
import { goldenFlowError } from '../../testing/golden-problems';
import { renderWithFlow } from '../../test-utils';
import { OneTimeCodeStep } from './one-time-code-step';

type CapturePosition = Extract<FlowPosition, { kind: 'capture' }> & { step: OtpStep };

const AT = Date.parse(AT_ISO);
/** Synthetic numbers from the ranges kept for drama (Ofcom 020 7946 0xxx, NANP 555-01xx). */
const LONDON = '020 7946 0958';
const LONDON_E164 = '+442079460958';
const NANP = '202 555 0143';
const NANP_E164 = '+12025550143';
const EMAIL = 'casey@example.test';

const PHONE: PhoneOtpStep = { id: 'phone', type: 'phone_otp', allowedCountries: ['US', 'GB'] };
const EMAIL_STEP: EmailOtpStep = { id: 'email', type: 'email_otp' };
const OTP_HINT: RetryHint = { name: 'phone_number_otp_comparison', reasons: ['otp_not_confirmed'] };

function flowWith(step: OtpStep): Flow {
  return {
    metadata: { specVersion: 1, id: 'otp', version: 1, name: 'Codes' },
    steps: [
      { id: 'consent', type: 'consent', textKeys: ['consent.biometric'], required: true },
      step,
      { id: 'done', type: 'completion' },
    ],
    transitions: [],
  };
}

function capture(step: OtpStep, overrides: Partial<CapturePosition> = {}): CapturePosition {
  return {
    kind: 'capture',
    step,
    attempt: 1,
    maxAttempts: 5,
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
  const view = renderWithFlow(
    <OneTimeCodeStep position={position} client={api.client} onSubmitted={onSubmitted} />,
    {
      language,
      // The countdown reads the fake's own clock, so moving it moves both (C55.6).
      environment: { currentTime: () => api.nowMs, countdownIntervalMs: 5 },
    },
  );
  return { api, onSubmitted, view };
}

function heading(name: string) {
  return screen.findByRole('heading', { level: 1, name });
}

async function enterNumber(number: string, country?: string) {
  if (country !== undefined) {
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Country' }), country);
  }
  await userEvent.type(screen.getByRole('textbox', { name: 'Phone number' }), number);
  await userEvent.click(screen.getByRole('button', { name: 'Send code' }));
}

async function enterCode(code: string) {
  const field = await screen.findByRole('textbox', { name: 'Code' });
  await userEvent.clear(field);
  await userEvent.type(field, code);
  await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
}

/** Sends a code to the London number and waits for the code entry. */
async function sendToLondon() {
  await enterNumber(LONDON, 'GB');
  await heading('Enter the code');
}

/** Matches a text that contains `text`, such as an error inside a field's description. */
function including(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

const sendCalls = (api: FakeFlowApi) =>
  api.client.sendOtp.mock.calls.map(([id, body]) => [id, body] as const);

describe('OneTimeCodeStep: phone (C55, C64.1)', () => {
  it('asks for the number with a country chosen from the step’s allowed countries', () => {
    renderStep(capture(PHONE));

    expect(
      screen.getByRole('heading', { level: 1, name: 'Confirm your phone number' }),
    ).toBeVisible();
    expect(screen.getByText('Attempt 1 of 5')).toBeVisible();
    const country = screen.getByRole('combobox', { name: 'Country' });
    expect(
      within(country)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['United Kingdom (+44)', 'United States (+1)']);
    // The step's first country is the default.
    expect(country).toHaveValue('US');
    const number = screen.getByRole('textbox', { name: 'Phone number' });
    expect(number).toHaveAttribute('type', 'tel');
    expect(number).toHaveAttribute('autocomplete', 'tel-national');
    expect(number).toHaveAccessibleDescription('You can leave out the country code.');
  });

  it('sends the number in E.164, then asks for the code it was sent to', async () => {
    const { api } = renderStep(capture(PHONE));

    await enterNumber(NANP);

    expect(await heading('Enter the code')).toHaveFocus();
    expect(api.client.createVerification).toHaveBeenCalledWith(
      { type: 'phone-number' },
      expect.any(AbortSignal),
    );
    const [verification] = api.verifications;
    expect(sendCalls(api)).toEqual([[verification?.id, { 'phone-number': NANP_E164 }]]);
    expect(screen.getByText(wholeText('We sent a code to •••••••0143.'))).toBeVisible();
    const code = screen.getByRole('textbox', { name: 'Code' });
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    expect(code).toHaveAttribute('inputmode', 'numeric');
    // No maxlength: a code pasted with spaces must not be cut short; its length is described.
    expect(code).not.toHaveAttribute('maxlength');
    expect(code).toHaveAttribute('spellcheck', 'false');
    expect(code).toHaveAccessibleDescription('The code has 6 digits.');
    expect(screen.getByText('Tries left for this code: 5')).toBeVisible();
    const expiry = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(
      new Date(AT + 600_000),
    );
    expect(screen.getByText(`The code expires at ${expiry}.`)).toBeVisible();
  });

  it('takes a number typed with its country code, for the country chosen or not', async () => {
    const { api } = renderStep(capture(PHONE));

    await enterNumber('+44 20 7946 0958');

    await heading('Enter the code');
    expect(sendCalls(api)).toEqual([[api.verifications[0]?.id, { 'phone-number': LONDON_E164 }]]);
  });

  it.each([
    ['', 'Enter your phone number.'],
    ['5555', 'Enter a valid phone number for the country you chose.'],
    [
      '+34 612 34 56 78',
      'Codes cannot be sent to this number here. Use a number from one of the countries listed.',
    ],
  ])('refuses %j without sending anything', async (number, message) => {
    const { api } = renderStep(capture(PHONE));

    if (number !== '') {
      await userEvent.type(screen.getByRole('textbox', { name: 'Phone number' }), number);
    }
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }));

    const field = screen.getByRole('textbox', { name: 'Phone number' });
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(including(message));
    expect(api.client.createVerification).not.toHaveBeenCalled();
    expect(api.client.sendOtp).not.toHaveBeenCalled();
  });

  it('confirms the right code, then submits the verification at once', async () => {
    const { api, onSubmitted } = renderStep(capture(PHONE));
    await sendToLondon();

    await enterCode('246810');

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
    const id = api.verifications[0]?.id;
    expect(api.client.confirmOtp.mock.calls.map(([vid, body]) => [vid, body])).toEqual([
      [id, { code: '246810' }],
    ]);
    expect(api.submits).toEqual([{ verificationId: id, body: undefined }]);
    expect(api.verifications[0]?.status).toBe('submitted');
  });

  it('takes a code pasted with spaces', async () => {
    const { api } = renderStep(capture(PHONE));
    await sendToLondon();

    await enterCode('246 810');

    await waitFor(() => {
      expect(api.client.confirmOtp).toHaveBeenCalledTimes(1);
    });
    expect(api.client.confirmOtp.mock.calls[0]?.[1]).toEqual({ code: '246810' });
  });

  it.each([
    ['', 'Enter the code we sent you.'],
    ['24681', 'Enter the 6-digit code.'],
    ['abcdef', 'Enter the 6-digit code.'],
  ])('asks for the whole code before confirming %j', async (code, message) => {
    const { api } = renderStep(capture(PHONE));
    await sendToLondon();

    const field = screen.getByRole('textbox', { name: 'Code' });
    if (code !== '') {
      await userEvent.type(field, code);
    }
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(including(message));
    expect(api.client.confirmOtp).not.toHaveBeenCalled();
  });

  it('takes the step’s longer code', async () => {
    renderStep(capture({ ...PHONE, codeLength: 8 }));
    await sendToLondon();

    const field = screen.getByRole('textbox', { name: 'Code' });
    expect(field).toHaveAccessibleDescription('The code has 8 digits.');
  });

  it('says how many tries are left after a wrong code', async () => {
    renderStep(capture(PHONE));
    await sendToLondon();

    await enterCode('135791');

    const field = await screen.findByRole('textbox', { name: 'Code' });
    await waitFor(() => {
      expect(field).toHaveAttribute('aria-invalid', 'true');
    });
    expect(field).toHaveAccessibleDescription(
      including('That code is not correct. Check it and try again.'),
    );
    expect(screen.getByText('Tries left for this code: 4')).toBeVisible();
  });

  it.each([
    ['otp_expired', 'This code has expired. Ask for a new code.'],
    ['otp_code_exhausted', 'Too many wrong tries for this code. Ask for a new code.'],
  ])('explains a code the server refuses with %s', async (code, message) => {
    const { api } = renderStep(capture(PHONE));
    await sendToLondon();
    api.failures.confirmOtp = [goldenFlowError(code)];

    await enterCode('246810');

    expect(await screen.findByText(message)).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Code' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('goes back to the number when the server has no open code', async () => {
    const { api } = renderStep(capture(PHONE));
    await sendToLondon();
    api.failures.confirmOtp = [goldenFlowError('otp_not_sent')];

    await enterCode('246810');

    await heading('Confirm your phone number');
    expect(screen.getByRole('textbox', { name: 'Phone number' })).toHaveAccessibleDescription(
      including('Ask for a code first.'),
    );
  });

  it.each(['otp_attempts_exhausted', 'otp_not_confirmed'])(
    'reloads the session when %s says the server submitted the verification',
    async (code) => {
      const { api, onSubmitted } = renderStep(capture(PHONE));
      await sendToLondon();
      api.failures.confirmOtp = [goldenFlowError(code)];

      await enterCode('135791');

      await waitFor(() => {
        expect(onSubmitted).toHaveBeenCalledTimes(1);
      });
      expect(api.client.submitVerification).not.toHaveBeenCalled();
    },
  );

  it('submits at once when the code was already confirmed', async () => {
    const { api, onSubmitted } = renderStep(capture(PHONE));
    await sendToLondon();
    const [verification] = api.verifications;
    if (verification !== undefined) {
      verification.status = 'confirmed';
    }

    await enterCode('246810');

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
    expect(api.submits).toHaveLength(1);
  });

  it('counts down to the next code on the clock, then sends a new one', async () => {
    const { api } = renderStep(capture(PHONE));
    await sendToLondon();

    const resend = screen.getByRole('button', { name: 'Send a new code' });
    expect(resend).toHaveAttribute('aria-disabled', 'true');
    expect(resend).toHaveAccessibleDescription('You can ask for a new code in 0:30.');
    await userEvent.click(resend);
    expect(api.client.sendOtp).toHaveBeenCalledTimes(1);

    api.nowMs = AT + 12_000;
    await waitFor(() => {
      expect(resend).toHaveAccessibleDescription('You can ask for a new code in 0:18.');
    });
    api.nowMs = AT + 30_000;
    const ready = await screen.findByText('You can now ask for a new code.');
    expect(ready).toHaveAttribute('role', 'status');
    expect(resend).not.toHaveAttribute('aria-disabled');

    await userEvent.click(resend);

    expect(await screen.findByText(wholeText('We sent a new code to •••••••0958.'))).toBeVisible();
    expect(sendCalls(api)).toEqual([
      [api.verifications[0]?.id, { 'phone-number': LONDON_E164 }],
      [api.verifications[0]?.id, { 'phone-number': LONDON_E164 }],
    ]);
    // C55.6: the second send waits 60 s for the third.
    expect(screen.getByRole('button', { name: 'Send a new code' })).toHaveAccessibleDescription(
      'You can ask for a new code in 1:00.',
    );
  });

  it('shows the wait the server asks for when a new code is asked for too soon', async () => {
    const { api } = renderStep(capture(PHONE));
    await sendToLondon();
    api.nowMs = AT + 30_000;
    await screen.findByText('You can now ask for a new code.');
    api.failures.sendOtp = [
      goldenFlowError('otp_resend_too_soon', {
        'resend-available-at': new Date(AT + 90_000).toISOString(),
      }),
    ];

    await userEvent.click(screen.getByRole('button', { name: 'Send a new code' }));

    expect(await screen.findByText('Wait a little before you ask for a new code.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Send a new code' })).toHaveAccessibleDescription(
      'You can ask for a new code in 1:00.',
    );
  });

  it('says when the code has expired on the clock', async () => {
    const { api } = renderStep(capture(PHONE));
    await sendToLondon();

    api.nowMs = AT + 600_000;

    expect(await screen.findByText('This code has expired. Ask for a new code.')).toBeVisible();
  });

  it('lets the user change the number, keeping what was typed', async () => {
    const { api } = renderStep(capture(PHONE));
    await sendToLondon();

    await userEvent.click(screen.getByRole('button', { name: 'Change phone number' }));

    expect(await heading('Confirm your phone number')).toHaveFocus();
    expect(screen.getByRole('combobox', { name: 'Country' })).toHaveValue('GB');
    const number = screen.getByRole('textbox', { name: 'Phone number' });
    expect(number).toHaveValue(LONDON);
    await userEvent.clear(number);
    api.nowMs = AT + 30_000;
    await enterNumber(NANP, 'US');

    await heading('Enter the code');
    expect(sendCalls(api).at(-1)).toEqual([
      api.verifications[0]?.id,
      { 'phone-number': NANP_E164 },
    ]);
    // One verification for the attempt, whichever number it ends with.
    expect(api.client.createVerification).toHaveBeenCalledTimes(1);
  });

  it('asks the user to wait when another number is sent to before the wait is over', async () => {
    renderStep(capture(PHONE));
    await sendToLondon();
    await userEvent.click(screen.getByRole('button', { name: 'Change phone number' }));
    await userEvent.clear(screen.getByRole('textbox', { name: 'Phone number' }));

    // C55.6: the wait belongs to the verification, whichever number the next code goes to.
    await enterNumber(NANP, 'US');

    const field = await screen.findByRole('textbox', { name: 'Phone number' });
    await waitFor(() => {
      expect(field).toHaveAccessibleDescription(
        including('Wait a little before you ask for a new code.'),
      );
    });
  });

  it('reads the session again when a send opened no code', async () => {
    const { api, onSubmitted } = renderStep(capture(PHONE));
    api.client.sendOtp.mockResolvedValueOnce(
      flowVerification('phone_number', 'initiated', {
        guidance: { 'allowed-countries': ['US', 'GB'], 'code-length': 6, otp: null },
      }),
    );

    await enterNumber(LONDON, 'GB');

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
  });

  it.each([
    [
      'otp_delivery_failed',
      'We could not send a code to this number. Check it and try again, or use another number.',
    ],
    [
      'otp_destination_invalid',
      'This number cannot receive a code. Check it, or use another phone number.',
    ],
    [
      'otp_destination_not_allowed',
      'Codes cannot be sent to this number here. Use a number from one of the countries listed.',
    ],
  ])('keeps the user on the number after %s', async (code, message) => {
    const { api } = renderStep(capture(PHONE));
    api.failures.sendOtp = [goldenFlowError(code)];

    await enterNumber(LONDON, 'GB');

    const field = await screen.findByRole('textbox', { name: 'Phone number' });
    await waitFor(() => {
      expect(field).toHaveAccessibleDescription(including(message));
    });
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveValue(LONDON);
  });

  it('goes back to the number when a new code cannot be delivered', async () => {
    const { api } = renderStep(capture(PHONE));
    await sendToLondon();
    api.nowMs = AT + 30_000;
    await screen.findByText('You can now ask for a new code.');
    api.failures.sendOtp = [goldenFlowError('otp_delivery_failed')];

    await userEvent.click(screen.getByRole('button', { name: 'Send a new code' }));

    await heading('Confirm your phone number');
    expect(screen.getByRole('textbox', { name: 'Phone number' })).toHaveAccessibleDescription(
      including('We could not send a code to this number.'),
    );
  });

  it('explains a request that failed, and sends again on request', async () => {
    const { api } = renderStep(capture(PHONE));
    api.failures.sendOtp = [new FlowApiError('network', 'POST /otp failed')];

    await enterNumber(LONDON, 'GB');

    expect(
      await screen.findByText(
        'We could not reach the verification service. Check your connection and try again.',
      ),
    ).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }));
    await heading('Enter the code');
  });

  it('says a refusal it has no words for without speaking of photos', async () => {
    const { api } = renderStep(capture(PHONE));
    api.failures.sendOtp = [new FlowApiError('http', 'POST /otp failed', { status: 422 })];

    await enterNumber(LONDON, 'GB');

    expect(
      await screen.findByText('This was not accepted. Check what you entered and try again.'),
    ).toBeVisible();
    expect(screen.queryByText(/photo/u)).not.toBeInTheDocument();
  });

  it('reloads the session when the server moved the verification on', async () => {
    const { api, onSubmitted } = renderStep(capture(PHONE));
    api.failures.sendOtp = [new FlowApiError('http', 'POST /otp failed', { status: 409 })];

    await enterNumber(LONDON, 'GB');

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
  });

  it('reloads the session when a send after the last one submitted the verification', async () => {
    const { api, onSubmitted } = renderStep(capture(PHONE));
    api.failures.sendOtp = [goldenFlowError('otp_not_confirmed')];

    await enterNumber(LONDON, 'GB');

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
    expect(api.verifications[0]?.status).toBe('submitted');
  });

  describe('a limit refusal (C55.6, C55.7)', () => {
    it.each([
      ['a limit', goldenFlowError('otp_rate_limited')],
      [
        'the limit store being down',
        goldenFlowError('otp_rate_limited', { status: 503, title: 'Service Unavailable' }),
      ],
    ])('offers to continue for review after %s refused a send', async (_label, refusal) => {
      const { api, onSubmitted } = renderStep(capture(PHONE));
      api.failures.sendOtp = [refusal];

      await enterNumber(LONDON, 'GB');

      expect(await heading('We cannot send you a code right now')).toHaveFocus();
      expect(
        screen.getByText(
          'We could not send or check a code for you just now. You can continue, and the organization that asked you to verify will review your verification.',
        ),
      ).toBeVisible();
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

      await waitFor(() => {
        expect(onSubmitted).toHaveBeenCalledTimes(1);
      });
      expect(api.submits).toEqual([{ verificationId: api.verifications[0]?.id, body: undefined }]);
    });

    it('offers to continue after a limit refused a code', async () => {
      const { api } = renderStep(capture(PHONE));
      await sendToLondon();
      api.failures.confirmOtp = [goldenFlowError('otp_rate_limited')];

      await enterCode('246810');

      expect(await heading('We cannot send you a code right now')).toBeVisible();
    });

    it('says when continuing was refused, then tries again', async () => {
      const { api, onSubmitted } = renderStep(capture(PHONE));
      api.failures.sendOtp = [goldenFlowError('otp_rate_limited')];
      api.failures.submitVerification = [
        new FlowApiError('http', 'POST /submit failed', { status: 409 }),
      ];
      await enterNumber(LONDON, 'GB');
      await heading('We cannot send you a code right now');

      await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

      expect(
        await screen.findByText('We could not continue. Wait a while, then try again.'),
      ).toBeVisible();
      // A 409 means the server may have moved on: the session is read again.
      expect(onSubmitted).toHaveBeenCalledTimes(1);
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await waitFor(() => {
        expect(onSubmitted).toHaveBeenCalledTimes(2);
      });
      expect(api.submits).toHaveLength(1);
    });

    it('explains a continue that never reached the server', async () => {
      const { api } = renderStep(capture(PHONE));
      api.failures.sendOtp = [goldenFlowError('otp_rate_limited')];
      api.failures.submitVerification = [new FlowApiError('network', 'POST /submit failed')];
      await enterNumber(LONDON, 'GB');

      await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));

      expect(
        await screen.findByText(
          'We could not reach the verification service. Check your connection and try again.',
        ),
      ).toBeVisible();
    });
  });

  describe('resuming (C64.1)', () => {
    async function openCode(api: FakeFlowApi, overrides: Partial<FakeOtpState> = {}) {
      api.flow = flowWith(PHONE);
      api.consent = { textKeys: ['consent.biometric'], locale: 'en' };
      const created = await api.client.createVerification({ type: 'phone-number' });
      const verification = api.verification(created.id);
      verification.sends = overrides.sends ?? 1;
      verification.otp = {
        destination: LONDON_E164,
        sentAtMs: overrides.sentAtMs ?? AT,
        attemptsRemaining: overrides.attemptsRemaining ?? 5,
      };
      const session = await api.client.getSession();
      const resource = session.verifications.find(({ id }) => id === created.id);
      if (resource === undefined) {
        throw new Error('no resource');
      }
      api.client.createVerification.mockClear();
      return capture(PHONE, { verificationId: created.id, verification: resource });
    }

    interface FakeOtpState {
      sends: number;
      sentAtMs: number;
      attemptsRemaining: number;
    }

    it('asks for the open code of the verification it reuses', async () => {
      const api = new FakeFlowApi();
      const position = await openCode(api, { attemptsRemaining: 3 });
      const { onSubmitted } = renderStep(position, { api });

      expect(await heading('Enter the code')).toBeVisible();
      expect(screen.getByText(wholeText('We sent a code to •••••••0958.'))).toBeVisible();
      expect(screen.getByText('Tries left for this code: 3')).toBeVisible();
      await enterCode('246810');

      await waitFor(() => {
        expect(onSubmitted).toHaveBeenCalledTimes(1);
      });
      expect(api.client.createVerification).not.toHaveBeenCalled();
    });

    it('asks for the number of an initiated verification without a code', async () => {
      const api = new FakeFlowApi();
      api.flow = flowWith(PHONE);
      api.consent = { textKeys: ['consent.biometric'], locale: 'en' };
      const created = await api.client.createVerification({ type: 'phone-number' });
      api.client.createVerification.mockClear();
      renderStep(capture(PHONE, { verificationId: created.id, verification: created }), { api });

      await enterNumber(LONDON, 'GB');

      await heading('Enter the code');
      expect(api.client.createVerification).not.toHaveBeenCalled();
      expect(sendCalls(api)).toEqual([[created.id, { 'phone-number': LONDON_E164 }]]);
    });

    it('asks for the number again, without an error, when a new code is asked for after a resume (Workflow 5C review P027)', async () => {
      const api = new FakeFlowApi();
      // The first code's 30 s wait is over, so a new one may be asked for.
      const position = await openCode(api, { sentAtMs: AT - 60_000 });
      renderStep(position, { api });

      await userEvent.click(await screen.findByRole('button', { name: 'Send a new code' }));

      // Only the user knows the number: the server serves it masked (C52.2).
      expect(await heading('Confirm your phone number')).toHaveFocus();
      const field = screen.getByRole('textbox', { name: 'Phone number' });
      expect(field).not.toHaveAttribute('aria-invalid');
      expect(field).not.toHaveAccessibleDescription(including('Enter your phone number.'));
      expect(api.client.sendOtp).not.toHaveBeenCalled();
      await enterNumber(LONDON, 'GB');
      await heading('Enter the code');
      expect(sendCalls(api)).toEqual([[position.verificationId, { 'phone-number': LONDON_E164 }]]);
    });

    it('says no more codes can be sent once none is left', async () => {
      const api = new FakeFlowApi();
      renderStep(await openCode(api, { sends: 5 }), { api });

      expect(await screen.findByText('No more codes can be sent.')).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Send a new code' })).not.toBeInTheDocument();
    });

    it('offers to start again when the last code has expired and none is left', async () => {
      const api = new FakeFlowApi();
      const position = await openCode(api, { sends: 5, sentAtMs: AT - 600_000 });
      const { onSubmitted } = renderStep(position, { api });

      expect(
        await screen.findByText(
          'This code has expired, and no more codes can be sent. Start again to get a new code.',
        ),
      ).toBeVisible();
      await userEvent.click(screen.getByRole('button', { name: 'Start again' }));
      expect(await heading('Confirm your phone number')).toHaveFocus();
      await enterNumber(LONDON, 'GB');

      // C55.6: the send after the last one submits the attempt, so the session moves on.
      await waitFor(() => {
        expect(onSubmitted).toHaveBeenCalledTimes(1);
      });
    });
  });

  it('shows why the previous attempt failed', () => {
    renderStep(capture(PHONE, { attempt: 2, hints: [OTP_HINT] }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The code was not confirmed in time. Start again to get a new code.',
    );
    expect(screen.getByText('Attempt 2 of 5')).toBeVisible();
  });

  it('speaks Spanish', async () => {
    renderStep(capture(PHONE), { language: 'es' });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Confirma tu número de teléfono' }),
    ).toBeVisible();
    expect(screen.getByRole('option', { name: 'Reino Unido (+44)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar código' })).toBeVisible();
  });
});

describe('OneTimeCodeStep: email (C55, C64.1)', () => {
  it('asks for the address and sends a code to it', async () => {
    const { api } = renderStep(capture(EMAIL_STEP));

    expect(
      screen.getByRole('heading', { level: 1, name: 'Confirm your email address' }),
    ).toBeVisible();
    const field = screen.getByRole('textbox', { name: 'Email address' });
    expect(field).toHaveAttribute('type', 'email');
    expect(field).toHaveAttribute('autocomplete', 'email');
    await userEvent.type(field, `  ${EMAIL} `);
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }));

    expect(await heading('Enter the code')).toHaveFocus();
    expect(api.client.createVerification).toHaveBeenCalledWith(
      { type: 'email-address' },
      expect.any(AbortSignal),
    );
    expect(sendCalls(api)).toEqual([[api.verifications[0]?.id, { 'email-address': EMAIL }]]);
    expect(screen.getByText(wholeText('We sent a code to c•••@example.test.'))).toBeVisible();
    expect(screen.getByRole('button', { name: 'Change email address' })).toBeVisible();
  });

  it.each([
    ['', 'Enter your email address.'],
    ['casey@', 'Enter an email address in the correct format, like name@example.com.'],
    ['casey@example', 'Enter an email address in the correct format, like name@example.com.'],
    [
      'casey example@example.test',
      'Enter an email address in the correct format, like name@example.com.',
    ],
  ])('refuses %j without sending anything', async (address, message) => {
    const { api } = renderStep(capture(EMAIL_STEP));

    const field = screen.getByRole('textbox', { name: 'Email address' });
    if (address !== '') {
      await userEvent.type(field, address);
    }
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }));

    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(message);
    expect(api.client.sendOtp).not.toHaveBeenCalled();
  });

  it('asks for the address again, without an error, when a new code is asked for after a resume (Workflow 5C review P027)', async () => {
    const api = new FakeFlowApi();
    api.flow = flowWith(EMAIL_STEP);
    api.consent = { textKeys: ['consent.biometric'], locale: 'en' };
    const created = await api.client.createVerification({ type: 'email-address' });
    const held = api.verification(created.id);
    held.sends = 1;
    held.otp = { destination: EMAIL, sentAtMs: AT - 60_000, attemptsRemaining: 5 };
    const session = await api.client.getSession();
    const resource = session.verifications.find(({ id }) => id === created.id);
    if (resource === undefined) {
      throw new Error('no resource');
    }
    renderStep(capture(EMAIL_STEP, { verificationId: created.id, verification: resource }), {
      api,
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Send a new code' }));

    expect(await heading('Confirm your email address')).toHaveFocus();
    const field = screen.getByRole('textbox', { name: 'Email address' });
    expect(field).not.toHaveAttribute('aria-invalid');
    expect(api.client.sendOtp).not.toHaveBeenCalled();
  });

  it('explains an address that cannot receive a code', async () => {
    const { api } = renderStep(capture(EMAIL_STEP));
    api.failures.sendOtp = [goldenFlowError('otp_delivery_failed')];

    await userEvent.type(screen.getByRole('textbox', { name: 'Email address' }), EMAIL);
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }));

    expect(
      await screen.findByText(
        'We could not send a code to this email address. Check it and try again, or use another email address.',
      ),
    ).toBeVisible();
  });
});

/**
 * WCAG 2.2 AA (3.3.1, 4.1.3; C64.1): a field's error is its description, not a live region, so
 * focus moves to the field that holds it, and a screen reader reads the error with the field.
 */
describe('OneTimeCodeStep: focus on what was refused (C64.1, WCAG 2.2 AA)', () => {
  it('moves focus to a number the browser refuses', async () => {
    renderStep(capture(PHONE));

    await userEvent.click(screen.getByRole('button', { name: 'Send code' }));

    expect(screen.getByRole('textbox', { name: 'Phone number' })).toHaveFocus();
  });

  it('moves focus to a number the server refuses', async () => {
    const { api } = renderStep(capture(PHONE));
    api.failures.sendOtp = [goldenFlowError('otp_destination_invalid')];

    await enterNumber(LONDON, 'GB');

    const field = screen.getByRole('textbox', { name: 'Phone number' });
    await waitFor(() => {
      expect(field).toHaveAttribute('aria-invalid', 'true');
    });
    expect(field).toHaveFocus();
  });

  it('moves focus to the number when a new code cannot be delivered to it', async () => {
    const { api } = renderStep(capture(PHONE));
    await sendToLondon();
    api.nowMs = AT + 30_000;
    await screen.findByText('You can now ask for a new code.');
    api.failures.sendOtp = [goldenFlowError('otp_delivery_failed')];

    await userEvent.click(screen.getByRole('button', { name: 'Send a new code' }));

    await heading('Confirm your phone number');
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Phone number' })).toHaveFocus();
    });
  });

  it('moves focus to a code the browser refuses', async () => {
    renderStep(capture(PHONE));
    await sendToLondon();

    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(screen.getByRole('textbox', { name: 'Code' })).toHaveFocus();
  });

  it('moves focus to a wrong code, whose tries left are said', async () => {
    renderStep(capture(PHONE));
    await sendToLondon();

    await enterCode('135791');

    const field = screen.getByRole('textbox', { name: 'Code' });
    await waitFor(() => {
      expect(field).toHaveAttribute('aria-invalid', 'true');
    });
    expect(field).toHaveFocus();
  });

  it('says the tries left with a refused code, so they are read with its error (WCAG 4.1.3)', async () => {
    renderStep(capture(PHONE));
    await sendToLondon();

    await enterCode('135791');

    const field = screen.getByRole('textbox', { name: 'Code' });
    await waitFor(() => {
      expect(field).toHaveAccessibleDescription(
        'The code has 6 digits. That code is not correct. Check it and try again. Tries left for this code: 4',
      );
    });
  });

  it('says the tries left with a code the browser refuses', async () => {
    renderStep(capture(PHONE));
    await sendToLondon();

    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(screen.getByRole('textbox', { name: 'Code' })).toHaveAccessibleDescription(
      'The code has 6 digits. Enter the code we sent you. Tries left for this code: 5',
    );
  });

  it('moves focus to an email address the browser refuses', async () => {
    renderStep(capture(EMAIL_STEP));

    await userEvent.type(screen.getByRole('textbox', { name: 'Email address' }), 'casey@');
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }));

    expect(screen.getByRole('textbox', { name: 'Email address' })).toHaveFocus();
  });

  it('leaves focus on the heading when the user goes back to change the number', async () => {
    renderStep(capture(PHONE));
    // A refusal first: going back later is no refusal, so focus goes to the heading.
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }));
    await enterNumber(LONDON, 'GB');
    await heading('Enter the code');

    await userEvent.click(screen.getByRole('button', { name: 'Change phone number' }));

    expect(await heading('Confirm your phone number')).toHaveFocus();
  });
});
