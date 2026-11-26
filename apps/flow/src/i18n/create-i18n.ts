import i18next, { type i18n } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { CATALOGS } from './catalogs';
import { rememberRequestedLocales } from './intl-locale';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, type SupportedLanguage } from './languages';

const resources = Object.fromEntries(
  SUPPORTED_LANGUAGES.map((language) => [language, { translation: CATALOGS[language] }]),
);

export interface CreateI18nOptions {
  /**
   * The language tags the person asked for, in priority order (the `language` parameter, then
   * `navigator.languages`), so `Intl` formats with the full tag (C161.2, `intlLocale`).
   */
  readonly requested?: readonly (string | null | undefined)[];
}

/**
 * Creates an isolated i18next instance for the flow. Messages are bundled, so the
 * instance is ready as soon as this returns (no Suspense, no network request).
 */
export function createI18n(
  language: SupportedLanguage = DEFAULT_LANGUAGE,
  options: CreateI18nOptions = {},
): i18n {
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    lng: language,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGES,
    resources,
    initAsync: false,
    // React already escapes rendered strings.
    interpolation: { escapeValue: false },
  });
  rememberRequestedLocales(instance, options.requested ?? []);
  return instance;
}
