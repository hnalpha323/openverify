import { problemTypeUri, type Problem, type SessionCanceledReason } from '@openverify/contracts';
import type { FlowStep } from '@openverify/flow-spec';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FlowApiError } from '../api/flow-api-client';
import { en } from '../i18n/locales/en';
import { cameraDeliversFrame, fakeCamera } from '../testing/fake-camera';
import { FakeFlowApi } from '../testing/fake-flow-api';
import { INQUIRY_ID, pdfFile, pngFile } from '../testing/flow-fixtures';
import { renderWithFlow } from '../test-utils';
import { FlowRenderer } from './flow-renderer';

const CONSENT_TITLE = 'Consent to use your biometric data';

function renderFlow(api = new FakeFlowApi(), inquiryId = INQUIRY_ID) {
  const camera = fakeCamera();
  renderWithFlow(<FlowRenderer client={api.client} inquiryId={inquiryId} />, {
    environment: camera.environment,
  });
  return { api, camera };
}

async function heading(name: string): Promise<HTMLElement> {
  return screen.findByRole('heading', { level: 1, name });
}

async function giveConsent() {
  await userEvent.click(await screen.findByRole('checkbox', { name: /^I agree/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

async function uploadId() {
  for (const side of ['front', 'back'] as const) {
    await userEvent.upload(await screen.findByLabelText(en.governmentId[side].upload), pngFile());
    await userEvent.click(await screen.findByRole('button', { name: 'Use this photo' }));
  }
}

/**
 * The guided selfie (C46.1) with the fake camera, whose detector never loads: each of the
 * default template's three prompts is taken with the manual shutter.
 */
async function takeSelfie(total = 3) {
  await userEvent.click(await screen.findByRole('button', { name: 'Start the camera' }));
  await cameraDeliversFrame();
  for (let current = 1; current <= total; current += 1) {
    await waitFor(() => {
      expect(screen.getByTestId('selfie-announcement')).toHaveTextContent(
        `Photo ${String(current)} of ${String(total)}:`,
      );
      expect(screen.getByRole('button', { name: 'Capture' })).not.toHaveAttribute(
        'aria-disabled',
        'true',
      );
    });
    await userEvent.click(screen.getByRole('button', { name: 'Capture' }));
  }
}

/** The sandbox's selfie upload fallback (C19): each prompted pose uploaded in the server's order. */
async function uploadSelfie() {
  await userEvent.click(await screen.findByRole('button', { name: 'Upload photos' }));
  for (const pose of ['center', 'left', 'right'] as const) {
    await userEvent.upload(await screen.findByLabelText(en.selfie[pose].upload), pngFile());
    await userEvent.click(await screen.findByRole('button', { name: 'Use this photo' }));
  }
}

describe('FlowRenderer', () => {
  it('announces that the session is loading', () => {
    renderFlow();

    expect(screen.getByRole('status')).toHaveTextContent('Loading your verification…');
  });

  it('runs the default flow from consent to completion', async () => {
    const { api } = renderFlow();

    await heading(CONSENT_TITLE);
    await giveConsent();

    expect(await heading('Photograph your ID')).toHaveFocus();
    await uploadId();

    await heading('Take a selfie');
    await takeSelfie();

    expect(await heading('Verification submitted')).toBeVisible();
    expect(screen.getByText(en.flow.completion)).toBeVisible();
    // C42.3: the matching consent was offered and left unticked.
    expect(api.consent).toEqual({
      textKeys: ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
      optionalTextKeys: [],
      locale: 'en',
    });
    // C45.1: three poses, each uploaded with its capture (C40).
    expect(api.uploadedKinds()).toEqual([
      'front',
      'back',
      'selfie-center',
      'selfie-left',
      'selfie-right',
    ]);
    expect(api.submits.at(-1)?.body?.capture?.id).toBe(api.captures[0]?.id);
    expect(api.inquiryStatus).toBe('completed');
  });

  it('offers the optional matching consent with the session’s retention days (C42.3)', async () => {
    const api = new FakeFlowApi();
    api.faceTemplateRetentionDays = 90;
    renderFlow(api);

    const matching = await screen.findByRole('checkbox', { name: /^Optional: we also compare/ });
    expect(matching).toHaveAccessibleName(
      en.consent['biometric-matching'].replace('{{days}}', '90'),
    );
    await userEvent.click(matching);
    await giveConsent();

    await heading('Photograph your ID');
    expect(api.consent).toEqual({
      textKeys: ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
      optionalTextKeys: ['consent.biometric-matching'],
      locale: 'en',
    });
  });

  it('shows retry hints and counts attempts after a failed attempt', async () => {
    const api = new FakeFlowApi();
    api.decisions.push({
      status: 'failed',
      hints: [{ name: 'id_blur_detection', reasons: ['image_blurry'] }],
    });
    renderFlow(api);
    await giveConsent();
    await uploadId();

    expect(await screen.findByText('Attempt 2 of 3')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(en.retry.reasons.image_blurry);

    await uploadId();

    expect(await heading('Take a selfie')).toBeVisible();
    expect(api.verifications.map((v) => [v.type, v.status])).toEqual([
      ['government_id', 'failed'],
      ['government_id', 'passed'],
    ]);
  });

  it.each([
    ['a government ID', 'needs_review', 'passed'],
    ['a selfie', 'passed', 'needs_review'],
  ] as const)(
    'ends on the normal completion screen when %s is sent to review, without a retry (C30.6)',
    async (_label, id, selfie) => {
      const api = new FakeFlowApi();
      api.decisions.push({ status: id }, { status: selfie });
      renderFlow(api);
      await giveConsent();
      await uploadId();

      expect(await heading('Take a selfie')).toBeVisible();
      expect(screen.getByText('Attempt 1 of 3')).toBeVisible();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      await takeSelfie();

      expect(await heading('Verification submitted')).toBeVisible();
      expect(screen.getByText(en.flow.completion)).toBeVisible();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(api.inquiryStatus).toBe('needs_review');
      expect(api.client.createVerification).toHaveBeenCalledTimes(2);
    },
  );

  it('shows the failure step once the last attempt has failed', async () => {
    const api = new FakeFlowApi();
    api.flow = {
      ...api.flow,
      steps: api.flow.steps.map((step) =>
        step.type === 'government_id' ? { ...step, maxAttempts: 1 } : step,
      ),
    };
    api.decisions.push({ status: 'failed' });
    renderFlow(api);
    await giveConsent();
    await uploadId();

    expect(await heading('Verification not completed')).toBeVisible();
    expect(screen.getByText(en.flow.failure)).toBeVisible();
  });

  it('waits for the inquiry decision after the last failed attempt', async () => {
    const api = new FakeFlowApi();
    api.consent = { textKeys: ['consent.biometric'], locale: 'en' };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { id } = await api.client.createVerification({ type: 'government-id' });
      await api.client.submitVerification(id);
      api.decisions.push({ status: 'failed' });
      await api.client.getVerification(id);
    }
    // The worker has not failed the inquiry yet.
    api.inquiryStatus = 'pending';
    renderFlow(api);

    expect(await heading('Finishing your verification')).toBeVisible();

    api.inquiryStatus = 'failed';

    expect(await heading('Verification not completed')).toBeVisible();
  });

  it('resumes a submitted attempt by checking its status', async () => {
    const api = new FakeFlowApi();
    api.consent = { textKeys: ['consent.biometric'], locale: 'en' };
    const { id } = await api.client.createVerification({ type: 'government-id' });
    await api.client.submitVerification(id);
    api.pendingPolls = 1;
    renderFlow(api);

    expect(await heading('Checking your photos')).toBeVisible();
    expect(await heading('Take a selfie')).toBeVisible();
  });

  it('stops at a step it cannot run instead of skipping it', async () => {
    const api = new FakeFlowApi();
    api.flow = {
      ...api.flow,
      steps: [
        api.flow.steps[0],
        {
          id: 'details',
          type: 'form',
          fields: [{ type: 'text', name: 'name_first', labelKey: 'form.name', required: true }],
        },
        ...api.flow.steps.slice(1),
      ] as typeof api.flow.steps,
    };
    renderFlow(api);
    await giveConsent();

    expect(await heading('This step is not available here')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('a form');
    expect(api.client.createVerification).not.toHaveBeenCalled();
  });

  it('shows the expired screen for an expired inquiry', async () => {
    const api = new FakeFlowApi();
    api.inquiryStatus = 'expired';
    renderFlow(api);

    expect(await heading('This verification link has expired')).toBeVisible();
  });

  it('refuses a session that belongs to another inquiry', async () => {
    renderFlow(new FakeFlowApi(), 'inq_01M5CK16P0D13FXHZSS4TCFBVH');

    expect(await heading('We could not open your verification')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(en.link.mismatch);
  });

  it('explains a failed load and loads again on request', async () => {
    const api = new FakeFlowApi();
    api.client.getSession.mockRejectedValueOnce(new FlowApiError('network', 'no response'));
    renderFlow(api);

    expect(await heading('Something went wrong')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(en.errors.network);

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await heading(CONSENT_TITLE)).toBeVisible();
  });

  it('keeps focus on Try again while a failed load is retried, then moves it to the next heading (2E follow-up)', async () => {
    const api = new FakeFlowApi();
    let failRetry: (error: unknown) => void = () => undefined;
    api.client.getSession
      .mockRejectedValueOnce(new FlowApiError('network', 'no response'))
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failRetry = reject;
          }),
      );
    renderFlow(api);
    expect(await heading('Something went wrong')).toHaveFocus();
    const retry = screen.getByRole('button', { name: 'Try again' });

    await userEvent.click(retry);

    // The error screen stays while the retry runs, so focus never falls to the page.
    expect(document.activeElement).toBe(retry);
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Loading your verification…');
    await userEvent.click(retry);
    expect(api.client.getSession).toHaveBeenCalledTimes(2);

    failRetry(new FlowApiError('timeout', 'GET /api/v1/flow/session timed out'));

    // The same heading text, so wait for the new error before looking at focus.
    expect(await screen.findByText(en.errors.timeout)).toBeVisible();
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { level: 1, name: 'Something went wrong' }),
    );
    expect(screen.getByRole('button', { name: 'Try again' })).not.toHaveAttribute('aria-disabled');

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: CONSENT_TITLE }));
    });
    expect(api.client.getSession).toHaveBeenCalledTimes(3);
  });

  it('explains a failure to reload after consent', async () => {
    const api = new FakeFlowApi();
    renderFlow(api);
    await heading(CONSENT_TITLE);
    api.client.getSession.mockRejectedValueOnce(
      new FlowApiError('http', 'GET failed with HTTP 503', { status: 503 }),
    );

    await giveConsent();

    expect(await heading('Something went wrong')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(en.errors.server);
    await waitFor(() => {
      expect(api.consent).not.toBeNull();
    });
  });

  it('explains a request that timed out, and loads again on request (1B F018)', async () => {
    const api = new FakeFlowApi();
    api.client.getSession.mockRejectedValueOnce(
      new FlowApiError('timeout', 'GET /api/v1/flow/session timed out'),
    );
    renderFlow(api);

    expect(await heading('Something went wrong')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(en.errors.timeout);

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await heading(CONSENT_TITLE)).toBeVisible();
  });
});

