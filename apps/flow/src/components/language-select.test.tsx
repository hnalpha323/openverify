import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '../test-utils';
import { LanguageSelect } from './language-select';

describe('LanguageSelect', () => {
  it('names each language in itself and switches to the one chosen', async () => {
    const { i18n } = renderWithI18n(<LanguageSelect />);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'Español');

    expect(i18n.language).toBe('es');
    expect(screen.getByRole('option', { name: 'English' })).toHaveAttribute('lang', 'en');
  });

  it('is outlined like every other form control, at 3:1 or more (Workflow 2D F010, WCAG 1.4.11)', () => {
    renderWithI18n(<LanguageSelect />);

    const select = screen.getByRole('combobox', { name: 'Language' });
    expect(select).toHaveClass('border-control');
    // `line` is for decorative separators only (about 1.5:1).
    expect(select).not.toHaveClass('border-line');
  });
});
