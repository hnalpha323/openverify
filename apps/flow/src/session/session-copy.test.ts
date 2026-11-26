import { describe, expect, it } from 'vitest';
import { createI18n } from '../i18n/create-i18n';
import { en } from '../i18n/locales/en';
import {
  applySessionCopy,
  copyLanguage,
  copyText,
  isCustomText,
  toCatalogText,
} from './session-copy';

// C162.3, C162.5 (Workflow 9A): operator copy over the built-in catalogs, through the fallbacks.

describe('toCatalogText', () => {
  it('reads an operator placeholder as the catalog one, and leaves a catalog one as it is', () => {
    expect(toCatalogText('Kept for {days} days')).toBe('Kept for {{days}} days');
    expect(toCatalogText('Kept for {{days}} days')).toBe('Kept for {{days}} days');
  });
});

describe('applySessionCopy', () => {
  it('lays a custom text of a built-in key over the catalog, and restores it for the next session', () => {
    const i18n = createI18n('en');

    applySessionCopy(i18n, { messages: { en: { 'consent.title': 'Before we start' } } });
    expect(i18n.t('consent.title')).toBe('Before we start');

    applySessionCopy(i18n, undefined);
    expect(i18n.t('consent.title')).toBe(en.consent.title);
  });

  it('never reaches another instance: the built-in catalogs stay as built', () => {
    const one = createI18n('en');
    applySessionCopy(one, { messages: { en: { 'consent.title': 'Before we start' } } });

    expect(createI18n('en').t('consent.title')).toBe(en.consent.title);
    expect(en.consent.title).toBe('Consent to use your biometric data');
  });

  it('never turns a message into a branch for a key the catalogs do not hold', () => {
    const i18n = createI18n('en');

    applySessionCopy(i18n, { messages: { en: { 'consent.title.extra': 'Not a catalog key' } } });

    expect(i18n.t('consent.title')).toBe(en.consent.title);
  });
});

describe('copyText (C162.5)', () => {
  const copy = {
    messages: {
      en: { 'about.title.body': 'About you' },
      fr: { 'about.name.label': 'Prénom' },
    },
  };

  it('takes the person locale custom text, then its built-in text', () => {
    const i18n = createI18n('en');

    expect(copyText(i18n, copy, 'about.title.body', 'en')).toBe('About you');
    expect(copyText(i18n, copy, 'consent.title', 'en')).toBe(en.consent.title);
  });

  it('falls back to the default locale custom text, never to a raw key', () => {
    const i18n = createI18n('en');

    expect(copyText(i18n, copy, 'about.name.label', 'de', 'fr')).toBe('Prénom');
    expect(copyText(i18n, copy, 'about.missing.label', 'de', 'fr')).toBeNull();
  });
});

// WCAG 3.1.2 (Workflow 9D, a11y-audit): a text the fallback took from another locale names it.
describe('copyLanguage', () => {
  const copy = {
    messages: {
      en: { 'about.title.body': 'About you' },
      fr: { 'about.name.label': 'Prénom' },
    },
  };

  it('names the default locale when the text came from it', () => {
    const i18n = createI18n('en');

    expect(copyLanguage(i18n, copy, 'about.name.label', 'de', 'fr')).toBe('fr');
    expect(copyLanguage(i18n, copy, 'about.title.body', 'es')).toBe('en');
  });

  it('names nothing for a text in the page’s language, a built-in one, or none', () => {
    const i18n = createI18n('en');

    expect(copyLanguage(i18n, copy, 'about.title.body', 'en')).toBeNull();
    expect(copyLanguage(i18n, copy, 'consent.title', 'de')).toBeNull();
    expect(copyLanguage(i18n, copy, 'about.missing.label', 'de', 'fr')).toBeNull();
  });
});

describe('isCustomText (C162.9)', () => {
  it('says whether the shown text of a key was the operator copy', () => {
    const copy = { messages: { en: { 'consent.biometric': 'Ours' } } };

    expect(isCustomText(copy, 'en', 'consent.biometric')).toBe(true);
    expect(isCustomText(copy, 'es', 'consent.biometric')).toBe(false);
    expect(isCustomText(undefined, 'en', 'consent.biometric')).toBe(false);
  });
});
