/**
 * C161.2 (Workflow 9A, flow-renderer): the full tag `Intl` formats with inside a component: the
 * first tag the person asked for (`RequestedLanguagesContext`: the URL's `language`, then the
 * browser's) whose lookup finds the current catalog language, else `intlLocale`. Components read
 * this rather than `intlLocale(i18n)` alone: the `i18n` object `useTranslation()` answers is a copy
 * of the instance `createI18n` made (it shares the instance's store, not its identity), so a lookup
 * keyed by the instance finds nothing there and `ar-EG` would format as plain `ar`.
 */
import { use } from 'react';
import { useTranslation } from 'react-i18next';
import { intlLocale } from '../i18n/intl-locale';
import { canonicalTag, isSupportedLanguage, lookupLanguage } from '../i18n/languages';
import { RequestedLanguagesContext } from './requested-languages';

export function useIntlLocale(): string {
  const { i18n } = useTranslation();
  const requested = use(RequestedLanguagesContext);
  const language = i18n.resolvedLanguage ?? i18n.language;
  if (isSupportedLanguage(language)) {
    for (const candidate of requested) {
      const tag = canonicalTag(candidate);
      if (tag !== null && lookupLanguage(tag, [language]) === language) {
        return tag;
      }
    }
  }
  return intlLocale(i18n);
}
