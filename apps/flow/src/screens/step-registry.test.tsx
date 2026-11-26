import type { ClientStepView } from '@openverify/flow-spec';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test-utils';
import {
  PREVIEW_PLACEHOLDER_TYPES,
  PREVIEWABLE_TYPES,
  StaticStep,
  isPreviewable,
  type PreviewableStep,
} from './step-registry';

const copy = (key: string) =>
  ({ 'about.title.body': 'About you', 'about.go.button': 'Next' })[key] ?? null;

const SCREEN: PreviewableStep = {
  id: 'about',
  type: 'screen',
  components: [
    { id: 'title', kind: 'text', variant: 'title', copyKey: 'about.title.body' },
    { id: 'go', kind: 'button', labelKey: 'about.go.button', action: 'submit' },
  ],
};

describe('the step registry (C151.5, C156.3)', () => {
  it('splits every client step type between the live components and the preview placeholders', () => {
    const all: ClientStepView['type'][] = [...PREVIEWABLE_TYPES, ...PREVIEW_PLACEHOLDER_TYPES];

    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual(
      [
        'aamva',
        'business_website',
        'completion',
        'consent',
        'crypto_wallet',
        'database',
        'database_business',
        'device_handoff',
        'document',
        'email_otp',
        'failure',
        'government_id',
        'nfc',
        'phone_otp',
        'screen',
        'selfie',
        // C238.6 (Workflow 11A): accept and decline need the flow API, so the preview draws a placeholder.
        'share_consent',
      ].sort(),
    );
  });

  it('knows which steps render without a client', () => {
    expect(isPreviewable(SCREEN)).toBe(true);
    expect(isPreviewable({ id: 'face', type: 'selfie' } as ClientStepView)).toBe(false);
  });

  it('renders a screen with the live components and sends what its submit gives', async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    renderWithI18n(<StaticStep step={SCREEN} copy={copy} onSubmit={onSubmit} />);

    expect(screen.getByRole('heading', { level: 1, name: 'About you' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onSubmit).toHaveBeenCalledWith({ values: {} });
  });

  it('renders a consent step with its texts as shown', () => {
    renderWithI18n(
      <StaticStep
        step={{ id: 'consent', type: 'consent', textKeys: ['consent.processing'], required: true }}
        copy={copy}
      />,
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Consent to use your biometric data',
    );
    expect(screen.getByText(/We process the photos of your ID document/u)).toBeInTheDocument();
  });

  it.each([
    ['completion', 'Verification submitted'],
    ['failure', 'Verification not completed'],
  ] as const)('renders a %s step', (type, title) => {
    renderWithI18n(<StaticStep step={{ id: type, type }} copy={copy} />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(title);
  });
});
