/**
 * C78.3: the retrieval keys of a name. Per list name (strong names only; weak aliases are looked
 * up by `normalised` equality): `t:<token>` in both folds and the original script, `s:<consonant
 * skeleton>`, `g:<variant group id>`, `j:<adjacent pair joined>` and (owner decision 1 after 6B)
 * `p:<atom>+<atom>`, the unordered pair of every two keyed tokens, where a token's atoms are its
 * `t:` keys and its `g:` keys. Particles, generic words, suffixes, legal forms and single letters
 * give no `t:`, `s:` or pair key: they would match half a list.
 *
 * At query time `retrieveCandidates` uses only keys held by at most a bounded number of live
 * entries (`key-frequency-bound-share` of the candidate cap). A common token is then still reached
 * through its pairs with the subject's other tokens, in any order and through their variant
 * groups; {@link queryNameReach} says which keys reach each token, so a search that cannot reach a
 * token through any of them says it was cut short (C78.5) instead of missing silently.
 *
 * The query side adds the crossing keys: each token also as `j:` (it may meet a list pair written
 * as one word) and each joined pair also as `t:` (it may meet a list token).
 */
import { SCREENING_CONSTANTS } from '@openverify/core';
import {
  analyseRecordName,
  type AnalysedName,
  type NameToken,
  type NameTokenType,
} from '../names/index.js';
import type { WatchlistRecord } from '../record/index.js';
import type { VariantGroups } from './variant-groups.js';

/** Tokens that give no `t:`, `s:` or `g:` key. */
const KEYLESS: ReadonlySet<NameTokenType> = new Set([
  'particle',
  'generic',
  'suffix',
  'legal_form',
]);
/** Tokens that join no pair. */
const UNJOINED: ReadonlySet<NameTokenType> = new Set(['suffix', 'legal_form']);
const SKELETON_DROPS = new Set(['a', 'e', 'i', 'o', 'u', 'h', 'w', 'y']);

/**
 * The consonant skeleton of a Latin form (ours, the research's): the first letter kept, later
 * vowels and `h`, `w`, `y` dropped, doubled letters collapsed (`muhammad`, `mohammed` and `mohd`
 * are all `md`).
 */
export function consonantSkeleton(form: string): string {
  const [first, ...rest] = Array.from(form);
  if (first === undefined) {
    return '';
  }
  let skeleton = first;
  let last = first;
  for (const letter of rest) {
    if (!SKELETON_DROPS.has(letter) && letter !== last) {
      skeleton += letter;
    }
    if (!SKELETON_DROPS.has(letter)) {
      last = letter;
    }
  }
  return skeleton;
}

const hasLatin = (token: NameToken) => token.reliability !== 'none' && token.simple !== '';
const reliable = (token: NameToken) =>
  token.reliability === 'native' || token.reliability === 'icao';

/** The variant groups a token belongs to, by every form of it the groups hold. */
export function tokenGroups(token: NameToken, groups: VariantGroups): readonly string[] {
  const forms = new Set([
    ...(reliable(token) ? [token.simple, token.expanded] : []),
    ...(token.original === null ? [] : [token.original]),
  ]);
  // Owner decision 4 after 6C: each distinct form is looked up once, and a token in no group
  // (most tokens) builds no set.
  const found: string[] = [];
  for (const form of forms) {
    found.push(...groups.groupsOf(form));
  }
  return found.length === 0 ? [] : [...new Set(found)].sort();
}

/** A token's own keys (`t:`, `s:`, `g:`) and the atoms it pairs by (`t:` and `g:`). */
interface TokenKeys {
  readonly own: readonly string[];
  readonly atoms: readonly string[];
}

const NO_KEYS: TokenKeys = Object.freeze({ own: [], atoms: [] });

function tokenKeys(token: NameToken, groups: VariantGroups): TokenKeys {
  if (KEYLESS.has(token.type)) {
    return NO_KEYS;
  }
  const forms = new Set<string>();
  let skeletonKey: string | null = null;
  if (hasLatin(token)) {
    for (const form of [token.simple, token.expanded]) {
      if (Array.from(form).length > 1) {
        forms.add(`t:${form}`);
      }
    }
    const skeleton = consonantSkeleton(token.simple);
    if (Array.from(token.simple).length >= 3 && Array.from(skeleton).length >= 2) {
      skeletonKey = `s:${skeleton}`;
    }
  }
  if (token.original !== null) {
    forms.add(`t:${token.original}`);
  }
  const groupKeys = tokenGroups(token, groups).map((group) => `g:${group}`);
  return {
    own: [...forms, ...(skeletonKey === null ? [] : [skeletonKey]), ...groupKeys],
    atoms: [...forms, ...(groupKeys.length <= MAX_PAIR_GROUPS ? groupKeys : [])],
  };
}

function addPairKeys(a: NameToken, b: NameToken, groups: VariantGroups, keys: Set<string>): void {
  if (UNJOINED.has(a.type) || UNJOINED.has(b.type)) {
    return;
  }
  const joined: string[] = [];
  if (hasLatin(a) && hasLatin(b)) {
    joined.push(a.simple + b.simple, a.expanded + b.expanded);
  }
  if (a.original !== null && b.original !== null && a.script === b.script) {
    joined.push(a.original + b.original);
  }
  for (const form of new Set(joined)) {
    keys.add(`j:${form}`);
    groups.groupsOf(form).forEach((group) => keys.add(`g:${group}`));
  }
}

/** Owner decision 1 after 6B: at most this many keyed tokens of a name are paired (`pair-max-tokens`). */
export const MAX_PAIRED_TOKENS = SCREENING_CONSTANTS['pair-max-tokens'].value;

