/**
 * C161.6 (the engineering note's 5.2): every plural message defines each category
 * `Intl.PluralRules(locale)` names for its language: Arabic six (zero, one, two, few, many, other),
 * French and Spanish one, many and other, German and English one and other. French and Spanish may
 * leave out `many`, which only exact millions select, when the message's documented range cannot
 * reach it; the range is noted here and beside the key, and this test proves it unreachable. What
 * i18next shows for a missing category is not documented, so a missing one is a failure.
 */
import { describe, expect, it } from 'vitest';
import { CATALOGS } from './catalogs';
import { SUPPORTED_LANGUAGES } from './languages';

interface Tree {
  readonly [key: string]: string | Tree;
}

function leafKeys(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : leafKeys(value, `${prefix}${key}.`),
  );
}

/**
 * The counts each plural message can be given, from the contract that sends them: the document
 * guidance's `max-age-days` (1 to 3,650) and `max-pages` (1 to 50,
 * `packages/contracts/src/verification-attributes.ts`).
 */
const PLURAL_RANGES: Readonly<Record<string, { readonly min: number; readonly max: number }>> = {
  'document.types.utility_bill': { min: 1, max: 3650 },
  'document.types.bank_statement': { min: 1, max: 3650 },
  'document.types.pay_stub': { min: 1, max: 3650 },
  'document.pages': { min: 1, max: 50 },
};

/** Only `many` of French and Spanish may be left out, and only when its range cannot reach it. */
const OMITTABLE: Readonly<Partial<Record<string, readonly Intl.LDMLPluralRule[]>>> = {
  fr: ['many'],
  es: ['many'],
};

const PLURAL_BASES = leafKeys(CATALOGS.en)
  .filter((key) => key.endsWith('_other'))
  .map((key) => key.slice(0, -'_other'.length));

function reachable(locale: string, category: string, range: { min: number; max: number }) {
  const rules = new Intl.PluralRules(locale);
  for (let count = range.min; count <= range.max; count += 1) {
    if (rules.select(count) === category) {
      return true;
    }
  }
  return false;
}

describe('plural messages (C161.6)', () => {
  it('each have their range noted', () => {
    expect(PLURAL_BASES.sort()).toEqual(Object.keys(PLURAL_RANGES).sort());
  });

  it('have the six Arabic categories in the CLDR this runtime carries', () => {
    expect(new Intl.PluralRules('ar').resolvedOptions().pluralCategories.sort()).toEqual(
      ['few', 'many', 'one', 'other', 'two', 'zero'].sort(),
    );
  });

  describe.each(SUPPORTED_LANGUAGES)('in %s', (locale) => {
    const keys = new Set(leafKeys(CATALOGS[locale]));
    const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;

    it.each(PLURAL_BASES)('%s defines every category its language selects', (base) => {
      const range = PLURAL_RANGES[base] ?? { min: 0, max: 1_000_000 };
      const missing = categories.filter((category) => {
        if (keys.has(`${base}_${category}`)) {
          return false;
        }
        const omittable = OMITTABLE[locale]?.includes(category) ?? false;
        return !omittable || reachable(locale, category, range);
      });

      expect(missing).toEqual([]);
    });

    it('defines no plural form its language never selects', () => {
      const stray = [...keys].filter((key) => {
        const match = /_(zero|one|two|few|many|other)$/.exec(key);
        return match !== null && !categories.includes(match[1] as Intl.LDMLPluralRule);
      });

      expect(stray).toEqual([]);
    });
  });
});
