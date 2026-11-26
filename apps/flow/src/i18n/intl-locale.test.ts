import { describe, expect, it } from 'vitest';
import { createI18n } from './create-i18n';
import { intlLocale } from './intl-locale';

describe('intlLocale: Intl formats with the full requested tag (C161.2)', () => {
  it('keeps the region, so ar-EG writes Arabic-Indic digits and plain ar Latin ones', () => {
    const egypt = createI18n('ar', { requested: ['ar-EG', 'en'] });
    const plain = createI18n('ar', { requested: ['ar', 'en'] });

    expect(intlLocale(egypt)).toBe('ar-EG');
    expect(intlLocale(plain)).toBe('ar');
    expect(new Intl.NumberFormat(intlLocale(egypt)).format(1234)).toBe('١٬٢٣٤');
    expect(new Intl.NumberFormat(intlLocale(plain)).format(1234)).toBe('1,234');
  });

  it('keeps the region for a copy that shares the instance store, as useTranslation answers inside a component', () => {
    const egypt = createI18n('ar', { requested: ['ar-EG', 'en'] });
    const copy = egypt.cloneInstance();

    expect(copy).not.toBe(egypt);
    expect(copy.store).toBe(egypt.store);
    expect(intlLocale(copy)).toBe('ar-EG');
  });

  it('is the catalog language when nothing more precise was asked for', () => {
    expect(intlLocale(createI18n('de'))).toBe('de');
    expect(intlLocale(createI18n('fr', { requested: ['it-IT', 'fr'] }))).toBe('fr');
  });

  it('follows a change of language to the first requested tag of that language', async () => {
    const i18n = createI18n('ar', { requested: ['ar-EG', 'fr-CA', 'fr-FR'] });

    await i18n.changeLanguage('fr');
    expect(intlLocale(i18n)).toBe('fr-CA');

    await i18n.changeLanguage('es');
    expect(intlLocale(i18n)).toBe('es');
  });

  it('skips requested values that are not language tags', () => {
    expect(intlLocale(createI18n('es', { requested: [null, '', 'no tag', 'es-MX'] }))).toBe(
      'es-MX',
    );
  });
});
