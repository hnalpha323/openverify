/**
 * C160.9 (Workflow 9A plumbing; built by `api-themes` in Workflow 9B; V15): applies the session's
 * `theme` to the page.
 *
 * - Each colour token, the radius scale, `color-scheme` and the font stack go through `setProperty`
 *   on one rule (`THEME_RULE_SELECTOR`) at the end of the page's own same-origin stylesheet, never
 *   `cssText`, a style attribute or the root's inline style (Workflow 9C): no inline style anywhere,
 *   and CSSOM changes to a stylesheet are outside the CSP, so the flow's CSP never needs
 *   `'unsafe-inline'`. (WebKit's one `style-src-attr` report on the flow's pages, CI 42331362147
 *   and 42382549247, is the engine's own report for a native `<select>`, made with no page script at
 *   all; it was never this module's: orchestrator decision 3 before 9D, `theme-csp.spec.ts`.)
 *   The rule is unlayered and (0,3,0), so it wins over Tailwind's layered tokens and the stylesheet's
 *   `:root[data-openverify-variant='dark']`, as the earlier inline style did. Without a same-origin
 *   stylesheet the rule goes to an adopted constructed sheet; without either nothing is applied and
 *   the built-in tokens stay. Every value is checked again before it is set (a hex colour, a radius
 *   of 0 to 24 px), so nothing but a colour or a length reaches a property.
 * - The variant: the page's `style-variant` (the hosted URL's or the embed option's) when the theme
 *   has it, else `auto` follows `prefers-color-scheme` and its changes, else light.
 * - With no theme (the built-in tokens, which the stylesheet holds), `style-variant=dark` sets the
 *   stylesheet's flow-only `data-openverify-variant="dark"`, which carries the built-in dark palette.
 * - An uploaded font is read through `loadAsset`, sniffed as WOFF2 and loaded with `FontFace` from
 *   its bytes, then put before the system stack; until then, and on any failure, the system stack.
 * - The logo is published to {@link subscribeThemeBranding} for the header (`ThemeBranding`).
 */
import type { FlowSessionResponse, FlowTheme } from '@openverify/contracts';
import { isWoff2Bytes, type ThemeAssetLoader } from './assets';

/** The public `style-variant` (C160.9). */
export type StyleVariant = 'light' | 'dark';

/** Tailwind's sans-serif stack, the fallback behind an uploaded font (and the system font). */
export const SYSTEM_FONT_STACK =
  'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"';

/** The family an uploaded theme font is loaded under. */
export const THEME_FONT_FAMILY = 'openverify-theme-font';

/** The stylesheet's flow-only attribute for the built-in dark palette (`packages/ui`). */
export const BUILTIN_VARIANT_ATTRIBUTE = 'data-openverify-variant';

/**
 * The selector of the rule the theme is written to (Workflow 9C): (0,3,0), above the stylesheet's
 * `:root[data-openverify-variant='dark']` (0,2,0), and unlayered, above Tailwind's layered tokens.
 */
export const THEME_RULE_SELECTOR = ':root:root:root';

const DARK_QUERY = '(prefers-color-scheme: dark)';
const HEX_COLOUR = /^#[0-9a-f]{6}$/;

/** What the page is given; each part is injected in tests. */
export interface ApplyThemeOptions {
  readonly root?: HTMLElement;
  /**
   * The same-origin stylesheet whose last rule carries the theme (Workflow 9C, WebKit CSP fix);
   * by default the page's own linked stylesheet.
   */
  readonly sheet?: CSSStyleSheet;
  readonly matchMedia?: (query: string) => MediaQueryList;
  /** Reads a logo or font of the session's theme; without it neither is loaded. */
  readonly loadAsset?: ThemeAssetLoader;
  /** Loads a font from bytes (`new FontFace`, `load()`, `document.fonts.add`). */
  readonly loadFont?: (
    family: string,
    bytes: ArrayBuffer,
    descriptors: FontFaceDescriptors,
  ) => Promise<void>;
}

/** The logo the header shows, as the last applied theme names it. */
export type ThemeBrandingState = FlowTheme['logo'];

// The page's theme state: what this module set, the device listener and the branding. -----------

const applied = new WeakMap<CSSStyleDeclaration, Set<string>>();
const themeRules = new WeakMap<CSSStyleSheet, CSSStyleRule>();
let adoptedSheet: CSSStyleSheet | null = null;
let stopFollowing: (() => void) | null = null;
let fontLoaded: string | null = null;
let branding: ThemeBrandingState = null;
/** The loader the latest theme was applied with, which the header's brand reads its logo through. */
let brandingLoader: ThemeAssetLoader | undefined;
const brandingListeners = new Set<() => void>();

