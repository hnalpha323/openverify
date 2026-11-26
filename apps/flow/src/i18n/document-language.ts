import type { i18n } from 'i18next';
import { intlLocale } from './intl-locale';

/**
 * Mirrors the active language onto the root element's `lang` and `dir`, so screen
 * readers pick the right voice and the layout (built from logical CSS properties
 * such as `ps-4` and `text-start`) mirrors itself for right-to-left languages (C161.3).
 * `lang` names the full tag the person asked for (`ar-EG`), as `Intl` formats with it
 * (C161.2). Returns a function that stops following language changes.
 */
export function syncDocumentLanguage(instance: i18n, root: HTMLElement): () => void {
  const apply = (language: string) => {
    root.lang = intlLocale(instance);
    root.dir = instance.dir(language);
  };

  apply(instance.language);
  instance.on('languageChanged', apply);
  return () => {
    instance.off('languageChanged', apply);
  };
}
