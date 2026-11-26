/**
 * C98.2, C101.2 (Workflow 7B, owner `list-logic`; Phase 6 outcome 7): the key inputs of the kinds
 * that read the C78 name analysis: the list kinds `name` and last-name candidates, and the graph
 * kinds `name_birthdate` and `name`. `@openverify/watchlist` depends on `@openverify/checks`, so
 * they cannot live in `packages/checks/src/lists/`. This folder calls the analysis (`names`,
 * `translit`) without changing it; no C78.4 constant, threshold, preset or cap moves.
 *
 * `LIST_KEYS_VERSION` (`@openverify/checks`) covers these outputs too, so a change of the C78
 * analysis (`KEYS_VERSION` names-2 today) bumps it and stored items answer `normaliser_outdated`:
 * `list-keys-version.test.ts` pins the pair and `list-name-keys.test.ts` the keys.
 *
 * Tokens hold letters, marks and digits only, so `|` and the space between words cannot occur in
 * one. A key takes each name whole in one fold: a person spelled in the simple fold in one name and
 * the expanded fold in the other (`Jurgen Mueller` against `Jürgen Müller`) gives no key in common.
 * The fuzzy method is what reads such a pair.
 */
import {
  LIST_VALUE_LIMITS,
  ListKeyInputError,
  graphKeyInput,
  type GraphKeyInput,
  type ListKeyInput,
} from '@openverify/checks';
import { analysePersonName, type NameToken } from '../names/index.js';

/** The area this folder holds. */
export const WATCHLIST_LIST_KEYS_AREA = 'list-keys';

/** The members of a name item or probe (C97.1). */
export interface ListName {
  readonly 'name-first': string;
  readonly 'name-last': string;
}

/** The two ICAO 9303 renderings a token carries (the expanded one is §6.A). */
const FOLDS = ['simple', 'expanded'] as const;
type Fold = (typeof FOLDS)[number];

/**
 * A token's text in a fold. Only a `native` or `icao` Latin form crosses scripts: an `any-ascii` or
 * Arabic form loses letters (`王` and `汪` are both `wang`), and a key match is exact and R-tier, so
 * such a token keys on its normalised original (ADR 0005). The fuzzy method reads the lossy forms,
 * with a capped score, as C78.5 does.
 */
const wordOf = (token: NameToken, fold: Fold) =>
  token.reliability === 'native' || token.reliability === 'icao'
    ? token[fold]
    : (token.original ?? token[fold]);

const wordsOf = (tokens: readonly NameToken[], fold: Fold) =>
  tokens
    .map((token) => wordOf(token, fold))
    .filter((word) => word !== '')
    .join(' ');

/** A member under the contract's cap. */
function nameMember(name: ListName, member: keyof ListName): string {
  const text: unknown = name[member];
  if (typeof text !== 'string') {
    throw new ListKeyInputError('invalid_value', member);
  }
  if (text.length > LIST_VALUE_LIMITS.name) {
    throw new ListKeyInputError('out_of_range', member);
  }
  return text;
}

/** What the keys read of a name. */
interface ReadName {
  readonly given: readonly NameToken[];
  readonly family: readonly NameToken[];
  /** A generational suffix: part of an exact name, and no part of a last-name candidate. */
  readonly suffix: readonly NameToken[];
}

/**
 * The C78 analysis of the two fields. A name the analysis would cut is refused: a key of part of a
 * name would never meet the whole one, and a missing first or last name has no exact key.
 */
function readName(name: ListName): ReadName {
  const analysed = analysePersonName({
    first: nameMember(name, 'name-first'),
    last: nameMember(name, 'name-last'),
  });
  if (analysed.truncated) {
    throw new ListKeyInputError('out_of_range', 'name-first');
  }
  const given = analysed.tokens.filter(({ role }) => role === 'given');
  const family = analysed.tokens.filter(({ role }) => role === 'family');
  if (wordsOf(given, 'simple') === '') {
    throw new ListKeyInputError('invalid_value', 'name-first');
  }
  if (wordsOf(family, 'simple') === '') {
    throw new ListKeyInputError('invalid_value', 'name-last');
  }
  return { given, family, suffix: analysed.tokens.filter(({ type }) => type === 'suffix') };
}

/** `<last>|<first>` and `<first>|<last>` per fold, once each: at most 4, in this order. */
function exactForms(name: ListName): string[] {
  const { given, family, suffix } = readName(name);
  return [
    ...new Set(
      FOLDS.flatMap((fold) => {
        const first = wordsOf(given, fold);
        const last = wordsOf([...family, ...suffix], fold);
        return [`${last}|${first}`, `${first}|${last}`];
      }),
    ),
  ];
}

/**
 * C98.2: the exact keys of a name, `<last>|<first>` and `<first>|<last>` per ICAO 9303 fold, at
 * most 4, under `identifier-name`. Titles are dropped and particles kept, as the analysis reads
 * them; a generational suffix stays in the last name, so `John Smith Sr` is not, exactly,
 * `John Smith Jr`.
 * @throws {ListKeyInputError} for a name without both parts, or too long to read whole.
 */
export function listNameKeyInputs(name: ListName): ListKeyInput[] {
  return exactForms(name).map((input) => ({ keyKind: 'identifier-name', input }));
}

/**
 * C98.2 (F17): the last name per fold, under `identifier-name-last`, for the fuzzy candidates. A
 * suffix is left out, so a candidate is found across generations, and the scorer decides.
 * @throws {ListKeyInputError} for a name the exact keys refuse.
 */
export function listLastNameKeyInputs(name: ListName): ListKeyInput[] {
  const { family } = readName(name);
  return [...new Set(FOLDS.map((fold) => wordsOf(family, fold)))].map((input) => ({
    keyKind: 'identifier-name-last',
    input,
  }));
}

/**
 * C101.2: `name_birthdate`: each form of {@link listNameKeyInputs} plus `|YYYY-MM-DD`.
 * @throws {ListKeyInputError} for a name the exact keys refuse, or a date that is no day.
 */
export function graphNameBirthdateKeyInputs(name: ListName, birthdate: string): GraphKeyInput[] {
  const day = graphKeyInput('birthdate', { value: birthdate }).input;
  return exactForms(name).map((form) => ({
    keyKind: 'identifier-name-birthdate',
    input: `${form}|${day}`,
  }));
}

/**
 * C101.2: the weak `name` kind, under `identifier-name`: the list keys, so a list hit and a graph
 * link meet (decision 29, narrowed).
 * @throws {ListKeyInputError} for a name the exact keys refuse.
 */
export function graphNameKeyInputs(name: ListName): GraphKeyInput[] {
  return exactForms(name).map((input) => ({ keyKind: 'identifier-name', input }));
}