/** The current branding, for `useSyncExternalStore`. */
export function currentThemeBranding(): ThemeBrandingState {
  return branding;
}

/** The loader the latest theme was applied with (Workflow 9B), for `ThemeBranding`. */
export function currentThemeAssetLoader(): ThemeAssetLoader | undefined {
  return brandingLoader;
}

/** Listens for branding changes; answers the unsubscribe. */
export function subscribeThemeBranding(listener: () => void): () => void {
  brandingListeners.add(listener);
  return () => {
    brandingListeners.delete(listener);
  };
}

function publishBranding(next: ThemeBrandingState): void {
  const same =
    next === branding ||
    (next !== null &&
      branding !== null &&
      next['asset-id'] === branding['asset-id'] &&
      next['alt-key'] === branding['alt-key'] &&
      next.decorative === branding.decorative);
  if (same) {
    return;
  }
  branding = next === null ? null : { ...next };
  for (const listener of [...brandingListeners]) {
    listener();
  }
}

/** The page's last enabled same-origin stylesheet for every medium, whose rules it may read. */
function pageSheet(): CSSStyleSheet | null {
  for (const sheet of [...document.styleSheets].reverse()) {
    try {
      const media = sheet.media.mediaText;
      if (sheet.disabled || (media !== '' && media !== 'all')) {
        continue;
      }
      if (sheet.href !== null && new URL(sheet.href).origin !== window.location.origin) {
        continue;
      }
      if (sheet.cssRules.length >= 0) {
        return sheet;
      }
    } catch {
      // A sheet whose rules cannot be read (another origin) is never written to.
    }
  }
  return null;
}

/** A constructed sheet adopted by the document, for a page without a stylesheet of its own. */
function constructedSheet(): CSSStyleSheet | null {
  if (adoptedSheet !== null) {
    return adoptedSheet;
  }
  if (typeof CSSStyleSheet !== 'function' || !('adoptedStyleSheets' in document)) {
    return null;
  }
  try {
    const sheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    adoptedSheet = sheet;
    return sheet;
  } catch {
    return null;
  }
}

/** The declaration of the theme's rule in `sheet`, written at its end when it is not there. */
function themeStyle(sheet: CSSStyleSheet | null): CSSStyleDeclaration | null {
  if (sheet === null) {
    return null;
  }
  const known = themeRules.get(sheet);
  if (known !== undefined && [...sheet.cssRules].includes(known)) {
    return known.style;
  }
  try {
    const index = sheet.insertRule(`${THEME_RULE_SELECTOR} {}`, sheet.cssRules.length);
    const rule = sheet.cssRules[index] as CSSStyleRule;
    themeRules.set(sheet, rule);
    return rule.style;
  } catch {
    return null;
  }
}

function set(style: CSSStyleDeclaration | null, property: string, value: string): void {
  if (style === null) {
    return;
  }
  style.setProperty(property, value);
  const mine = applied.get(style) ?? new Set<string>();
  mine.add(property);
  applied.set(style, mine);
}

function remove(style: CSSStyleDeclaration | null, property: string): void {
  if (style === null) {
    return;
  }
  style.removeProperty(property);
  applied.get(style)?.delete(property);
}

/** Removes every property this module set on the theme's rule. */
function clear(style: CSSStyleDeclaration | null): void {
  if (style === null) {
    return;
  }
  for (const property of applied.get(style) ?? []) {
    style.removeProperty(property);
  }
  applied.delete(style);
}

/** The radius scale around the theme's `rounded-md`, as the stylesheet's defaults are around 6. */
function radiusScale(radius: number): [string, string][] {
  return [
    ['--radius-sm', `${String(Math.max(0, radius - 2))}px`],
    ['--radius-md', `${String(radius)}px`],
    ['--radius-lg', `${String(radius + 2)}px`],
    ['--radius-xl', `${String(radius + 6)}px`],
  ];
}

/** The variant to show: the page's choice when the theme has it, else the mode's. */
export function chooseVariant(
  theme: Pick<FlowTheme, 'mode' | 'dark'>,
  styleVariant: StyleVariant | null,
  prefersDark: boolean,
): StyleVariant {
  if (styleVariant === 'light' || (styleVariant === 'dark' && theme.dark !== null)) {
    return styleVariant;
  }
  if (theme.dark === null) {
    return 'light';
  }
  if (theme.mode === 'dark') {
    return 'dark';
  }
  return theme.mode === 'auto' && prefersDark ? 'dark' : 'light';
}

