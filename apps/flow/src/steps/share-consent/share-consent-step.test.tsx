/**
 * C238.6 (Phase 11, Workflow 11A; `clients-connect`): the web flow's share-consent screen. It shows
 * the text the server composed as it was served (nothing composed on the client), the recipient,
 * the source and the categories in words, and, when served, the separate biometric text with its
 * own unticked box. Accept echoes the SHA-256 of each text it displayed and the tick; decline sends
 * nothing else; a text whose digest is not the one served is never reported shown: the screen is
 * the unsupported one. Busy and refused states are announced (C171).
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FlowApiError, type FlowApiClient } from '../../api/flow-api-client';
import { en } from '../../i18n/locales/en';
import { shareConsentEn } from './locales/en';
import { renderWithI18n } from '../../test-utils';
import { ShareConsentStep } from './share-consent-step';
import { shareConsentAr } from './locales/ar';
import { SYNTHETIC_BIOMETRIC, SYNTHETIC_BODY, digestOf, shareConsentView } from './testing';

const SESSION = {} as Awaited<ReturnType<FlowApiClient['getSession']>>;

function scriptedClient() {
  const acceptShareConsent = vi.fn<FlowApiClient['acceptShareConsent']>(() =>
    Promise.resolve(SESSION),
  );
  const declineShareConsent = vi.fn<FlowApiClient['declineShareConsent']>(() =>
    Promise.resolve(SESSION),
  );
  return {
    client: { acceptShareConsent, declineShareConsent } as unknown as FlowApiClient,
    acceptShareConsent,
    declineShareConsent,
  };
}

const title = (recipient: string) =>
  shareConsentEn.consent.title.replace('{{recipient}}', recipient);
const agree = () => screen.getByRole('button', { name: shareConsentEn.consent.accept });
const decline = () => screen.getByRole('button', { name: shareConsentEn.consent.decline });

describe('ShareConsentStep (C238.6)', () => {
  it('shows the served text, the recipient, the source and the categories in words', () => {
    const { client } = scriptedClient();
    const { container } = renderWithI18n(
      <ShareConsentStep step={shareConsentView()} client={client} onDone={vi.fn()} />,
    );

    expect(screen.getByRole('heading', { level: 1, name: title('Example Partner') })).toBeVisible();
    for (const paragraph of SYNTHETIC_BODY.split('\n\n')) {
      expect(screen.getByText(paragraph)).toBeVisible();
    }
    expect(screen.getByText(shareConsentEn.step.sharedWith)).toBeVisible();
    expect(screen.getByText(shareConsentEn.step.sharedBy)).toBeVisible();
    expect(screen.getByText('Example Source')).toBeVisible();
    for (const category of ['identity-fields', 'biometric', 'check-results'] as const) {
      expect(screen.getByText(shareConsentEn.categories[category])).toBeVisible();
    }
    expect(screen.queryByText(shareConsentEn.categories['document-images'])).toBeNull();
    // Nothing is composed here: no placeholder is left and no id is shown.
    expect(container.textContent).not.toMatch(/\{\{|\}\}|cnst_|cxn_|cnsr_/);
  });

  it('offers the biometric text as its own box, unticked', () => {
    const { client } = scriptedClient();
    renderWithI18n(<ShareConsentStep step={shareConsentView()} client={client} onDone={vi.fn()} />);

    const box = screen.getByRole('checkbox', { name: SYNTHETIC_BIOMETRIC });
    expect(box).not.toBeChecked();
    expect(agree()).toBeEnabled();
    expect(decline()).toBeEnabled();
  });

  it('asks for the tick before an accept that carries biometric data, and sends nothing', async () => {
    const { client, acceptShareConsent } = scriptedClient();
    renderWithI18n(<ShareConsentStep step={shareConsentView()} client={client} onDone={vi.fn()} />);

    await userEvent.click(agree());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      shareConsentEn.step.biometricRequired,
    );
    expect(screen.getByRole('checkbox', { name: SYNTHETIC_BIOMETRIC })).toHaveFocus();
    expect(acceptShareConsent).not.toHaveBeenCalled();
  });

  it('accepts with the digest of each text it displayed and the tick, then reads the session', async () => {
    const { client, acceptShareConsent } = scriptedClient();
    const onDone = vi.fn(() => Promise.resolve());
    renderWithI18n(<ShareConsentStep step={shareConsentView()} client={client} onDone={onDone} />);

    await userEvent.click(screen.getByRole('checkbox', { name: SYNTHETIC_BIOMETRIC }));
    await userEvent.click(agree());

    await waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1);
    });
    expect(acceptShareConsent).toHaveBeenCalledWith('share_back', {
      'text-sha256': digestOf(SYNTHETIC_BODY),
      'biometric-text-sha256': digestOf(SYNTHETIC_BIOMETRIC),
      'explicit-biometric': true,
    });
  });

  it('accepts a share without biometric data with no biometric digest and no tick', async () => {
    const { client, acceptShareConsent } = scriptedClient();
    const onDone = vi.fn(() => Promise.resolve());
    const view = shareConsentView({ categories: ['identity-fields'] });
    delete (view as { biometric?: unknown }).biometric;
    renderWithI18n(<ShareConsentStep step={view} client={client} onDone={onDone} />);

    expect(screen.queryByRole('checkbox')).toBeNull();
    await userEvent.click(agree());

    await waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1);
    });
    expect(acceptShareConsent).toHaveBeenCalledWith('share_back', {
      'text-sha256': digestOf(SYNTHETIC_BODY),
      'explicit-biometric': false,
    });
  });

  it('declines with nothing but the step, then reads the session', async () => {
    const { client, acceptShareConsent, declineShareConsent } = scriptedClient();
    const onDone = vi.fn(() => Promise.resolve());
    renderWithI18n(<ShareConsentStep step={shareConsentView()} client={client} onDone={onDone} />);

    await userEvent.click(decline());

    await waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1);
    });
    expect(declineShareConsent).toHaveBeenCalledWith('share_back');
    expect(acceptShareConsent).not.toHaveBeenCalled();
  });

  it.each([
    [
      'the text',
      shareConsentView({
        text: { ...shareConsentView().text, sha256: digestOf('another text') },
      }),
    ],
    [
      'the biometric text',
      shareConsentView({
        biometric: { body: SYNTHETIC_BIOMETRIC, sha256: digestOf('another text') },
      }),
    ],
  ])(
    'shows the unsupported screen, and reports nothing, when %s is not the one served',
    async (_what, view) => {
      const { client, acceptShareConsent } = scriptedClient();
      const onDone = vi.fn(() => Promise.resolve());
      renderWithI18n(<ShareConsentStep step={view} client={client} onDone={onDone} />);

      await userEvent.click(screen.getByRole('checkbox', { name: SYNTHETIC_BIOMETRIC }));
      await userEvent.click(agree());

      expect(
        await screen.findByRole('heading', { level: 1, name: en.unsupported.title }),
      ).toBeVisible();
      expect(acceptShareConsent).not.toHaveBeenCalled();
      expect(onDone).not.toHaveBeenCalled();
    },
  );

  it('shows the unsupported screen for a category it has no words for, and reports nothing', () => {
    const { client, acceptShareConsent } = scriptedClient();
    renderWithI18n(
      <ShareConsentStep
        step={shareConsentView({ categories: ['identity-fields', 'later-category'] })}
        client={client}
        onDone={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: en.unsupported.title })).toBeVisible();
    expect(screen.queryByRole('button', { name: shareConsentEn.consent.accept })).toBeNull();
    expect(acceptShareConsent).not.toHaveBeenCalled();
  });

  it('announces the wait, and shows a refusal with both choices offered again', async () => {
    const { client, acceptShareConsent } = scriptedClient();
    let refuse: (error: unknown) => void = () => undefined;
    acceptShareConsent.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          refuse = reject;
        }),
    );
    const onDone = vi.fn(() => Promise.resolve());
    renderWithI18n(<ShareConsentStep step={shareConsentView()} client={client} onDone={onDone} />);

    await userEvent.click(screen.getByRole('checkbox', { name: SYNTHETIC_BIOMETRIC }));
    await userEvent.click(agree());

    expect(await screen.findByRole('status')).toHaveTextContent(shareConsentEn.step.saving);
    expect(agree()).toBeDisabled();
    expect(decline()).toBeDisabled();

    refuse(new FlowApiError('network', 'offline'));

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.network);
    expect(agree()).toBeEnabled();
    expect(decline()).toBeEnabled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('marks the text’s own language when it is not the screen’s', () => {
    const { client } = scriptedClient();
    renderWithI18n(
      <ShareConsentStep step={shareConsentView()} client={client} onDone={vi.fn()} />,
      'ar',
    );

    expect(
      screen.getByText(SYNTHETIC_BODY.split('\n\n')[0] ?? '').closest('[lang]'),
    ).toHaveAttribute('lang', 'en');
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: shareConsentAr.consent.title.replace('{{recipient}}', 'Example Partner'),
      }),
    ).toBeVisible();
    expect(screen.getByRole('heading', { level: 1 }).querySelector('bdi')).toHaveTextContent(
      'Example Partner',
    );
  });
});
