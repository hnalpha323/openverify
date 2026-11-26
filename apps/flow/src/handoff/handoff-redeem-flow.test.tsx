/**
 * C96.3, C96.5 (Workflow 7A; P01, P15): the phone's side of a handoff link.
 *
 * - The context screen comes from the preview, which consumes nothing: the organisation, what will
 *   be verified, when (and, with network data, where) the flow started with its attribution, and
 *   the method's advice, with Decline as prominent as Continue.
 * - Continue redeems the token, once, and runs the flow on the new session, whose first screen is
 *   the phone's own consent. Decline declines and redeems nothing.
 * - A code the desktop shows is asked for where the step asks for one; the context of an email
 *   or SMS to an unconfirmed destination follows the correct code.
 * - The token never appears on the page.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { wholeText } from '../testing/flow-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { FlowApiClient } from '../api/flow-api-client';
import { en } from '../i18n/locales/en';
import { fakeCamera } from '../testing/fake-camera';
import { FakeFlowApi } from '../testing/fake-flow-api';
import { INQUIRY_ID, SESSION_TOKEN } from '../testing/flow-fixtures';
import { renderWithFlow } from '../test-utils';
import { HandoffRedeemFlow } from './handoff-redeem-flow';

const text = en.handoff.phone;
const HANDOFF_TOKEN = `ovh_${'H'.repeat(43)}`;
const BASE_URL = 'https://api.example.com';
const CONSENT_TITLE = 'Consent to use your biometric data';

interface Preview {
  'organization-display-name': string;
  method: 'qr' | 'email' | 'sms';
  'confirmation-code-required': boolean;
  context: Record<string, unknown> | null;
}

const CONTEXT = {
  steps: ['government_id', 'selfie'],
  'started-at': '2026-10-21T12:00:00.000Z',
  'issuing-country-code': null,
  attribution: null,
};

function preview(overrides: Partial<Preview> = {}): Preview {
  return {
    'organization-display-name': 'Example Verification Ltd',
    method: 'qr',
    'confirmation-code-required': false,
    context: CONTEXT,
    ...overrides,
  };
}

function json(body: unknown, status = 200, type = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });
}

function problem(status: number, code: string): Response {
  return json(
    {
      type: 'about:blank',
      title: 'Refused',
      status,
      detail: 'Refused.',
      instance: '/x',
      requestId: 'r',
      code,
    },
    status,
    'application/problem+json',
  );
}

/** A fake API for the three calls, by path; each answer is used in order, the last one kept. */
function server(answers: Partial<Record<'preview' | 'decline' | 'redeem', Response[]>>) {
  const calls: { route: string; body: Record<string, unknown> }[] = [];
  const fetch = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const route = url.split('/').at(-1) ?? '';
    calls.push({
      route,
      body: JSON.parse(typeof init.body === 'string' ? init.body : '{}') as Record<string, unknown>,
    });
    const queue = answers[route as 'preview' | 'decline' | 'redeem'] ?? [];
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return next === undefined
      ? Promise.reject(new Error(`unexpected ${route}`))
      : Promise.resolve(next.clone());
  });
  return { fetch, calls };
}

function renderPhone(
  fake: ReturnType<typeof server>,
  { strict = false }: { strict?: boolean } = {},
) {
  const api = new FakeFlowApi();
  const connect = vi.fn<(sessionToken: string) => FlowApiClient>(() => api.client);
  const ui = (
    <HandoffRedeemFlow
      inquiryId={INQUIRY_ID}
      handoffToken={HANDOFF_TOKEN}
      transport={{ baseUrl: BASE_URL, fetch: fake.fetch }}
      connect={connect}
    />
  );
  const rendered = renderWithFlow(strict ? <StrictMode>{ui}</StrictMode> : ui, {
    environment: fakeCamera().environment,
  });
  return { ...rendered, api, connect };
}

const redeemed = () =>
  json({ 'session-token': SESSION_TOKEN, 'expires-at': '2026-10-22T12:00:00.000Z' });