function paint(
  root: HTMLElement,
  style: CSSStyleDeclaration | null,
  theme: FlowTheme,
  variant: StyleVariant,
): void {
  root.removeAttribute(BUILTIN_VARIANT_ATTRIBUTE);
  const palette = variant === 'dark' && theme.dark !== null ? theme.dark : theme.light;
  for (const [token, colour] of Object.entries(palette)) {
    if (typeof colour === 'string' && HEX_COLOUR.test(colour)) {
      set(style, `--color-${token}`, colour);
    } else {
      remove(style, `--color-${token}`);
    }
  }
  const { radius } = theme;
  if (Number.isInteger(radius) && radius >= 0 && radius <= 24) {
    for (const [property, length] of radiusScale(radius)) {
      set(style, property, length);
    }
  } else {
    for (const [property] of radiusScale(0)) {
      remove(style, property);
    }
  }
  set(style, 'color-scheme', variant);
}

function loadFontInto(
  style: CSSStyleDeclaration | null,
  theme: FlowTheme,
  options: ApplyThemeOptions,
): void {
  const { font } = theme;
  if (font.kind !== 'uploaded') {
    fontLoaded = null;
    remove(style, '--font-sans');
    return;
  }
  if (options.loadAsset === undefined || fontLoaded === font['asset-id']) {
    return;
  }
  const assetId = font['asset-id'];
  const loadFont = options.loadFont ?? browserLoadFont;
  void options
    .loadAsset(assetId)
    .then(async ({ bytes }) => {
      if (!isWoff2Bytes(bytes)) {
        return;
      }
      await loadFont(THEME_FONT_FAMILY, bytes, {});
      fontLoaded = assetId;
      set(style, '--font-sans', `"${THEME_FONT_FAMILY}", ${SYSTEM_FONT_STACK}`);
    })
    .catch(() => {
      // The system stack stays: a font that cannot be read or parsed is never half-applied.
    });
}

/** The browser's `FontFace` from bytes (C160.6): no URL is fetched, so `font-src` is not widened. */
async function browserLoadFont(
  family: string,
  bytes: ArrayBuffer,
  descriptors: FontFaceDescriptors,
): Promise<void> {
  const face = new FontFace(family, bytes, descriptors);
  await face.load();
  document.fonts.add(face);
}

/** The built-in palette `styleVariant` names: the stylesheet's dark one for `dark`, else light. */
function builtinVariant(
  root: HTMLElement,
  style: CSSStyleDeclaration | null,
  styleVariant: StyleVariant | null,
): void {
  if (styleVariant === 'dark') {
    root.setAttribute(BUILTIN_VARIANT_ATTRIBUTE, 'dark');
    set(style, 'color-scheme', 'dark');
  } else {
    root.removeAttribute(BUILTIN_VARIANT_ATTRIBUTE);
    set(style, 'color-scheme', 'light');
  }
}

/**
 * C160.9 (Workflow 9D, a11y-audit): the page's `style-variant` on the built-in palettes from the
 * start, so a screen drawn with no session (a session that ended, a link that cannot be read) keeps
 * it too; a session's own theme then repaints through `applySessionTheme`.
 */
export function applyPageVariant(
  styleVariant: StyleVariant | null,
  options: Pick<ApplyThemeOptions, 'root' | 'sheet'> = {},
): void {
  builtinVariant(
    options.root ?? document.documentElement,
    themeStyle(options.sheet ?? pageSheet() ?? constructedSheet()),
    styleVariant,
  );
}

/** Applies the theme of `session` to the page (`options` are injected in tests). */
export function applySessionTheme(
  session: FlowSessionResponse,
  styleVariant: StyleVariant | null,
  options: ApplyThemeOptions = {},
): void {
  const root = options.root ?? document.documentElement;
  const style = themeStyle(options.sheet ?? pageSheet() ?? constructedSheet());
  // An engine without `matchMedia` states no preference: light, and nothing to follow.
  const matchMedia =
    options.matchMedia ??
    (typeof window.matchMedia === 'function' ? (query: string) => window.matchMedia(query) : null);
  stopFollowing?.();
  stopFollowing = null;
  const { theme } = session;
  if (theme === undefined) {
    clear(style);
    fontLoaded = null;
    publishBranding(null);
    builtinVariant(root, style, styleVariant);
    return;
  }
  const query = matchMedia?.(DARK_QUERY) ?? null;
  paint(root, style, theme, chooseVariant(theme, styleVariant, query?.matches === true));
  if (query !== null && styleVariant === null && theme.mode === 'auto' && theme.dark !== null) {
    const follow = () => {
      paint(root, style, theme, chooseVariant(theme, null, query.matches));
    };
    query.addEventListener('change', follow);
    stopFollowing = () => {
      query.removeEventListener('change', follow);
    };
  }
  loadFontInto(style, theme, options);
  if (options.loadAsset !== undefined) {
    brandingLoader = options.loadAsset;
  }
  publishBranding(theme.logo);
}
