import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '../i18n/locales/en';
import { renderWithI18n } from '../test-utils';
import { RetryHints } from './retry-hints';

describe('RetryHints', () => {
  it('renders nothing when there is nothing to fix', () => {
    const { container } = renderWithI18n(<RetryHints hints={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('announces what to fix, one message per reason', () => {
    renderWithI18n(
      <RetryHints
        hints={[
          { name: 'id_blur_detection', reasons: ['image_blurry'] },
          { name: 'id_glare_detection', reasons: ['glare_present'] },
        ]}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(en.retry.title);
    expect(
      within(alert)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([en.retry.reasons.image_blurry, en.retry.reasons.glare_present]);
  });

  it('says each thing once, even when several checks report it', () => {
    renderWithI18n(
      <RetryHints
        hints={[
          { name: 'id_blur_detection', reasons: ['image_blurry'] },
          { name: 'selfie_image_quality_detection', reasons: ['image_blurry', 'image_too_dark'] },
        ]}
      />,
    );

    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      en.retry.reasons.image_blurry,
      en.retry.reasons.image_too_dark,
    ]);
  });

  it('falls back to a generic message for reasons it does not know, or none', () => {
    renderWithI18n(
      <RetryHints
        hints={[
          { name: 'id_blur_detection', reasons: ['some_future_reason'] },
          { name: 'id_glare_detection', reasons: [] },
        ]}
      />,
    );

    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      en.retry.generic,
    ]);
  });

  it('is translated', () => {
    renderWithI18n(
      <RetryHints hints={[{ name: 'id_glare_detection', reasons: ['glare_present'] }]} />,
      'es',
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Había reflejos en tu documento');
  });
});
