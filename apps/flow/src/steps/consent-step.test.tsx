import { createHash } from 'node:crypto';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FlowApiError } from '../api/flow-api-client';
import type { ConsentStep as ConsentStepDefinition } from '../flow/flow-position';
import { en } from '../i18n/locales/en';
import { es } from '../i18n/locales/es';
import { FLOW_CATALOG_VERSION } from '../i18n/catalog-version';
import { applySessionCopy } from '../session/session-copy';
import { FakeFlowApi } from '../testing/fake-flow-api';
import { renderWithFlow } from '../test-utils';
import { ConsentStep } from './consent-step';

const STEP: ConsentStepDefinition = {
  id: 'consent',
  type: 'consent',
  textKeys: ['consent.biometric', 'consent.processing'],
  required: true,
};

const CHECKBOX = /^I agree/;

/** C162.9: the digest the server computes over a text as shown, NFC-normalised. */
const sha256 = (text: string) => createHash('sha256').update(text.normalize('NFC')).digest('hex');

/** The default template's consent step (C45.1): the optional matching consent too (C42.3). */
const MATCHING_STEP: ConsentStepDefinition = {
  ...STEP,
  optionalTextKeys: ['consent.biometric-matching'],
};

const MATCHING = /^Optional: we also compare your selfie/;

function renderStep(
  step: ConsentStepDefinition = STEP,
  language: 'en' | 'es' = 'en',
  api = new FakeFlowApi(),
  retentionDays: number | null = 365,
) {
  const onAccepted = vi.fn(() => Promise.resolve());
  renderWithFlow(
    <ConsentStep
      step={step}
      client={api.client}
      onAccepted={onAccepted}
      retentionDays={retentionDays}
    />,
    { language },
  );
  return { api, onAccepted };
}

async function accept(name: RegExp = CHECKBOX, button = 'Continue') {
  await userEvent.click(screen.getByRole('checkbox', { name }));
  await userEvent.click(screen.getByRole('button', { name: button }));
}

