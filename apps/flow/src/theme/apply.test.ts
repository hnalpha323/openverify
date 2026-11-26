/**
 * C160.9 (`api-themes`, Workflow 9B; V15; Workflow 9C's WebKit fix): the session's theme on the
 * page. Each token goes through `setProperty` on one rule of the page's own same-origin stylesheet,
 * never the root's inline style (no inline style anywhere) and never `cssText`; `color-scheme`
 * follows the variant;
 * `auto` follows `prefers-color-scheme` and its changes; the page's `style-variant` forces a variant
 * the theme has; with no theme, `style-variant=dark` shows the built-in dark palette through the
 * stylesheet's flow-only attribute. An uploaded font is loaded through `FontFace` from bytes, after
 * the bytes are sniffed, with the system stack as fallback and its `unicode-range` when given.
 */
import type { FlowSessionResponse, FlowTheme } from '@openverify/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applySessionTheme,
  currentThemeBranding,
  subscribeThemeBranding,
  SYSTEM_FONT_STACK,
  THEME_FONT_FAMILY,
  THEME_RULE_SELECTOR,
  type ApplyThemeOptions,
} from './apply';

const LIGHT = {
  primary: '#1f4fd1',
  'primary-hover': '#1a43b3',
  'on-primary': '#ffffff',
  danger: '#b42318',
  'danger-hover': '#9a1e14',
  surface: '#ffffff',
  canvas: '#f6f7f9',
  ink: '#14171f',
  'ink-muted': '#4b5262',
  line: '#d5d9e0',
  control: '#6b7280',
  focus: '#000000',
} as const;
const DARK = { ...LIGHT, surface: '#101828', canvas: '#030712', ink: '#f9fafb' } as const;

const THEME: FlowTheme = {
  'theme-set-id': 'theset_01M5CK16P0D13FXHZSS4TCFBVH',
  revision: 3,
  mode: 'light',
  light: { ...LIGHT },
  dark: { ...DARK },
  radius: 10,
  font: { kind: 'system', platforms: ['web', 'android'] },
  logo: null,
  placement: 'header',
};

const session = (theme?: FlowTheme): FlowSessionResponse =>
  ({
    inquiry: { id: 'inq_01M5CK16P0D13FXHZSS4TCFBVH', status: 'pending' },
    ...(theme === undefined ? {} : { theme }),
  }) as unknown as FlowSessionResponse;