function inactive(
  code: 'session_expired' | 'session_canceled',
  reason?: SessionCanceledReason,
): FlowApiError {
  const problem: Problem = {
    type: 'about:blank',
    title: 'Unauthorized',
    status: 401,
    detail: 'The session is no longer active.',
    instance: '/api/v1/flow/session',
    requestId: 'req-1',
    code,
    ...(reason === undefined ? {} : { reason }),
  };
  return new FlowApiError('http', 'failed with HTTP 401', { status: 401, problem });
}

function redacted(): FlowApiError {
  const problem: Problem = {
    type: problemTypeUri('redacted'),
    title: 'Redacted',
    status: 410,
    detail: 'The inquiry was redacted.',
    instance: '/api/v1/flow/consent',
    requestId: 'req-1',
  };
  return new FlowApiError('http', 'failed with HTTP 410', { status: 410, problem });
}

describe('FlowRenderer: sessions that end (C19)', () => {
  it('shows the expired-session screen, with no retry, when the session has expired', async () => {
    const api = new FakeFlowApi();
    api.client.getSession.mockRejectedValueOnce(inactive('session_expired'));
    renderFlow(api);

    expect(await heading(en.ended.expired.title)).toBeVisible();
    expect(screen.getByText(en.ended.expired.message)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('shows the ended-session screen when a write finds the session canceled', async () => {
    const api = new FakeFlowApi();
    api.client.acceptConsent.mockRejectedValueOnce(inactive('session_canceled'));
    renderFlow(api);
    await heading(CONSENT_TITLE);

    await giveConsent();

    expect(await heading(en.ended.canceled.title)).toHaveFocus();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('shows the link-expired screen when the session was canceled because the inquiry expired (C25.8)', async () => {
    const api = new FakeFlowApi();
    api.client.acceptConsent.mockRejectedValueOnce(inactive('session_canceled', 'inquiry_expired'));
    renderFlow(api);
    await heading(CONSENT_TITLE);

    await giveConsent();

    expect(await heading(en.expired.title)).toHaveFocus();
    expect(screen.getByText(en.expired.message)).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the redacted screen when the session was canceled because the inquiry was redacted (C25.8)', async () => {
    const api = new FakeFlowApi();
    api.client.getSession.mockRejectedValueOnce(inactive('session_canceled', 'inquiry_redacted'));
    renderFlow(api);

    expect(await heading(en.ended.redacted.title)).toBeVisible();
    expect(screen.getByText(en.ended.redacted.message)).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the ended screen when the session was canceled because the inquiry finished (C25.8)', async () => {
    const api = new FakeFlowApi();
    api.client.getSession.mockRejectedValueOnce(inactive('session_canceled', 'inquiry_finished'));
    renderFlow(api);

    expect(await heading(en.ended.canceled.title)).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('ends the flow when a photo upload finds the inquiry redacted (410)', async () => {
    const api = new FakeFlowApi();
    api.client.uploadFile.mockRejectedValueOnce(redacted());
    renderFlow(api);
    await heading(CONSENT_TITLE);
    await giveConsent();
    await heading('Photograph your ID');

    await userEvent.upload(await screen.findByLabelText(en.governmentId.front.upload), pngFile());
    await userEvent.click(await screen.findByRole('button', { name: 'Use this photo' }));
    await userEvent.upload(await screen.findByLabelText(en.governmentId.back.upload), pngFile());
    await userEvent.click(await screen.findByRole('button', { name: 'Use this photo' }));

    expect(await heading(en.ended.redacted.title)).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('ends the flow when polling finds the session expired', async () => {
    const api = new FakeFlowApi();
    api.consent = { textKeys: ['consent.biometric'], locale: 'en' };
    api.client.getVerification.mockRejectedValueOnce(inactive('session_expired'));
    renderFlow(api);
    await heading('Photograph your ID');

    await uploadId();

    expect(await heading(en.ended.expired.title)).toBeVisible();
  });

  it('keeps showing a generic 401 as the recoverable error it was', async () => {
    const api = new FakeFlowApi();
    api.client.getSession.mockRejectedValueOnce(
      new FlowApiError('http', 'failed with HTTP 401', { status: 401 }),
    );
    renderFlow(api);

    expect(await heading('Something went wrong')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(en.errors.unauthorized);
  });
});

describe('FlowRenderer: sandbox (C19)', () => {
  it('shows the sandbox banner on every screen of a sandbox session', async () => {
    const api = new FakeFlowApi();
    api.environmentKind = 'sandbox';
    renderFlow(api);

    await heading(CONSENT_TITLE);
    expect(screen.getByRole('note', { name: en.sandbox.label })).toBeVisible();
    await giveConsent();
    await heading('Photograph your ID');
    expect(screen.getByRole('note', { name: en.sandbox.label })).toBeVisible();
  });

  it('keeps the banner on a screen that ends the session', async () => {
    const api = new FakeFlowApi();
    api.environmentKind = 'sandbox';
    api.client.acceptConsent.mockRejectedValueOnce(inactive('session_expired'));
    renderFlow(api);
    await heading(CONSENT_TITLE);

    await giveConsent();

    expect(await heading(en.ended.expired.title)).toBeVisible();
    expect(screen.getByRole('note', { name: en.sandbox.label })).toBeVisible();
  });

  it.each([
    ['production', 'production'],
    ['a server that does not say (Phase 1)', null],
  ] as const)('shows no banner in %s', async (_label, kind) => {
    const api = new FakeFlowApi();
    api.environmentKind = kind;
    renderFlow(api);

    await heading(CONSENT_TITLE);
    expect(screen.queryByRole('note', { name: en.sandbox.label })).not.toBeInTheDocument();
  });

  it('lets a sandbox selfie be uploaded instead of taken with the camera', async () => {
    const api = new FakeFlowApi();
    api.environmentKind = 'sandbox';
    const { camera } = renderFlow(api);
    await giveConsent();
    await uploadId();
    await heading('Take a selfie');

    await uploadSelfie();

    expect(await heading('Verification submitted')).toBeVisible();
    expect(api.uploadedKinds()).toEqual([
      'front',
      'back',
      'selfie-center',
      'selfie-left',
      'selfie-right',
    ]);
    expect(api.captures.map(({ method }) => method)).toEqual(['upload']);
    expect(camera.requestCamera).not.toHaveBeenCalled();
  });

  it('asks for a live selfie in production', async () => {
    const api = new FakeFlowApi();
    api.environmentKind = 'production';
    renderFlow(api);
    await giveConsent();
    await uploadId();
    await heading('Take a selfie');

    expect(screen.queryByLabelText(en.selfie.center.upload)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload photos' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start the camera' })).toBeVisible();
  });
});

/** The default flow with its ID and selfie steps (and their transitions) replaced by `step`. */
function onlyStep(api: FakeFlowApi, step: FlowStep): void {
  const keep = api.flow.steps.filter(
    (candidate) =>
      candidate.type === 'consent' ||
      candidate.type === 'completion' ||
      candidate.type === 'failure',
  );
  // Without the ID and selfie steps, their transitions go too.
  api.flow = {
    ...api.flow,
    steps: [keep[0], step, ...keep.slice(1)] as FlowStep[],
    transitions: [],
  };
}

describe('FlowRenderer: phone and email codes (C64.1)', () => {
  it('runs a phone step from the number to the completion screen', async () => {
    const api = new FakeFlowApi();
    onlyStep(api, { id: 'phone', type: 'phone_otp', allowedCountries: ['US'] });
    renderFlow(api);
    await giveConsent();

    expect(await heading('Confirm your phone number')).toBeVisible();
    // Synthetic: the NANP 555-01xx range is kept for fiction.
    await userEvent.type(screen.getByRole('textbox', { name: 'Phone number' }), '202 555 0143');
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Code' }), api.otpCode);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await heading('Verification submitted')).toBeVisible();
    expect(api.verifications.map(({ type, status }) => [type, status])).toEqual([
      ['phone_number', 'passed'],
    ]);
  });

  it('submits a confirmed email code when the flow resumes on it', async () => {
    const api = new FakeFlowApi();
    onlyStep(api, { id: 'email', type: 'email_otp' });
    api.consent = { textKeys: ['consent.biometric', 'consent.processing'], locale: 'en' };
    api.verifications.push({
      type: 'email_address',
      status: 'confirmed',
      id: 'ver_01M5CK5AAB0000000000000E01',
      hints: [],
    });
    renderFlow(api);

    expect(await heading('Verification submitted')).toBeVisible();
    expect(api.submits).toEqual([
      { verificationId: 'ver_01M5CK5AAB0000000000000E01', body: undefined },
    ]);
  });
});

describe('FlowRenderer: crypto wallets (C64.1)', () => {
  const BITCOIN = 'bip122:000000000019d6689c085ae165831e93';

  it('runs a wallet step by pasting a signature, to the completion screen', async () => {
    const api = new FakeFlowApi();
    onlyStep(api, { id: 'wallet', type: 'crypto_wallet', chains: [BITCOIN], signing: ['paste'] });
    renderFlow(api);
    await giveConsent();

    expect(await heading('Prove that you control your crypto wallet')).toBeVisible();
    // Synthetic: no key exists for it, and the fake API checks no signature.
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Wallet address' }),
      'bc1qsyntheticaddressforflowtestsonly000000',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Get the message to sign' }));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Signature' }), 'smpSynthetic');
    await userEvent.click(screen.getByRole('button', { name: 'Submit signature' }));

    expect(await heading('Verification submitted')).toBeVisible();
    expect(api.verifications.map(({ type, status }) => [type, status])).toEqual([
      ['crypto_wallet', 'passed'],
    ]);
  });

  it('offers to start again after a canceled wallet attempt', async () => {
    const api = new FakeFlowApi();
    onlyStep(api, { id: 'wallet', type: 'crypto_wallet', chains: [BITCOIN], signing: ['paste'] });
    api.consent = { textKeys: ['consent.biometric', 'consent.processing'], locale: 'en' };
    api.verifications.push({
      type: 'crypto_wallet',
      status: 'canceled',
      id: 'ver_01M5CK5AAB0000000000000C01',
      hints: [],
    });
    renderFlow(api);

    expect(await heading('Prove that you control your crypto wallet')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Your last attempt ended because too many messages to sign were asked for. Start again.',
    );
    expect(screen.getByText('Attempt 2 of 3')).toBeVisible();
  });

  it('says why the last wallet attempt failed without speaking of photos', async () => {
    const api = new FakeFlowApi();
    onlyStep(api, { id: 'wallet', type: 'crypto_wallet', chains: [BITCOIN], signing: ['paste'] });
    api.consent = { textKeys: ['consent.biometric', 'consent.processing'], locale: 'en' };
    api.verifications.push({
      type: 'crypto_wallet',
      status: 'failed',
      id: 'ver_01M5CK5AAB0000000000000C02',
      hints: [
        { name: 'crypto_wallet_address_comparison', reasons: ['signature_address_mismatch'] },
      ],
    });
    renderFlow(api);

    expect(await heading('Prove that you control your crypto wallet')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      en.retry.reasons.signature_address_mismatch,
    );
    expect(screen.queryByText(/photo/u)).not.toBeInTheDocument();
  });
});

describe('FlowRenderer: database and AAMVA (C64.1, C59.6)', () => {
  it('runs a database step from its form to the completion screen', async () => {
    const api = new FakeFlowApi();
    onlyStep(api, {
      id: 'records',
      type: 'database',
      fields: ['name_first', 'name_last', 'birthdate', 'address_country_code'],
      requiredFields: ['name_first', 'name_last'],
    });
    renderFlow(api);
    await giveConsent();

    expect(await heading('Enter your details')).toBeVisible();
    await userEvent.type(screen.getByRole('textbox', { name: 'First name' }), 'Alex');
    await userEvent.type(screen.getByRole('textbox', { name: 'Last name' }), 'Example');
    // C52.3: every database body carries the country (DATABASE_REQUIRED_FIELDS).
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Country' }), 'GB');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await heading('Verification submitted')).toBeVisible();
    expect(api.verifications.map(({ type, status }) => [type, status])).toEqual([
      ['database', 'passed'],
    ]);
  });

  it('says the details are being checked, not photos, while a database verification is processed', async () => {
    const api = new FakeFlowApi();
    api.pendingPolls = 1000;
    onlyStep(api, {
      id: 'records',
      type: 'database',
      fields: ['name_first', 'name_last', 'birthdate', 'address_country_code'],
    });
    renderFlow(api);
    await giveConsent();

    expect(await heading('Enter your details')).toBeVisible();
    await userEvent.type(screen.getByRole('textbox', { name: 'First name' }), 'Alex');
    await userEvent.type(screen.getByRole('textbox', { name: 'Last name' }), 'Example');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Country' }), 'GB');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await heading('Checking your verification')).toBeVisible();
    expect(screen.queryByText(/photo/u)).not.toBeInTheDocument();
  });

  it('runs the AAMVA form of a step whose source is the form', async () => {
    const api = new FakeFlowApi();
    onlyStep(api, { id: 'licence', type: 'aamva', source: 'form' });
    renderFlow(api);
    await giveConsent();

    expect(await heading('Enter your driver’s license details')).toBeVisible();
  });

  it('waits on a silent AAMVA step, creating nothing, until the server has decided it', async () => {
    const api = new FakeFlowApi();
    onlyStep(api, { id: 'aamva', type: 'aamva', source: 'government_id' });
    api.consent = { textKeys: ['consent.biometric', 'consent.processing'], locale: 'en' };
    renderFlow(api);

    expect(await heading('Checking your license details')).toBeVisible();
    // C59.6: the server skips it (an ineligible ID), which completes the inquiry.
    api.verifications.push({
      type: 'aamva',
      status: 'skipped',
      id: 'ver_01M5CK5AAB0000000000000A01',
      hints: [],
    });
    api.inquiryStatus = 'completed';

    expect(await heading('Verification submitted')).toBeVisible();
    expect(api.client.createVerification).not.toHaveBeenCalled();
  });
});

describe('FlowRenderer: documents (C60, C64.1)', () => {
  const PROOF: FlowStep = {
    id: 'proof',
    type: 'document',
    documentTypes: ['utility_bill', 'bank_statement'],
    captureMethods: ['upload'],
  };

  it('runs a document step from its upload to the completion screen', async () => {
    const api = new FakeFlowApi();
    onlyStep(api, PROOF);
    renderFlow(api);
    await giveConsent();

    expect(await heading('Upload a document')).toBeVisible();
    expect(await screen.findByText('A utility bill dated within the last 90 days')).toBeVisible();
    await userEvent.upload(screen.getByLabelText('Choose a file of your document'), pdfFile());
    await userEvent.click(await screen.findByRole('button', { name: 'Upload this file' }));

    expect(await heading('Verification submitted')).toBeVisible();
    expect(api.verifications.map(({ type, status }) => [type, status])).toEqual([
      ['document', 'passed'],
    ]);
    expect(api.uploadedKinds()).toEqual(['document']);
  });

  it('says the verification is being checked, not photos, while a document is processed', async () => {
    const api = new FakeFlowApi();
    api.pendingPolls = 1000;
    onlyStep(api, PROOF);
    renderFlow(api);
    await giveConsent();

    await userEvent.upload(
      await screen.findByLabelText('Choose a file of your document'),
      pdfFile(),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Upload this file' }));

    expect(await heading('Checking your verification')).toBeVisible();
    expect(screen.queryByText(/photo/u)).not.toBeInTheDocument();
  });

  it('asks for another document with the reason the last one failed', async () => {
    const api = new FakeFlowApi();
    api.decisions.push({
      status: 'failed',
      hints: [{ name: 'document_recency_detection', reasons: ['document_too_old'] }],
    });
    onlyStep(api, PROOF);
    renderFlow(api);
    await giveConsent();

    await userEvent.upload(
      await screen.findByLabelText('Choose a file of your document'),
      pdfFile(),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Upload this file' }));

    expect(await screen.findByText('Attempt 2 of 3')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Your document is too old. Upload a more recent one.',
    );
  });
});

describe('FlowRenderer: business registry and website (C61, C64.1)', () => {
  it('runs a business registry step from its form to the completion screen', async () => {
    const api = new FakeFlowApi();
    onlyStep(api, { id: 'business', type: 'database_business' });
    renderFlow(api);
    await giveConsent();

    expect(await heading('Tell us about your business')).toBeVisible();
    await userEvent.type(screen.getByRole('textbox', { name: 'Business name' }), 'Example Ltd');
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Country of registration' }),
      'GB',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await heading('Verification submitted')).toBeVisible();
    expect(api.verifications.map(({ type, status }) => [type, status])).toEqual([
      ['database_business', 'passed'],
    ]);
  });

  it('runs a business website step from its form to the completion screen', async () => {
    const api = new FakeFlowApi();
    onlyStep(api, { id: 'website', type: 'business_website' });
    renderFlow(api);
    await giveConsent();

    expect(await heading('Enter your business website')).toBeVisible();
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Website address' }),
      'https://www.example.com',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await heading('Verification submitted')).toBeVisible();
    expect(api.verifications.map(({ type, status }) => [type, status])).toEqual([
      ['business_website', 'passed'],
    ]);
  });
});