describe('ConsentStep', () => {
  it('shows exactly the texts the step asks the user to agree to', () => {
    renderStep();

    expect(screen.getByText(en.consent.biometric)).toBeVisible();
    expect(screen.getByText(en.consent.processing)).toBeVisible();
  });

  it('records consent with the keys of the texts shown and the language used', async () => {
    const { api, onAccepted } = renderStep();

    await userEvent.click(screen.getByRole('checkbox', { name: CHECKBOX }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(onAccepted).toHaveBeenCalledTimes(1);
    });
    expect(api.client.acceptConsent).toHaveBeenCalledWith({
      accepted: true,
      'text-keys': ['consent.biometric', 'consent.processing'],
      locale: 'en',
      // C162.9 (Workflow 9A): the evidence of the words shown.
      'text-sha256': [sha256(en.consent.biometric), sha256(en.consent.processing)],
      'copy-source': 'built-in',
      'catalog-version': FLOW_CATALOG_VERSION,
    });
  });

  it('records the Spanish locale for a Spanish-speaking user', async () => {
    const { api } = renderStep(STEP, 'es');

    await userEvent.click(screen.getByRole('checkbox', { name: /^Acepto/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    await waitFor(() => {
      expect(api.client.acceptConsent).toHaveBeenCalledWith(
        expect.objectContaining({ locale: 'es' }),
      );
    });
  });

  it('stays busy until the session has moved on', async () => {
    const api = new FakeFlowApi();
    const onAccepted = vi.fn(() => new Promise<void>(() => undefined));
    renderWithFlow(<ConsentStep step={STEP} client={api.client} onAccepted={onAccepted} />);

    await userEvent.click(screen.getByRole('checkbox', { name: CHECKBOX }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Saving your consent…');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('explains a failure and lets the user try again', async () => {
    const api = new FakeFlowApi();
    api.client.acceptConsent.mockRejectedValueOnce(new FlowApiError('network', 'no response'));
    const { onAccepted } = renderStep(STEP, 'en', api);

    await userEvent.click(screen.getByRole('checkbox', { name: CHECKBOX }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.network);
    expect(onAccepted).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(onAccepted).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('refuses to collect consent to a text it cannot show', async () => {
    const { api } = renderStep({ ...STEP, textKeys: ['consent.biometric', 'consent.marketing'] });

    expect(screen.getByRole('alert')).toHaveTextContent(en.consent.unavailable);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    await Promise.resolve();
    expect(api.client.acceptConsent).not.toHaveBeenCalled();
  });
});

describe('ConsentStep: the optional matching consent (C42.3)', () => {
  it('shows the matching text with its own checkbox, unchecked, naming the retention days', () => {
    renderStep(MATCHING_STEP, 'en', new FakeFlowApi(), 365);

    const matching = screen.getByRole('checkbox', { name: MATCHING });
    expect(matching).not.toBeChecked();
    expect(matching).not.toBeRequired();
    expect(matching).toHaveAccessibleName(
      en.consent['biometric-matching'].replace('{{days}}', '365'),
    );
    expect(screen.queryByText(/\{\{days\}\}/)).not.toBeInTheDocument();
  });

  it('lets the user verify without it: the optional key is not recorded', async () => {
    const { api, onAccepted } = renderStep(MATCHING_STEP);

    await accept();

    await waitFor(() => {
      expect(onAccepted).toHaveBeenCalledTimes(1);
    });
    expect(api.client.acceptConsent).toHaveBeenCalledWith({
      accepted: true,
      'text-keys': ['consent.biometric', 'consent.processing'],
      'optional-text-keys': [],
      locale: 'en',
      'text-sha256': [sha256(en.consent.biometric), sha256(en.consent.processing)],
      'copy-source': 'built-in',
      'catalog-version': FLOW_CATALOG_VERSION,
    });
  });

  it('records the optional key once its box is ticked, and text-keys stay the step’s own', async () => {
    const { api } = renderStep(MATCHING_STEP);

    await userEvent.click(screen.getByRole('checkbox', { name: MATCHING }));
    await accept();

    await waitFor(() => {
      expect(api.client.acceptConsent).toHaveBeenCalledWith(
        expect.objectContaining({
          'text-keys': ['consent.biometric', 'consent.processing'],
          'optional-text-keys': ['consent.biometric-matching'],
        }),
      );
    });
  });

  it('never lets the optional box stand in for the required one', async () => {
    renderStep(MATCHING_STEP);

    await userEvent.click(screen.getByRole('checkbox', { name: MATCHING }));

    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('offers no matching consent when the server does not say how long templates are kept', async () => {
    const { api } = renderStep(MATCHING_STEP, 'en', new FakeFlowApi(), null);

    expect(screen.queryByRole('checkbox', { name: MATCHING })).not.toBeInTheDocument();
    await accept();

    await waitFor(() => {
      expect(api.client.acceptConsent).toHaveBeenCalledWith(
        expect.objectContaining({ 'optional-text-keys': [] }),
      );
    });
  });

  it('skips an optional text this version cannot show, and still asks for the required ones', () => {
    renderStep({ ...STEP, optionalTextKeys: ['consent.marketing'] });

    expect(screen.getByRole('checkbox', { name: CHECKBOX })).toBeVisible();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  });

  it('says it in Spanish, with the days filled in', () => {
    renderStep(MATCHING_STEP, 'es', new FakeFlowApi(), 30);

    expect(screen.getByRole('checkbox', { name: /^Opcional:/ })).toHaveAccessibleName(
      es.consent['biometric-matching'].replace('{{days}}', '30'),
    );
  });

  it('sends no optional keys for a step that has none', async () => {
    const { api } = renderStep(STEP);

    await accept();

    await waitFor(() => {
      expect(api.client.acceptConsent).toHaveBeenCalledTimes(1);
    });
    expect(api.client.acceptConsent.mock.calls[0]?.[0]).not.toHaveProperty('optional-text-keys');
  });
});

// C162.9 (reviews P04, H10, V01; Workflow 9A): the record names the exact words shown without storing
// them: the SHA-256 of each text as rendered (placeholders filled), where its copy came from, and the
// catalog version, so the server can match them against its own candidates.
describe('the consent evidence (C162.9)', () => {
  it('digests each text as shown, the ticked optional ones after the required ones', async () => {
    const { api } = renderStep(MATCHING_STEP);

    await userEvent.click(screen.getByRole('checkbox', { name: MATCHING }));
    await accept();

    await waitFor(() => {
      expect(api.client.acceptConsent).toHaveBeenCalledWith(
        expect.objectContaining({
          'text-sha256': [
            sha256(en.consent.biometric),
            sha256(en.consent.processing),
            sha256(en.consent['biometric-matching'].replace('{{days}}', '365')),
          ],
          'copy-source': 'built-in',
          'catalog-version': FLOW_CATALOG_VERSION,
        }),
      );
    });
  });

  it('digests the Spanish words for a Spanish-speaking user', async () => {
    const { api } = renderStep(STEP, 'es');

    await accept(/^Acepto/, 'Continuar');

    await waitFor(() => {
      expect(api.client.acceptConsent).toHaveBeenCalledWith(
        expect.objectContaining({
          'text-sha256': [sha256(es.consent.biometric), sha256(es.consent.processing)],
        }),
      );
    });
  });

  it('leaves the copy source out when only some of the words were the operator copy', async () => {
    const api = new FakeFlowApi();
    const custom = 'We compare your selfie with your ID photo for this request only.';
    const copy = { messages: { en: { 'consent.biometric': custom } } };
    const onAccepted = vi.fn(() => Promise.resolve());
    const { i18n } = renderWithFlow(
      <ConsentStep step={STEP} client={api.client} onAccepted={onAccepted} copy={copy} />,
    );
    // The renderer lays the session copy over the catalog before the step renders.
    act(() => {
      applySessionCopy(i18n, copy);
    });

    await accept();

    await waitFor(() => {
      expect(api.client.acceptConsent).toHaveBeenCalledWith(
        expect.objectContaining({
          'text-sha256': [sha256(custom), sha256(en.consent.processing)],
        }),
      );
    });
    // Workflow 10A integration-10a (android-sdk-api's finding): the server matches a `custom` body
    // against the operator's copy only and a `built-in` one against the released texts only, so a
    // consent whose texts are mixed says neither (C162.9; the server's check accepts either then).
    expect(vi.mocked(api.client.acceptConsent).mock.calls[0]?.[0]).not.toHaveProperty(
      'copy-source',
    );
  });

  it('says the words were the operator copy when the session replaced every one', async () => {
    const api = new FakeFlowApi();
    const biometric = 'We compare your selfie with your ID photo for this request only.';
    const processing = 'We process what you send us to verify you, and nothing else.';
    const copy = {
      messages: { en: { 'consent.biometric': biometric, 'consent.processing': processing } },
    };
    const onAccepted = vi.fn(() => Promise.resolve());
    const { i18n } = renderWithFlow(
      <ConsentStep step={STEP} client={api.client} onAccepted={onAccepted} copy={copy} />,
    );
    act(() => {
      applySessionCopy(i18n, copy);
    });

    await accept();

    await waitFor(() => {
      expect(api.client.acceptConsent).toHaveBeenCalledWith(
        expect.objectContaining({
          'text-sha256': [sha256(biometric), sha256(processing)],
          'copy-source': 'custom',
        }),
      );
    });
  });
});
