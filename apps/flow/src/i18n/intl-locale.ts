/**
 * C161.2: the full language tag `Intl` formats with. Catalogs are chosen by base language, but
 * digits and dates follow the region (`ar-EG` writes Arabic-Indic digits, plain `ar` Latin ones),
 * so formatting keeps the tag the person asked for. Pass `intlLocale(i18n)` to every
 * `Intl.NumberFormat`, `DateTimeFormat`, `ListFormat`, `DisplayNames` and `Collator`.
 */
import type { i18n as I18n } from 'i18next';
import { canonicalTag, isSupportedLanguage, lookupLanguage } from './languages';

/**
 * Keyed by the instance's resource store: `useTranslation()` answers a copy of the instance that
 * shares its store but not its identity, and the copy must keep the person's region.
 */
const REQUESTED = new WeakMap<I18n['store'], readonly string[]>();

/** Remembers the tags the person asked for, in priority order, for `intlLocale`. */
export function rememberRequestedLocales(
  instance: I18n,
  requested: readonly (string | null | undefined)[],
): void {
  REQUESTED.set(
    instance.store,
    requested.map(canonicalTag).filter((tag): tag is string => tag !== null),
  );
}

/**
 * The tag to pass to `Intl` for the instance's current language: the first requested tag whose
 * lookup finds that language, so a change of language keeps the person's region for it; else
 * the language itself.
 */
export function intlLocale(instance: I18n): string {
  const language = instance.resolvedLanguage ?? instance.language;
  if (!isSupportedLanguage(language)) {
    return language;
  }
  const requested = REQUESTED.get(instance.store) ?? [];
  return requested.find((tag) => lookupLanguage(tag, [language]) === language) ?? language;
}
