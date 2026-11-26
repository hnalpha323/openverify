import { describe, expect, it } from 'vitest';
import { createI18n } from './create-i18n';
import { translateKey } from './translate-key';

describe('translateKey', () => {
  it('translates a server-provided key in the current language', () => {
    expect(translateKey(createI18n('en'), 'flow.completion')).toBe(
      'Thank you. Your verification has been submitted, and you can close this page.',
    );
    expect(translateKey(createI18n('es'), 'flow.completion')).toBe(
      'Gracias. Tu verificación se ha enviado y ya puedes cerrar esta página.',
    );
  });

  it('follows language changes', async () => {
    const i18n = createI18n('en');

    await i18n.changeLanguage('es');

    expect(translateKey(i18n, 'consent.title')).toBe(
      'Consentimiento para usar tus datos biométricos',
    );
  });

  it('falls back to English when the current language lacks the key', () => {
    const i18n = createI18n('es');
    i18n.addResource('en', 'translation', 'custom.only_english', 'Only in English');

    expect(translateKey(i18n, 'custom.only_english')).toBe('Only in English');
  });

  it.each([
    ['an unknown key', 'consent.does_not_exist'],
    ['a key naming a group of messages', 'consent'],
    ['an inherited property', 'consent.constructor'],
    ['a prototype key', '__proto__'],
    ['an empty key', ''],
  ])('returns null for %s', (_label, key) => {
    expect(translateKey(createI18n('en'), key)).toBeNull();
  });

  it('never interpolates server-provided keys', () => {
    expect(translateKey(createI18n('en'), 'attempt')).toBe('Attempt {{current}} of {{max}}');
  });
});
