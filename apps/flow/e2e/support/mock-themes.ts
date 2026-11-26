/**
 * C160.9 (`api-themes`, Workflow 9B; review F11): the mocked suite's theme answers. A test gives a
 * mock the theme its sessions carry with `serveTheme(mock, theme)`; the session hook adds it through
 * 9A's registration (`registerMockFlowExtension`), and a mock with none answers as before. The
 * palettes are the built-in ones of `@openverify/core` and synthetic variations of them.
 */
import { BUILTIN_PALETTES } from '@openverify/core';
import type { FlowTheme } from '@openverify/contracts';
import { registerMockFlowExtension, type MockFlowApi } from './mock-flow-api';

const themes = new WeakMap<MockFlowApi, FlowTheme>();

/** Every session `mock` answers carries `theme` from now on. */
export function serveTheme(mock: MockFlowApi, theme: FlowTheme): void {
  themes.set(mock, theme);
}

/** A theme set's theme: the built-in palettes with `primary` changed, light only by default. */
export function syntheticTheme(changes: Partial<FlowTheme> = {}): FlowTheme {
  return {
    'theme-set-id': 'theset_01M5CK16P0D13FXHZSS4TCFBVH',
    revision: 2,
    mode: 'light',
    light: { ...BUILTIN_PALETTES.light, primary: '#2563eb', 'primary-hover': '#1d4ed8' },
    dark: null,
    radius: 12,
    font: { kind: 'system', platforms: ['web', 'android'] },
    logo: null,
    placement: 'header',
    ...changes,
  };
}

/** The built-in dark palette with a synthetic primary, for a theme that uses dark. */
export const SYNTHETIC_DARK = { ...BUILTIN_PALETTES.dark, primary: '#4891ff' };

registerMockFlowExtension('themes', {
  session: (session, mock) => {
    const theme = themes.get(mock);
    return theme === undefined ? session : { ...session, theme };
  },
});
