import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FlowApiError, type FlowApiClient } from '../api/flow-api-client';
import { en } from '../i18n/locales/en';
import { fakeCamera } from '../testing/fake-camera';
import { FakeFlowApi } from '../testing/fake-flow-api';
import { INQUIRY_ID, SESSION_TOKEN } from '../testing/flow-fixtures';
import { renderWithFlow } from '../test-utils';
import { OneTimeLinkFlow } from './one-time-link-flow';

const CONSENT_TITLE = 'Consent to use your biometric data';

function refused(): FlowApiError {
  return new FlowApiError('http', 'POST /api/v1/flow/one-time-links/redeem failed with HTTP 401', {
    status: 401,
  });
}

function setup(...outcomes: (Error | { sessionToken: string })[]): {
  api: FakeFlowApi;
  redeem: ReturnType<typeof vi.fn<() => Promise<{ sessionToken: string }>>>;
  connect: ReturnType<typeof vi.fn<(sessionToken: string) => FlowApiClient>>;
} {
  const api = new FakeFlowApi();
  const queue = [...outcomes];
  const redeem = vi.fn(() => {
    const next = queue.shift() ?? { sessionToken: SESSION_TOKEN };
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  const connect = vi.fn<(sessionToken: string) => FlowApiClient>(() => api.client);
  return { api, redeem, connect };
}

function renderLink(
  { redeem, connect }: Pick<ReturnType<typeof setup>, 'redeem' | 'connect'>,
  { strict = false }: { strict?: boolean } = {},
) {
  const ui = <OneTimeLinkFlow inquiryId={INQUIRY_ID} redeem={redeem} connect={connect} />;
  return renderWithFlow(strict ? <StrictMode>{ui}</StrictMode> : ui, {
    environment: fakeCamera().environment,
  });
}

describe('OneTimeLinkFlow (C19)', () => {
  it('announces that it is opening the link', () => {
    const { redeem, connect } = setup();
    redeem.mockReturnValueOnce(new Promise(() => undefined));
    renderLink({ redeem, connect });

    expect(screen.getByRole('status')).toHaveTextContent(en.loading);
  });

  it('redeems the link, then runs the flow with the session it got', async () => {
    const { api, redeem, connect } = setup({ sessionToken: SESSION_TOKEN });
    renderLink({ redeem, connect });

    expect(await screen.findByRole('heading', { level: 1, name: CONSENT_TITLE })).toBeVisible();
    expect(redeem).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(SESSION_TOKEN);
    expect(api.client.getSession).toHaveBeenCalled();
  });

  it('redeems only once, even when React runs its effects twice (StrictMode)', async () => {
    const { redeem, connect } = setup({ sessionToken: SESSION_TOKEN });
    renderLink({ redeem, connect }, { strict: true });

    await screen.findByRole('heading', { level: 1, name: CONSENT_TITLE });
    expect(redeem).toHaveBeenCalledTimes(1);
  });

  it('never shows the session token on the page', async () => {
    const { redeem, connect } = setup({ sessionToken: SESSION_TOKEN });
    const { container } = renderLink({ redeem, connect });

    await screen.findByRole('heading', { level: 1, name: CONSENT_TITLE });
    expect(container.innerHTML).not.toContain(SESSION_TOKEN);
  });

  it('explains a used or expired link, with no way to retry it', async () => {
    const { redeem, connect } = setup(refused());
    renderLink({ redeem, connect });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'We could not open your verification' }),
    ).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(en.link.used);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(connect).not.toHaveBeenCalled();
  });

  it.each([
    ['a network failure', new FlowApiError('network', 'no response'), en.errors.network],
    ['a timeout (1B F018)', new FlowApiError('timeout', 'timed out'), en.errors.timeout],
    [
      'rate limiting',
      new FlowApiError('http', 'failed with HTTP 429', { status: 429 }),
      en.errors.rateLimited,
    ],
  ])('lets the user retry after %s', async (_label, error, message) => {
    const { redeem, connect } = setup(error, { sessionToken: SESSION_TOKEN });
    renderLink({ redeem, connect });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Something went wrong' }),
    ).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(message);

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { level: 1, name: CONSENT_TITLE })).toBeVisible();
    expect(redeem).toHaveBeenCalledTimes(2);
  });
});

/** A promise the test settles. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe('OneTimeLinkFlow: focus around a retry (Workflow 2D F016)', () => {
  const ERROR_TITLE = 'Something went wrong';

  async function failFirst() {
    const { redeem, connect } = setup(new FlowApiError('network', 'no response'));
    const retried = deferred<{ sessionToken: string }>();
    renderLink({ redeem, connect });
    await screen.findByRole('heading', { level: 1, name: ERROR_TITLE });
    redeem.mockReturnValueOnce(retried.promise);
    const retry = screen.getByRole('button', { name: 'Try again' });
    await userEvent.click(retry);
    return { redeem, retried, retry };
  }

  it('keeps focus on Try again while the retry runs, and redeems once however often it is pressed', async () => {
    const { redeem, retry } = await failFirst();

    expect(retry).toBeInTheDocument();
    expect(retry).toHaveFocus();
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('status')).toHaveTextContent(en.loading);

    await userEvent.click(retry);

    expect(redeem).toHaveBeenCalledTimes(2);
  });

  it('moves focus to the heading of the flow once the retried link opens it', async () => {
    const { retried } = await failFirst();

    retried.resolve({ sessionToken: SESSION_TOKEN });

    const consent = await screen.findByRole('heading', { level: 1, name: CONSENT_TITLE });
    await waitFor(() => {
      expect(consent).toHaveFocus();
    });
  });

  it('moves focus to the used-link heading when the retried link is refused', async () => {
    const { retried } = await failFirst();

    retried.reject(refused());

    const heading = await screen.findByRole('heading', {
      level: 1,
      name: 'We could not open your verification',
    });
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
  });

  it('moves focus to the error heading, and offers Try again again, when the retry fails too', async () => {
    const { redeem, retried } = await failFirst();

    retried.reject(new FlowApiError('timeout', 'timed out'));

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: ERROR_TITLE })).toHaveFocus();
    });
    expect(screen.getByRole('alert')).toHaveTextContent(en.errors.timeout);
    const again = screen.getByRole('button', { name: 'Try again' });
    expect(again).not.toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(again);

    expect(await screen.findByRole('heading', { level: 1, name: CONSENT_TITLE })).toBeVisible();
    expect(redeem).toHaveBeenCalledTimes(3);
  });
});
