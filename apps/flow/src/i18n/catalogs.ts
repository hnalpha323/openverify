/** C161.1: every built-in catalog, by language, each typed against `Messages`. */
import type { SupportedLanguage } from './languages';
import { ar } from './locales/ar';
import { de } from './locales/de';
import { en, type Messages } from './locales/en';
import { es } from './locales/es';
import { fr } from './locales/fr';

export const CATALOGS: Readonly<Record<SupportedLanguage, Messages>> = Object.freeze({
  en,
  es,
  fr,
  de,
  ar,
});
