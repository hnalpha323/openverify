import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, type SupportedLanguage } from '../i18n/languages';

// Each language is named in itself, so people can find theirs whatever is showing.
const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  ar: 'العربية',
};

export interface LanguageSelectProps {
  /**
   * C161.2 (Workflow 9A): the languages offered, the version's `enabled-locales` once a session
   * says so; every built-in language when absent.
   */
  readonly available?: readonly SupportedLanguage[];
}

export function LanguageSelect({ available = SUPPORTED_LANGUAGES }: LanguageSelectProps) {
  const { t, i18n } = useTranslation();
  const id = useId();

  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor={id} className="text-ink-muted">
        {t('app.language')}
      </label>
      <select
        id={id}
        value={i18n.resolvedLanguage ?? DEFAULT_LANGUAGE}
        onChange={(event) => {
          void i18n.changeLanguage(event.currentTarget.value);
        }}
        // `border-control` (4.6:1 or more), like every other form control (WCAG 1.4.11, 2D F010).
        className="min-h-11 rounded-md border border-control bg-surface px-2 text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {available.map((language) => (
          <option key={language} value={language} lang={language}>
            {LANGUAGE_NAMES[language]}
          </option>
        ))}
      </select>
    </div>
  );
}
