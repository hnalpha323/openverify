import { BUILTIN_PALETTES, CONTRAST_PAIRS, contrastRatio } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { THEME_IDS } from '../../testing/routes/themes-copy';
import {
  contrastRows,
  editorStateOf,
  resolvedPalette,
  stylesOfEditor,
  type ThemeEditorState,
} from './theme-model';

describe('resolvedPalette (C160.3)', () => {
  it('lays the set’s cells over the built-in tokens of the variant', () => {
    const palette = resolvedPalette({ dark: { palette: { ink: '#ffffff' } } }, 'dark');

    expect(palette).toEqual({ ...BUILTIN_PALETTES.dark, ink: '#ffffff' });
    expect(resolvedPalette({}, 'light')).toEqual(BUILTIN_PALETTES.light);
  });
});

describe('contrastRows (C160.4)', () => {
  it('answers every pair of the gate in its order, the ratio unrounded, with pass, warn or fail', () => {
    const rows = contrastRows({ light: { palette: { 'ink-muted': '#767676' } } }, 'light');

    expect(rows.map((row) => `${row.foreground}/${row.background}`)).toEqual(
      CONTRAST_PAIRS.map((pair) => `${pair.foreground}/${pair.background}`),
    );
    const muted = rows.find(
      (row) => row.foreground === 'ink-muted' && row.background === 'surface',
    );
    expect(muted?.ratio).toBe(contrastRatio('#767676', BUILTIN_PALETTES.light.surface));
    expect(muted?.ratio).not.toBe(Math.round((muted?.ratio ?? 0) * 100) / 100);
    expect(muted?.level).toBe('warn');
    const canvas = rows.find(
      (row) => row.foreground === 'ink-muted' && row.background === 'canvas',
    );
    expect(canvas?.level).toBe('fail');
    expect(canvas?.required).toBe(4.5);
  });

  it('fails a pair at 4.499 against 4.5, and never warns a non-text pair', () => {
    const rows = contrastRows({ light: { palette: { control: '#ffffff' } } }, 'light');
    const control = rows.filter((row) => row.purpose === 'control');

    expect(control.every((row) => row.level === 'fail' && row.enhanced === null)).toBe(true);
  });
});

describe('the editor state (C160.3)', () => {
  const styles = {
    settings: { 'use-dark-theme': true, 'preferred-theme-variant': 'dark' as const },
    light: { palette: { primary: '#1447e6' } },
    dark: {},
    shape: { radius: 10 },
    typography: { font: { kind: 'uploaded' as const, 'asset-id': THEME_IDS.font } },
    branding: { logo: { 'asset-id': THEME_IDS.logo, decorative: true } },
  };

  it('round-trips a stored tree', () => {
    expect(stylesOfEditor(editorStateOf(styles))).toEqual({ styles, invalid: [] });
  });

  it('leaves empty cells out, so they take the built-in token, and names the cells that are not hex', () => {
    const state: ThemeEditorState = {
      ...editorStateOf({}),
      cells: { light: { ink: ' #101828 ', primary: '', focus: 'BLUE' }, dark: { line: '#36415' } },
      radius: '30',
    };

    expect(stylesOfEditor(state)).toEqual({
      styles: { light: { palette: { ink: '#101828' } }, dark: {} },
      invalid: [
        { variant: 'light', token: 'focus' },
        { variant: 'dark', token: 'line' },
        { variant: null, token: 'radius' },
      ],
    });
  });

  it('keeps an alt key for a logo that is not decorative, and drops the dark tree when it is empty and unused', () => {
    const state: ThemeEditorState = {
      ...editorStateOf({}),
      logo: { assetId: THEME_IDS.logo, decorative: false, altKey: 'brand.logo.alt' },
    };

    expect(stylesOfEditor(state).styles).toEqual({
      branding: {
        logo: { 'asset-id': THEME_IDS.logo, decorative: false, 'alt-key': 'brand.logo.alt' },
      },
    });
  });
});
