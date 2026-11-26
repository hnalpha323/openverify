import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { THEME_IDS } from '../../testing/routes/themes-copy';
import { BuilderCopyPanel } from './builder-copy-panel';

describe('BuilderCopyPanel (C155.8, C161.5, C162)', () => {
  it('shows each enabled locale with its review status and its count of reworded texts', () => {
    render(
      <BuilderCopyPanel
        templateId={THEME_IDS.template}
        enabledLocales={['en', 'ar']}
        defaultLocale="en"
        copy={{ messages: { en: { 'consent.title': 'Synthetic title', 'screen.help': 'Help' } } }}
        reviewStatus={{ en: { status: 'source' }, ar: { status: 'machine-drafted' } }}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Languages and copy' })).toBeVisible();
    expect(screen.getByText(/Machine-drafted/)).toBeVisible();
    expect(screen.getByText('2 texts reworded')).toBeVisible();
    expect(screen.getByText('0 texts reworded')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open translations' })).toHaveAttribute(
      'href',
      `/templates/${THEME_IDS.template}/translations`,
    );
  });
});
