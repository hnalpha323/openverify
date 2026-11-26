import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test-utils';
import { ConsentScreen } from './consent-screen';

const TITLE = 'Consent to use your biometric data';
const CHECKBOX = /^I agree to the collection and use of my biometric data/;

describe('ConsentScreen', () => {
  it('asks for biometric consent under the page heading', () => {
    renderWithI18n(<ConsentScreen onContinue={vi.fn()} />);

    expect(screen.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
    expect(screen.getByRole('region', { name: TITLE })).toHaveTextContent(
      /compare a selfie with the photo on your ID document/,
    );
  });

  it('has a required consent checkbox that starts unchecked', () => {
    renderWithI18n(<ConsentScreen onContinue={vi.fn()} />);
    const checkbox = screen.getByRole('checkbox', { name: CHECKBOX });

    expect(checkbox).not.toBeChecked();
    expect(checkbox).toBeRequired();
  });

  it('keeps Continue disabled until consent is given', async () => {
    const onContinue = vi.fn();
    renderWithI18n(<ConsentScreen onContinue={onContinue} />);
    const button = screen.getByRole('button', { name: 'Continue' });

    await userEvent.click(button);

    expect(button).toBeDisabled();
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('continues once the checkbox is checked', async () => {
    const onContinue = vi.fn();
    renderWithI18n(<ConsentScreen onContinue={onContinue} />);

    await userEvent.click(screen.getByRole('checkbox', { name: CHECKBOX }));
    const button = screen.getByRole('button', { name: 'Continue' });
    await userEvent.click(button);

    expect(button).toBeEnabled();
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('does not continue when the form is submitted without consent', () => {
    const onContinue = vi.fn();
    renderWithI18n(<ConsentScreen onContinue={onContinue} />);

    // A disabled default button blocks implicit submission, but a script still can submit.
    fireEvent.submit(screen.getByRole('button', { name: 'Continue' }));

    expect(onContinue).not.toHaveBeenCalled();
  });

  it('disables Continue again when consent is withdrawn', async () => {
    renderWithI18n(<ConsentScreen onContinue={vi.fn()} />);
    const checkbox = screen.getByRole('checkbox', { name: CHECKBOX });

    await userEvent.click(checkbox);
    await userEvent.click(checkbox);

    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('is translated', () => {
    renderWithI18n(<ConsentScreen onContinue={vi.fn()} />, 'es');

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Consentimiento para usar tus datos biométricos',
      }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });
});

describe('ConsentScreen texts and saving', () => {
  it('shows the requested consent texts, in order', () => {
    renderWithI18n(
      <ConsentScreen onContinue={vi.fn()} textKeys={['consent.processing', 'consent.biometric']} />,
    );

    const texts = screen
      .getByRole('region', { name: TITLE })
      .querySelectorAll('[data-consent-text]');
    expect([...texts].map((text) => text.getAttribute('data-consent-text'))).toEqual([
      'consent.processing',
      'consent.biometric',
    ]);
  });

  it('shows the default template’s texts by default', () => {
    renderWithI18n(<ConsentScreen onContinue={vi.fn()} />);

    expect(screen.getByText(/We process the photos of your ID document/)).toBeVisible();
  });

  it('disables Continue and announces the wait while consent is saved', async () => {
    renderWithI18n(<ConsentScreen onContinue={vi.fn()} busy />);

    await userEvent.click(screen.getByRole('checkbox', { name: CHECKBOX }));

    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Saving your consent…');
  });

  it('shows why saving failed', () => {
    renderWithI18n(<ConsentScreen onContinue={vi.fn()} error="Could not save." />);

    expect(screen.getByRole('alert')).toHaveTextContent('Could not save.');
  });

  describe('optional texts (C42.3)', () => {
    const OPTIONAL = [{ key: 'consent.biometric-matching', text: 'Optional: compare me.' }];

    it('shows each optional text as its own unchecked, not required, checkbox', () => {
      renderWithI18n(<ConsentScreen onContinue={vi.fn()} optionalTexts={OPTIONAL} />);
      const optional = screen.getByRole('checkbox', { name: 'Optional: compare me.' });

      expect(optional).not.toBeChecked();
      expect(optional).not.toBeRequired();
      expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    });

    it('hands over the optional keys the user ticked', async () => {
      const onContinue = vi.fn();
      renderWithI18n(<ConsentScreen onContinue={onContinue} optionalTexts={OPTIONAL} />);

      await userEvent.click(screen.getByRole('checkbox', { name: 'Optional: compare me.' }));
      await userEvent.click(screen.getByRole('checkbox', { name: CHECKBOX }));
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

      expect(onContinue).toHaveBeenCalledWith(['consent.biometric-matching']);
    });

    it('hands over no optional key when none was ticked', async () => {
      const onContinue = vi.fn();
      renderWithI18n(<ConsentScreen onContinue={onContinue} optionalTexts={OPTIONAL} />);

      await userEvent.click(screen.getByRole('checkbox', { name: CHECKBOX }));
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

      expect(onContinue).toHaveBeenCalledWith([]);
    });
  });
});
