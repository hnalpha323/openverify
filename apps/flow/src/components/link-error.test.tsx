import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '../i18n/locales/en';
import { renderWithI18n } from '../test-utils';
import { LinkError } from './link-error';

describe('LinkError', () => {
  it.each(['missing', 'invalid', 'mismatch', 'used', 'reloaded'] as const)(
    'explains a %s link',
    (reason) => {
      renderWithI18n(<LinkError reason={reason} />);

      expect(
        screen.getByRole('heading', { level: 1, name: 'We could not open your verification' }),
      ).toBeVisible();
      expect(screen.getByRole('alert')).toHaveTextContent(en.link[reason]);
    },
  );

  it('offers no way to retry a used one-time link (C19)', () => {
    renderWithI18n(<LinkError reason="used" />);

    expect(screen.getByRole('alert')).toHaveTextContent('already been used');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('is translated', () => {
    renderWithI18n(<LinkError reason="missing" />, 'es');

    expect(
      screen.getByRole('heading', { level: 1, name: 'No pudimos abrir tu verificación' }),
    ).toBeVisible();
  });
});
