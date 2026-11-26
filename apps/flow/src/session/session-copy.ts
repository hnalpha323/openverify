/**
 * C162 (Workflow 9A, flow-renderer): the session's operator copy over the built-in catalogs.
 *
 * C162.5's order, never a raw key: the person's locale's custom text, else its built-in text, else
 * the version's default locale's custom text, else its built-in text. Operator copy is plain text
 * with `{name}` placeholders (C162.3), filled here from the same values as the built-in `{{name}}`
 * ones. A custom text of a built-in key (one of `COPY_KEYS`) is laid over the i18n catalog, so every
 * screen that reads the key shows it; a component's own text (`<step>.<component>.<attribute>`) is
 * read through `copyText`.
 */
import type { FlowSessionResponse } from '@openverify/contracts';
import type { i18n as I18n } from 'i18next';
import { DEFAULT_LANGUAGE, isSupportedLanguage, type SupportedLanguage } from '../i18n/languages';

type SessionCopy = NonNullable<FlowSessionResponse['copy']>;

/** An operator's `{name}` as i18next's `{{name}}`; a `{{name}}` already written stays as it is. */
const OPERATOR_PLACEHOLDER = /(?<!\{)\{([a-z][a-z0-9_]{0,39})\}(?!\})/gu;

export function toCatalogText(text: string): string {
  return text.replace(OPERATOR_PLACEHOLDER, '{{$1}}');
}

/** The built-in catalog's message at `key` in `language`, or `null` for anything but a message. */
function builtIn(i18n: I18n, language: string, key: string): string | null {
  const value: unknown = i18n.getResource(language, 'translation', key);
  return typeof value === 'string' ? value : null;
}

/**
 * The originals of every catalog text the copy replaced, so a new session can restore them; keyed
 * by the instance's resource store, which every copy of the instance `useTranslation()` answers
 * shares (the copies themselves differ from render to render).
 */
const ORIGINALS = new WeakMap<object, Map<string, string>>();

/** The stores that already hold their own copy of the catalogs. */
const DETACHED = new WeakSet<object>();

/**
 * Gives the store its own copy of the catalogs before a text is replaced. Every instance
 * `createI18n` makes starts from the same module objects, which i18next keeps by reference (its
 * store's data map included), so a replaced text written in place would reach every other instance.
 */
function detach(i18n: I18n): void {
  if (DETACHED.has(i18n.store)) return;
  i18n.store.data = structuredClone(i18n.store.data);
  DETACHED.add(i18n.store);
}

/**
 * Lays the copy's texts for built-in keys over the catalogs of `i18n`, restoring any text an
 * earlier copy replaced that this one does not. Keys the catalogs do not hold as messages are left
 * to `copyText`, so a component key never turns a message into a branch of the catalog.
 */
export function applySessionCopy(i18n: I18n, copy: SessionCopy | undefined): void {
  const originals = ORIGINALS.get(i18n.store) ?? new Map<string, string>();
  ORIGINALS.set(i18n.store, originals);
  for (const [slot, text] of originals) {
    const [language = DEFAULT_LANGUAGE, key = ''] = slot.split('\u0000');
    i18n.addResource(language, 'translation', key, text);
  }
  originals.clear();
  for (const [language, messages] of Object.entries(copy?.messages ?? {})) {
    for (const [key, text] of Object.entries(messages)) {
      const original = builtIn(i18n, language, key);
      if (original === null) continue;
      detach(i18n);
      originals.set(`${language}\u0000${key}`, original);
      i18n.addResource(language, 'translation', key, toCatalogText(text));
    }
  }
}

/** Whether `key` shown in `language` is the operator's own text (C162.9's `copy-source`). */
export function isCustomText(
  copy: SessionCopy | undefined,
  language: string,
  key: string,
): boolean {
  return isSupportedLanguage(language) && copy?.messages[language]?.[key] !== undefined;
}

/**
 * C162.5: the text of `key` (a component's copy key, or a built-in one) in `language`, through the
 * fallbacks, with i18next's own placeholders left for the caller; `null` when nothing holds it.
 */
export function copyText(
  i18n: I18n,
  copy: SessionCopy | undefined,
  key: string,
  language: string,
  defaultLocale: SupportedLanguage = DEFAULT_LANGUAGE,
): string | null {
  for (const candidate of [language, defaultLocale]) {
    if (!isSupportedLanguage(candidate)) continue;
    const custom = copy?.messages[candidate]?.[key];
    if (custom !== undefined) return toCatalogText(custom);
    const catalog = builtIn(i18n, candidate, key);
    if (catalog !== null) return catalog;
  }
  return null;
}

/**
 * WCAG 3.1.2 (Workflow 9D, a11y-audit): the language `key`'s text comes from when C162.5's
 * fallback took it from another locale than `language` (the default locale's custom or built-in
 * text), so the element showing it can say so; `null` when it is in `language`, or held nowhere.
 */
export function copyLanguage(
  i18n: I18n,
  copy: SessionCopy | undefined,
  key: string,
  language: string,
  defaultLocale: SupportedLanguage = DEFAULT_LANGUAGE,
): string | null {
  for (const candidate of [language, defaultLocale]) {
    if (!isSupportedLanguage(candidate)) continue;
    if (copy?.messages[candidate]?.[key] !== undefined || builtIn(i18n, candidate, key) !== null) {
      return candidate === language ? null : candidate;
    }
  }
  return null;
}
