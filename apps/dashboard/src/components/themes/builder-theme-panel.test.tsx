import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { THEME_IDS } from '../../testing/routes/themes-copy';
import { BuilderThemePanel } from './builder-theme-panel';

const SETS = [
  { id: THEME_IDS.set, name: 'Synthetic Brand', revision: 3, isDefault: true },
  { id: THEME_IDS.otherSet, name: 'Synthetic Night', revision: 1, isDefault: false },
];

describe('BuilderThemePanel (C155.8, C160.7)', () => {
  it('offers the environment default and every active set, and reports the choice', () => {
    const onChange = vi.fn();
    render(<BuilderThemePanel themeSets={SETS} value={null} onChange={onChange} />);

    const select = screen.getByRole('combobox', { name: 'Theme set' });
    expect(select).toHaveValue('');
    expect(
      screen.getByRole('option', {
        name: 'The environment’s default set (today: Synthetic Brand)',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'Synthetic Night (revision 1)' }),
    ).toBeInTheDocument();

    fireEvent.change(select, { target: { value: THEME_IDS.otherSet } });
    expect(onChange).toHaveBeenLastCalledWith(THEME_IDS.otherSet);
    fireEvent.change(select, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('link', { name: 'Manage theme sets' })).toHaveAttribute(
      'href',
      '/theme-sets',
    );
  });

  it('keeps a chosen set that is no longer active visible, and is read-only without onChange', () => {
    render(<BuilderThemePanel themeSets={[]} value={THEME_IDS.archivedSet} />);

    const select = screen.getByRole('combobox', { name: 'Theme set' });
    expect(select).toBeDisabled();
    expect(select).toHaveValue(THEME_IDS.archivedSet);
    expect(
      screen.getByRole('option', { name: /archived: flows fall back to the default/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('This environment has no active theme set yet.')).toBeVisible();
  });
});