describe('HandoffRedeemFlow (C96.3, C96.5)', () => {
  it('shows the context screen from the preview, and redeems nothing on arrival', async () => {
    const fake = server({ preview: [json(preview())] });
    const { container } = renderPhone(fake, { strict: true });

    expect(await screen.findByRole('heading', { level: 1, name: text.title })).toBeVisible();
    expect(
      screen.getByText(wholeText('Example Verification Ltd asked to verify your identity.')),
    ).toBeVisible();
    expect(screen.getByText(en.handoff.steps.government_id)).toBeVisible();
    expect(screen.getByText(en.handoff.steps.selfie)).toBeVisible();
    expect(
      screen.getByText(
        "Continue only if you just scanned this code on Example Verification Ltd's own website. If someone sent you this code, decline.",
      ),
    ).toBeVisible();
    const continueButton = screen.getByRole('button', { name: text.continue });
    const declineButton = screen.getByRole('button', { name: text.decline });
    expect(declineButton.dataset.variant).toBe(continueButton.dataset.variant);
    expect(fake.calls.map((call) => call.route)).not.toContain('redeem');
    expect(container.innerHTML).not.toContain(HANDOFF_TOKEN);
  });

  it('names the country the flow started in, with its attribution, when the preview gives one', async () => {
    const fake = server({
      preview: [
        json(
          preview({
            context: {
              ...CONTEXT,
              'issuing-country-code': 'FR',
              attribution: 'IP geolocation by DB-IP',
            },
          }),
        ),
      ],
    });
    renderPhone(fake);

    expect(await screen.findByText(/started on another device in France/)).toBeVisible();
    expect(screen.getByText('IP geolocation by DB-IP')).toBeVisible();
  });

  it('continues: redeems once, then runs the flow on the new session from its own consent', async () => {
    const fake = server({ preview: [json(preview())], redeem: [redeemed()] });
    const { connect, container } = renderPhone(fake, { strict: true });

    await userEvent.click(await screen.findByRole('button', { name: text.continue }));

    expect(await screen.findByRole('heading', { level: 1, name: CONSENT_TITLE })).toBeVisible();
    expect(fake.calls.filter((call) => call.route === 'redeem')).toHaveLength(1);
    expect(connect).toHaveBeenCalledWith(SESSION_TOKEN);
    expect(container.innerHTML).not.toContain(SESSION_TOKEN);
  });

  it('declines: nothing is redeemed, and the phone says so', async () => {
    const fake = server({ preview: [json(preview())], decline: [json(null)] });
    renderPhone(fake);

    await userEvent.click(await screen.findByRole('button', { name: text.decline }));

    expect(
      await screen.findByRole('heading', { level: 1, name: text.declinedTitle }),
    ).toBeVisible();
    expect(fake.calls.map((call) => call.route)).toEqual(['preview', 'decline']);
  });

  it('shows the link as invalid when the preview or the redemption answers 410', async () => {
    renderPhone(server({ preview: [problem(410, 'handoff_token_invalid')] }));
    expect(await screen.findByText(text.invalid)).toBeVisible();
  });

  it('says when the verification has reached its session limit', async () => {
    const fake = server({
      preview: [json(preview())],
      redeem: [problem(409, 'session_limit_reached')],
    });
    renderPhone(fake);

    await userEvent.click(await screen.findByRole('button', { name: text.continue }));

    expect(await screen.findByRole('heading', { level: 1, name: text.limitTitle })).toBeVisible();
  });

  it('asks for the desktop’s code, shows the context once it is right, and sends it on Continue', async () => {
    const fake = server({
      preview: [
        json(preview({ method: 'email', 'confirmation-code-required': true, context: null })),
        json(preview({ method: 'email', 'confirmation-code-required': true })),
      ],
      redeem: [redeemed()],
    });
    renderPhone(fake);

    const field = await screen.findByRole('textbox', { name: text.codeLabel });
    expect(screen.queryByText(en.handoff.steps.selfie)).toBeNull();
    expect(screen.getByRole('button', { name: text.decline })).toBeVisible();
    await userEvent.type(field, '482913');
    await userEvent.click(screen.getByRole('button', { name: text.checkCode }));

    expect(await screen.findByText(en.handoff.steps.selfie)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: text.continue }));

    await waitFor(() => {
      expect(fake.calls.at(-1)).toMatchObject({
        route: 'redeem',
        body: { 'confirmation-code': '482913' },
      });
    });
    expect(fake.calls[1]?.body).toMatchObject({ 'confirmation-code': '482913' });
  });

  it('asks for the code before Continue when the step requires one', async () => {
    const fake = server({
      preview: [json(preview({ 'confirmation-code-required': true }))],
      redeem: [redeemed()],
    });
    renderPhone(fake);

    await userEvent.click(await screen.findByRole('button', { name: text.continue }));

    expect(await screen.findByText(text.codeRequired)).toBeVisible();
    expect(fake.calls.map((call) => call.route)).not.toContain('redeem');
  });
});