/** A `matchMedia` whose `prefers-color-scheme: dark` answer the test sets and changes. */
function colourScheme(dark: boolean) {
  const listeners = new Set<() => void>();
  let matches = dark;
  const matchMedia = (query: string) =>
    ({
      get matches() {
        return query === '(prefers-color-scheme: dark)' ? matches : !matches;
      },
      media: query,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    }) as unknown as MediaQueryList;
  return {
    matchMedia,
    listeners,
    set(next: boolean) {
      matches = next;
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}

let root: HTMLElement;
let sheet: CSSStyleSheet;
let sheetOwner: HTMLStyleElement;
/** The theme's rule in the stylesheet, if one was written. */
const themeRule = () =>
  [...sheet.cssRules].find(
    (rule): rule is CSSStyleRule =>
      'selectorText' in rule && rule.selectorText === THEME_RULE_SELECTOR,
  );
const value = (name: string) => themeRule()?.style.getPropertyValue(name) ?? '';

beforeEach(() => {
  sheetOwner = document.createElement('style');
  document.head.append(sheetOwner);
  const owned = sheetOwner.sheet;
  if (owned === null) {
    throw new Error('jsdom gave the style element no sheet');
  }
  sheet = owned;
  root = document.createElement('html');
  Object.defineProperty(root.style, 'cssText', {
    set() {
      throw new Error('cssText is never written (C160.9)');
    },
    get() {
      return '';
    },
  });
});

afterEach(() => {
  applySessionTheme(session(), null, { root, sheet, matchMedia: colourScheme(false).matchMedia });
  expect(root.getAttribute('style')).toBeNull();
  sheetOwner.remove();
});

describe('the tokens (C160.9)', () => {
  it('sets each light token and the radius scale on the stylesheet rule, never the root inline style', () => {
    const setProperty = vi.spyOn(root.style, 'setProperty');
    applySessionTheme(session(THEME), null, {
      root,
      sheet,
      matchMedia: colourScheme(false).matchMedia,
    });

    for (const [token, colour] of Object.entries(LIGHT)) {
      expect(value(`--color-${token}`)).toBe(colour);
    }
    expect(setProperty).not.toHaveBeenCalled();
    expect(root.getAttribute('style')).toBeNull();
    expect(sheet.cssRules[sheet.cssRules.length - 1]).toBe(themeRule());
    expect([
      value('--radius-sm'),
      value('--radius-md'),
      value('--radius-lg'),
      value('--radius-xl'),
    ]).toEqual(['8px', '10px', '12px', '16px']);
    expect(value('color-scheme')).toBe('light');
    expect(root.hasAttribute('data-openverify-variant')).toBe(false);
  });

  it('keeps a light theme light when the device prefers dark', () => {
    applySessionTheme(session(THEME), null, {
      root,
      sheet,
      matchMedia: colourScheme(true).matchMedia,
    });
    expect(value('--color-surface')).toBe(LIGHT.surface);
  });

  it('follows prefers-color-scheme under auto, and its changes', () => {
    const scheme = colourScheme(true);
    applySessionTheme(session({ ...THEME, mode: 'auto' }), null, {
      root,
      sheet,
      matchMedia: scheme.matchMedia,
    });
    expect([value('--color-surface'), value('color-scheme')]).toEqual([DARK.surface, 'dark']);

    scheme.set(false);
    expect([value('--color-surface'), value('color-scheme')]).toEqual([LIGHT.surface, 'light']);
  });

  it('lets style-variant force a variant the theme has, and ignores dark for a theme without', () => {
    applySessionTheme(session({ ...THEME, mode: 'auto' }), 'light', {
      root,
      sheet,
      matchMedia: colourScheme(true).matchMedia,
    });
    expect(value('--color-surface')).toBe(LIGHT.surface);

    applySessionTheme(session(THEME), 'dark', {
      root,
      sheet,
      matchMedia: colourScheme(false).matchMedia,
    });
    expect(value('--color-surface')).toBe(DARK.surface);

    applySessionTheme(session({ ...THEME, dark: null }), 'dark', {
      root,
      sheet,
      matchMedia: colourScheme(false).matchMedia,
    });
    expect([value('--color-surface'), value('color-scheme')]).toEqual([LIGHT.surface, 'light']);
  });

  it('stops following the device once a later session is not auto', () => {
    const scheme = colourScheme(true);
    applySessionTheme(session({ ...THEME, mode: 'auto' }), null, {
      root,
      sheet,
      matchMedia: scheme.matchMedia,
    });
    applySessionTheme(session(THEME), null, { root, sheet, matchMedia: scheme.matchMedia });
    expect(scheme.listeners.size).toBe(0);
  });

  it('sets nothing for a value that is not a hex colour or a radius out of range', () => {
    applySessionTheme(
      session({
        ...THEME,
        light: { ...LIGHT, ink: 'url(https://example.com/x)' },
        radius: 99,
      }),
      null,
      { root, sheet, matchMedia: colourScheme(false).matchMedia },
    );
    expect(value('--color-ink')).toBe('');
    expect(value('--radius-md')).toBe('');
    expect(value('--color-primary')).toBe(LIGHT.primary);
  });
});

describe('the stylesheet the theme is written to (Workflow 9C, WebKit CSP fix)', () => {
  it('writes one rule, reused by later sessions, that outranks the built-in dark attribute', () => {
    applySessionTheme(session(THEME), null, {
      root,
      sheet,
      matchMedia: colourScheme(false).matchMedia,
    });
    applySessionTheme(session({ ...THEME, radius: 4 }), null, {
      root,
      sheet,
      matchMedia: colourScheme(false).matchMedia,
    });
    const rules = [...sheet.cssRules].filter(
      (rule) => 'selectorText' in rule && rule.selectorText === THEME_RULE_SELECTOR,
    );
    expect(rules).toHaveLength(1);
    expect(value('--radius-md')).toBe('4px');
  });

  it('writes the rule again when something removed it from the sheet', () => {
    applySessionTheme(session(THEME), null, {
      root,
      sheet,
      matchMedia: colourScheme(false).matchMedia,
    });
    sheet.deleteRule(sheet.cssRules.length - 1);
    applySessionTheme(session(THEME), null, {
      root,
      sheet,
      matchMedia: colourScheme(false).matchMedia,
    });
    expect(value('--color-primary')).toBe(LIGHT.primary);
  });
});

describe('the built-in tokens, with no theme (C160.4, C160.9)', () => {
  it('shows the built-in dark palette for style-variant=dark through the flow-only attribute', () => {
    applySessionTheme(session(), 'dark', {
      root,
      sheet,
      matchMedia: colourScheme(false).matchMedia,
    });
    expect(root.getAttribute('data-openverify-variant')).toBe('dark');
    expect(value('color-scheme')).toBe('dark');
  });

  it('clears what an earlier theme set, keeping the stylesheet’s light tokens', () => {
    applySessionTheme(session(THEME), 'dark', {
      root,
      sheet,
      matchMedia: colourScheme(false).matchMedia,
    });
    applySessionTheme(session(), null, { root, sheet, matchMedia: colourScheme(false).matchMedia });

    expect(value('--color-primary')).toBe('');
    expect(value('--radius-md')).toBe('');
    expect(value('color-scheme')).toBe('light');
    expect(root.hasAttribute('data-openverify-variant')).toBe(false);
  });
});

describe('an uploaded font (C160.6, C160.9; review P18)', () => {
  const WOFF2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 1, 0, 0, 0, 0, 0, 16, 0, 1, 0, 0])
    .buffer;
  const FONT_THEME: FlowTheme = {
    ...THEME,
    font: { kind: 'uploaded', 'asset-id': 'tsa_01M5CK16P0D13FXHZSS4TCFBVH', platforms: ['web'] },
  };

  async function applied(bytes: ArrayBuffer, extra: Partial<ApplyThemeOptions> = {}) {
    const loadAsset = vi.fn(() => Promise.resolve({ bytes, mediaType: 'font/woff2' }));
    const loadFont = vi.fn(() => Promise.resolve());
    applySessionTheme(session(FONT_THEME), null, {
      root,
      sheet,
      matchMedia: colourScheme(false).matchMedia,
      loadAsset,
      loadFont,
      ...extra,
    });
    await vi.waitFor(() => {
      expect(loadAsset).toHaveBeenCalledWith('tsa_01M5CK16P0D13FXHZSS4TCFBVH');
    });
    await Promise.resolve();
    return { loadAsset, loadFont };
  }

  it('is loaded through FontFace from its bytes, before the system stack', async () => {
    const { loadFont } = await applied(WOFF2);
    await vi.waitFor(() => {
      expect(value('--font-sans')).toBe(`"${THEME_FONT_FAMILY}", ${SYSTEM_FONT_STACK}`);
    });
    expect(loadFont).toHaveBeenCalledWith(THEME_FONT_FAMILY, WOFF2, {});
  });

  it('is refused unless its bytes are WOFF2, and the system stack stays', async () => {
    const { loadFont } = await applied(new TextEncoder().encode('synthetic').buffer);
    expect(loadFont).not.toHaveBeenCalled();
    expect(value('--font-sans')).toBe('');
  });

  it('leaves the system stack when it cannot be read or loaded', async () => {
    const failing = vi.fn(() => Promise.reject(new Error('synthetic font failure')));
    await applied(WOFF2, { loadFont: failing });
    await vi.waitFor(() => {
      expect(failing).toHaveBeenCalled();
    });
    expect(value('--font-sans')).toBe('');
  });

  it('is not loaded without a loader: the system font', () => {
    applySessionTheme(session(FONT_THEME), null, {
      root,
      sheet,
      matchMedia: colourScheme(false).matchMedia,
    });
    expect(value('--font-sans')).toBe('');
  });
});

describe('the branding the header reads (C160.6)', () => {
  it('names the theme’s logo, and none once a session has no theme', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeThemeBranding(listener);
    const logo = {
      'asset-id': 'tsa_01M5CK16P0D13FXHZSS4TCFBVH',
      'alt-key': 'brand.logo.alt',
      decorative: false,
    };
    applySessionTheme(session({ ...THEME, logo }), null, {
      root,
      sheet,
      matchMedia: colourScheme(false).matchMedia,
    });
    expect(currentThemeBranding()).toEqual(logo);
    expect(listener).toHaveBeenCalled();

    applySessionTheme(session(), null, { root, sheet, matchMedia: colourScheme(false).matchMedia });
    expect(currentThemeBranding()).toBeNull();
    unsubscribe();
  });
});
