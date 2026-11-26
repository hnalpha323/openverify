import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import { createI18n } from './create-i18n';
import { syncDocumentLanguage } from './document-language';

function htmlElement(): HTMLElement {
  return document.createElement('html');
}

describe('syncDocumentLanguage', () => {
  it('sets <html lang dir> from the built-in Arabic catalog: right to left (C161.3)', () => {
    const root = htmlElement();

    syncDocumentLanguage(createI18n('ar'), root);

    expect(root).toHaveAttribute('lang', 'ar');
    expect(root).toHaveAttribute('dir', 'rtl');
  });

  it.each(['en', 'es', 'fr', 'de'] as const)('keeps %s left to right', (language) => {
    const root = htmlElement();

    syncDocumentLanguage(createI18n(language), root);

    expect(root).toHaveAttribute('lang', language);
    expect(root).toHaveAttribute('dir', 'ltr');
  });

  it('names the full requested tag in lang, and follows a change of language (C161.2)', async () => {
    const root = htmlElement();
    const i18n = createI18n('ar', { requested: ['ar-EG', 'de-AT'] });

    syncDocumentLanguage(i18n, root);
    expect(root).toHaveAttribute('lang', 'ar-EG');
    expect(root).toHaveAttribute('dir', 'rtl');

    await i18n.changeLanguage('de');
    expect(root).toHaveAttribute('lang', 'de-AT');
    expect(root).toHaveAttribute('dir', 'ltr');
  });

  it('mirrors the current language and direction onto the root element', () => {
    const root = htmlElement();

    syncDocumentLanguage(createI18n('es'), root);

    expect(root).toHaveAttribute('lang', 'es');
    expect(root).toHaveAttribute('dir', 'ltr');
  });

  it('follows language changes', async () => {
    const i18n = createI18n('en');
    const root = htmlElement();
    syncDocumentLanguage(i18n, root);

    await i18n.changeLanguage('es');

    expect(root).toHaveAttribute('lang', 'es');
  });

  it('switches the layout to right-to-left for RTL languages', () => {
    const arabic = i18next.createInstance();
    void arabic.init({ lng: 'ar', resources: { ar: { translation: {} } }, initAsync: false });
    const root = htmlElement();

    syncDocumentLanguage(arabic, root);

    expect(root).toHaveAttribute('lang', 'ar');
    expect(root).toHaveAttribute('dir', 'rtl');
  });

  it('stops following changes once unsubscribed', async () => {
    const i18n = createI18n('en');
    const root = htmlElement();
    const unsubscribe = syncDocumentLanguage(i18n, root);

    unsubscribe();
    await i18n.changeLanguage('es');

    expect(root).toHaveAttribute('lang', 'en');
  });
});
