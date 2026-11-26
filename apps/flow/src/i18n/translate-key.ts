/**
 * Translates a key that comes from the server (a flow's consent `textKeys`, a step's
 * `messageKey`, a retry hint's reason code), so it cannot be type-checked. Returns `null`
 * unless the key names a message in the current language or the default one: never a key
 * echoed back, never a nested object.
 */
import type { i18n as I18n } from 'i18next';
import { DEFAULT_LANGUAGE } from './languages';

export function translateKey(i18n: I18n, key: string): string | null {
  if (key === '') {
    return null;
  }
  const languages = [i18n.resolvedLanguage ?? i18n.language, DEFAULT_LANGUAGE];
  for (const language of languages) {
    // getResource walks the key path without interpolating; only a string leaf is a message.
    const value: unknown = i18n.getResource(language, 'translation', key);
    if (typeof value === 'string') {
      return value;
    }
  }
  return null;
}