/**
 * Owner decision 1 after 6B: a token in more variant groups than this pairs by its spellings
 * only, so one ambiguous form never multiplies a name's pair keys by its groups (`pair-max-groups`).
 */
export const MAX_PAIR_GROUPS = SCREENING_CONSTANTS['pair-max-groups'].value;

/** The unordered pair key of two token atoms (`t:` or `g:` keys). */
export function pairKey(a: string, b: string): string {
  return a <= b ? `p:${a}+${b}` : `p:${b}+${a}`;
}

/** The keys of each token of a name, and the pair keys of its first keyed tokens. */
type TokenKeyRows = readonly { readonly own: readonly string[]; readonly pairs: Set<string> }[];

/**
 * Owner decision 4 after 6C: the last name's token keys, so `queryNameReach` called right after
 * `queryNameKeys` on the same name (as the re-screen keys each subject) does not compute them
 * again. Analysed names and variant groups are never changed once built.
 */
let lastTokenKeys: {
  readonly name: AnalysedName;
  readonly groups: VariantGroups;
  readonly rows: TokenKeyRows;
} | null = null;

/** The keys of each token of a name, and the pair keys of its first keyed tokens, by token. */
function nameTokenKeys(name: AnalysedName, groups: VariantGroups): TokenKeyRows {
  if (lastTokenKeys?.name === name && lastTokenKeys.groups === groups) {
    return lastTokenKeys.rows;
  }
  const rows = computeNameTokenKeys(name, groups);
  lastTokenKeys = { name, groups, rows };
  return rows;
}

function computeNameTokenKeys(name: AnalysedName, groups: VariantGroups): TokenKeyRows {
  const keyed = name.tokens.map((token) => ({
    ...tokenKeys(token, groups),
    pairs: new Set<string>(),
  }));
  const paired = keyed.filter((token) => token.own.length > 0 && token.atoms.length > 0);
  const first = paired.slice(0, MAX_PAIRED_TOKENS);
  first.forEach((left, index) => {
    for (const right of first.slice(index + 1)) {
      for (const a of left.atoms) {
        for (const b of right.atoms) {
          const key = pairKey(a, b);
          left.pairs.add(key);
          right.pairs.add(key);
        }
      }
    }
  });
  return keyed;
}

/**
 * The key groups that reach a subject's list names (owner decision 1 after 6B): for every two keyed
 * tokens of each name (tokens without a key, such as initials and particles, are left out), the
 * keys that every list name holding both carries: the two tokens' own keys and their pair keys;
 * for a name with one keyed token, that token's own keys. Each group is sorted. `retrieveCandidates`
 * records `truncated` when every key of some group is held by more entries than its bound, since it
 * then cannot reach every list name holding those two tokens, which are the names that can match.
 */
export function queryNameReach(names: readonly AnalysedName[], groups: VariantGroups): string[][] {
  return names.flatMap((name) => {
    const keyed = nameTokenKeys(name, groups).filter((token) => token.own.length > 0);
    if (keyed.length === 1) {
      return keyed.map((token) => [...new Set(token.own)].sort());
    }
    return keyed.flatMap((left, index) =>
      keyed.slice(index + 1).map((right) => {
        const shared = [...left.pairs].filter((key) => right.pairs.has(key));
        return [...new Set([...left.own, ...right.own, ...shared])].sort();
      }),
    );
  });
}

/** The keys a list name is stored with (C78.3), sorted and unique. */
export function listNameKeys(name: AnalysedName, groups: VariantGroups): string[] {
  return [...listNameKeySet(name, groups)].sort();
}

/** The keys of {@link listNameKeys}, in no order. */
function listNameKeySet(name: AnalysedName, groups: VariantGroups): Set<string> {
  const keys = new Set<string>();
  nameTokenKeys(name, groups).forEach((token) => {
    token.own.forEach((key) => keys.add(key));
    token.pairs.forEach((key) => keys.add(key));
  });
  name.tokens.forEach((token, index) => {
    const next = name.tokens[index + 1];
    if (next !== undefined) {
      addPairKeys(token, next, groups, keys);
    }
  });
  return keys;
}

/** The keys a subject's names are looked up by: every list key and the crossing keys. */
export function queryNameKeys(names: readonly AnalysedName[], groups: VariantGroups): string[] {
  const keys = new Set<string>();
  for (const name of names) {
    // One sort, of the whole set (owner decision 4 after 6C).
    for (const key of listNameKeySet(name, groups)) {
      keys.add(key);
      if (key.startsWith('t:')) {
        keys.add(`j:${key.slice(2)}`);
      } else if (key.startsWith('j:')) {
        keys.add(`t:${key.slice(2)}`);
      }
    }
  }
  return [...keys].sort();
}

/** One `watchlist_names` row of a record, as a sync writes it (C73.3, C78.3). */
export interface ListNameRow {
  /** The name's position in the record. */
  readonly ordinal: number;
  readonly name: string;
  readonly normalised: string;
  readonly script: WatchlistRecord['names'][number]['script'];
  readonly quality: WatchlistRecord['names'][number]['quality'];
  readonly primary: boolean;
  /** Empty for a weak alias, which is looked up by `normalised` only (C78.3). */
  readonly keys: readonly string[];
}

/** The `watchlist_names` rows of a record. */
export function recordNameRows(record: WatchlistRecord, groups: VariantGroups): ListNameRow[] {
  return record.names.map((name, ordinal) => {
    const analysed = analyseRecordName(name, record.kind);
    return {
      ordinal,
      name: name.full,
      normalised: analysed.normalised,
      script: name.script,
      quality: name.quality,
      primary: name.primary,
      keys: name.quality === 'strong' ? listNameKeys(analysed, groups) : [],
    };
  });
}
