import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult } from '../../lib/action-state';
import { THEME_IDS } from '../../testing/routes/themes-copy';
import { ThemeEditor, type ThemeSaveResult } from './theme-editor';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const field = (name: string) => screen.getAllByRole('textbox', { name })[0] as HTMLInputElement;
const lightTable = () =>
  screen.getByRole('table', { name: 'Light palette: every pair the gate checks' });
const rowOf = (table: HTMLElement, foreground: string, background: string) => {
  const row = within(table)
    .getAllByRole('row')
    .find(
      (each) =>
        within(each).queryByRole('rowheader')?.textContent === foreground &&
        each.textContent.includes(background),
    );
  if (row === undefined) {
    throw new Error(`no row ${foreground} on ${background}`);
  }
  return row;
};

describe('ThemeEditor (C160.3, C160.4)', () => {
  it('checks contrast live as a colour is typed, unrounded, and draws the swatches as SVG attributes', () => {
    render(<ThemeEditor themeSetId={THEME_IDS.set} styles={{}} organizationName={null} />);

    expect(rowOf(lightTable(), 'ink', 'surface')).toHaveAttribute('data-level', 'pass');
    fireEvent.change(field('Ink (text)'), { target: { value: '#ffffff' } });

    const row = rowOf(lightTable(), 'ink', 'surface');
    expect(row).toHaveAttribute('data-level', 'fail');
    expect(row).toHaveTextContent('1:1');
    expect(row).toHaveTextContent('Fails: a save is refused');
    const swatches = screen.getByRole('img', { name: 'Swatches: Light palette' });
    expect(swatches.querySelector('[style]')).toBeNull();
    expect(swatches.querySelector('rect[fill="#ffffff"]')).not.toBeNull();
  });

  it('refuses to send a colour that is not hex, naming its cell', () => {
    const save = vi.fn();
    render(
      <ThemeEditor
        themeSetId={THEME_IDS.set}
        styles={{}}
        organizationName={null}
        saveAction={save}
      />,
    );

    fireEvent.change(field('Primary (buttons and links)'), { target: { value: 'blue' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save styles' }));

    expect(save).not.toHaveBeenCalled();
    expect(field('Primary (buttons and links)')).toHaveAttribute('aria-invalid', 'true');
  });

  it('sends the sparse tree and reports the pairs the API refused', async () => {
    const pairs = [
      {
        pointer: '/data/attributes/styles/light/palette/ink',
        foreground: 'ink',
        background: 'surface',
        ratio: 1.0000001,
        required: 4.5,
      },
    ];
    const save = vi
      .fn<() => Promise<ActionResult<ThemeSaveResult>>>()
      .mockResolvedValue({ ok: true, data: { kind: 'refused', pairs } });
    render(
      <ThemeEditor
        themeSetId={THEME_IDS.set}
        styles={{}}
        organizationName={null}
        saveAction={save}
      />,
    );

    fireEvent.change(field('Ink (text)'), { target: { value: '#ffffff' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save styles' }));

    await waitFor(() => {
      expect(screen.getByText(/ink on surface: 1.0000001:1, needs 4.5:1/)).toBeVisible();
    });
    const sent = save.mock.calls[0] as unknown as [unknown, FormData];
    expect(JSON.parse(sent[1].get('styles') as string)).toEqual({
      light: { palette: { ink: '#ffffff' } },
    });
    expect(sent[1].get('theme-set-id')).toBe(THEME_IDS.set);
  });

  it('reports the revision a save made', async () => {
    const save = vi
      .fn<() => Promise<ActionResult<ThemeSaveResult>>>()
      .mockResolvedValue({ ok: true, data: { kind: 'saved', revision: 4 } });
    render(
      <ThemeEditor
        themeSetId={THEME_IDS.set}
        styles={{}}
        organizationName={null}
        saveAction={save}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save styles' }));

    await waitFor(() => {
      expect(screen.getByText('Saved as revision 4.')).toBeVisible();
    });
  });

  it('shows a decorative logo with the organisation name, and asks a text alternative key otherwise', () => {
    render(
      <ThemeEditor
        themeSetId={THEME_IDS.set}
        styles={{ branding: { logo: { 'asset-id': THEME_IDS.logo, decorative: true } } }}
        organizationName="Synthetic Org"
        saveAction={vi.fn()}
      />,
    );

    expect(screen.getByRole('img', { name: 'The uploaded logo' })).toHaveAttribute(
      'src',
      `/theme-sets/assets/${THEME_IDS.logo}/content`,
    );
    expect(screen.getByText(/Synthetic Org/)).toBeVisible();
    fireEvent.click(screen.getByRole('checkbox', { name: 'The logo is decorative' }));
    expect(
      screen.getByRole('textbox', { name: /Copy key of the logo’s text alternative/ }),
    ).toBeVisible();
  });
});
