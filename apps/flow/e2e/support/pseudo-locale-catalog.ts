/**
 * C161.7: the English catalog in each pseudo-locale, for the mocked suite. The transform comes
 * from `packages/flow-spec/src/pseudo-locale.ts` by path (it imports nothing), so the hosted bundle
 * never carries it; the catalogs are rebuilt from `en` on every run, so a new message is covered as
 * soon as it exists. A spec serves them as the session's operator copy (`pseudoCopy`) under the
 * built-in language whose direction the pseudo-locale is shown in: `en` for `en-XA`, `ar` for
 * `ar-XB`, so the page is right to left with reversed text.
 */
import {
  pseudoLocalizeTree,
  type PseudoLocale,
} from '../../../../packages/flow-spec/src/pseudo-locale';
import { en, type Messages } from '../../src/i18n/locales/en';

/** The built-in language whose direction each pseudo-locale is shown in. */
export const PSEUDO_BASE_LANGUAGE: Readonly<Record<PseudoLocale, 'en' | 'ar'>> = Object.freeze({
  'en-XA': 'en',
  'ar-XB': 'ar',
});

/** The flow's English messages in `locale`, in the catalog's shape. */
export function pseudoMessages(locale: PseudoLocale): Messages {
  return pseudoLocalizeTree(locale, en);
}

interface Tree {
  readonly [key: string]: string | Tree;
}

function flatten(tree: Tree, prefix = ''): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]): [string, string][] =>
    typeof value === 'string' ? [[`${prefix}${key}`, value]] : flatten(value, `${prefix}${key}.`),
  );
}

/**
 * The session's `copy` member (C162.1) carrying every built-in message in `locale` by its dotted
 * key, under the pseudo-locale's base language.
 */
export function pseudoCopy(locale: PseudoLocale): {
  messages: Partial<Record<'en' | 'ar', Record<string, string>>>;
} {
  return {
    messages: {
      [PSEUDO_BASE_LANGUAGE[locale]]: Object.fromEntries(
        flatten(pseudoMessages(locale) as unknown as Tree),
      ),
    },
  };
}
