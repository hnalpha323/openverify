/**
 * C78.4 (H, `beta`): the name score. Every constant is `SCREENING_CONSTANTS` (core), provisional,
 * fixed before the matcher and never tuned on the evaluation set.
 *
 * Token pairs, each rule only when the preset enables it: 1.0 for equal tokens (either C58
 * rendering), equal in their original script, or equal after ICAO 9303 §6.B; 0.9 for the same
 * variant group (`cross_script_variant_group` when the scripts differ, else
 * `same_script_variant_group`); 0.8 for a C58 nickname; 0.9 at weight 0.5 for an initial against
 * a token it begins (`initials`; a pair of initials also weighs 0.5); Jaro-Winkler (C58's, with
 * Winkler's 0.7 gate) when at least 0.88 and within the typo budget (one inserted, deleted or
 * substituted letter, or two adjacent letters swapped, in a token of at least the budget's length;
 * `typos`); a pair that rests on a lossy form (C78.2) at most 0.8; `joined_tokens`: two adjacent
 * tokens of either side compared as one token. Legal forms pair only with legal forms of the same
 * key.
 *
 * Alignment: one to one, in any order, maximising the weighted mean. Family-name pairs weigh 1.3;
 * unmatched subject tokens 0.8 and unmatched list tokens 0.2; particles, generic words and legal
 * forms 0.5 (each factor multiplies); a generational suffix on one side only weighs nothing; a
 * known given and family role swap multiplies the score by 0.95; `subset`: when every token of the
 * shorter name (at least two tokens) is matched, the unmatched tokens of the longer weigh 0.2. A
 * single-token subject needs an exact or group match. The best of every pairing is found exactly
 * (Dinkelbach's method over the Hungarian assignment).
 */
import { foldText, jaroWinkler, nicknamePairs } from '@openverify/checks';
import {
  SCREENING_CONSTANTS,
  TYPO_BUDGET_MIN_TOKEN_LENGTH,
  TYPO_EDIT_DISTANCE,
} from '@openverify/core';
import type { VariantGroups } from '../keys/index.js';
import { namesExactlyEqual, type AnalysedName, type NameToken } from '../names/index.js';
import type { LatinReliability, TokenScript } from '../translit/index.js';
import { bestRatioMatching, type Pair, type RatioProblem } from './assignment.js';
import type { ResolvedNameMatching } from './rules.js';

/** The methods a name score can rest on (kebab-case, as a match's `components.methods`). */
export type NameScoreMethod =
  | 'equal'
  | 'original-script'
  | 'icao-transliteration'
  | 'lossy-transliteration'
  | 'variant-group'
  | 'nickname'
  | 'initial'
  | 'typo'
  | 'legal-form'
  | 'joined'
  | 'subset'
  | 'role-swap';

export interface NameScore {
  /** In [0, 1]. */
  readonly score: number;
  /** The names are equal after normalisation, in any order (`name_exact`, C78.5). */
  readonly exact: boolean;
  /** The methods the score rests on, sorted. */
  readonly methods: readonly NameScoreMethod[];
  /** Some pair rests on a lossy form (C78.2). */
  readonly lossy: boolean;
}

const C = (name: Parameters<typeof constant>[0]) => constant(name);
function constant(name: keyof typeof SCREENING_CONSTANTS): number {
  return SCREENING_CONSTANTS[name].value;
}

/**
 * C58.3's nickname links, folded once: each folded name (both renderings) to the folded names it
 * is directly paired with, as `areNicknames` reads the table, so a pair of already folded tokens
 * needs no folding per comparison.
 */
let nicknameLinks: ReadonlyMap<string, ReadonlySet<string>> | undefined;

function nicknamesOf(name: string): ReadonlySet<string> | undefined {
  if (nicknameLinks === undefined) {
    const links = new Map<string, Set<string>>();
    const renderings = (value: string) => {
      const folded = foldText(value);
      return [...new Set([folded.simplified, folded.expanded])].filter((form) => form !== '');
    };
    for (const { formal, nickname } of nicknamePairs()) {
      for (const from of renderings(formal)) {
        for (const to of renderings(nickname)) {
          links.set(from, (links.get(from) ?? new Set()).add(to));
          links.set(to, (links.get(to) ?? new Set()).add(from));
        }
      }
    }
    nicknameLinks = links;
  }
  return nicknameLinks.get(name);
}

/** As C58's `areNicknames` for two folded tokens: directly paired, and not equal. */
const areNicknameTokens = (a: string, b: string) => a !== b && nicknamesOf(a)?.has(b) === true;

/** A string's code points, counted in the scorer's work. */
function codePoints(text: string): string[] {
  work.codePointCounts += 1;
  return Array.from(text);
}

/** At most this many joinable pairs per name are tried (bounded work; ours). */
const MAX_JOINS_TRIED = 4;

/** The code-point lengths of a unit's forms (0 for an empty form, or for no original). */
interface UnitLengths {
  readonly simple: number;
  readonly expanded: number;
  readonly original: number;
}

/** A token, or two adjacent tokens compared as one (`joined_tokens`). */
interface Unit {
  readonly tokens: readonly number[];
  readonly simple: string;
  readonly expanded: string;
  readonly original: string | null;
  /** Read instead of counting again while `unitLengths` is on (owner decision 3 after 6C). */
  readonly lengths: UnitLengths;
  readonly script: TokenScript | null;
  readonly reliability: LatinReliability;
  readonly type: NameToken['type'];
  readonly family: boolean;
  readonly given: boolean;
  /** A particle, generic word or legal form: weighs 0.5. */
  readonly low: boolean;
  /** A single Latin letter: its pairs weigh 0.5. */
  readonly initial: boolean;
  readonly groups: readonly string[];
  readonly joined: boolean;
  /** The token of a single unit (`null` for a joined one): its forms are the unit's. */
  readonly token: NameToken | null;
  /**
   * `token-pairs`: this subject unit's pair scores with single list units, by matching and list
   * token, kept while the unit is (a subject name's units live as long as the name).
   */
  pairs: Map<ResolvedNameMatching, Map<NameToken, PairScore | null>> | undefined;
  /** `rescreen-bound-memo`: the content key of a single unit's token, made at its first use. */
  contentKey?: string | undefined;
}

const LOW_TYPES = new Set<NameToken['type']>(['particle', 'generic', 'legal_form']);
const UNJOINED = new Set<NameToken['type']>(['suffix', 'legal_form']);
const RELIABILITY_ORDER: readonly LatinReliability[] = ['native', 'icao', 'lossy', 'none'];
const reliable = (unit: Pick<Unit, 'reliability'>) =>
  unit.reliability === 'native' || unit.reliability === 'icao';
const hasLatin = (unit: Pick<Unit, 'reliability' | 'simple'>) =>
  unit.reliability !== 'none' && unit.simple !== '';

const NO_GROUPS: readonly string[] = Object.freeze([]);

/**
 * The variant groups of a unit's forms: those of its Latin forms when they are reliable, then those
 * of its original form, each group once, in that order. One form's groups are read as the variant
 * groups hold them; a list is built only when a second form adds a group.
 */
function groupsOf(
  forms: { simple: string; expanded: string; original: string | null },
  isReliable: boolean,
  groups: VariantGroups,
): readonly string[] {
  const looked = isReliable
    ? forms.expanded === forms.simple
      ? [forms.simple, forms.original]
      : [forms.simple, forms.expanded, forms.original]
    : [forms.original];
  let found: readonly string[] = NO_GROUPS;
  let merged: string[] | null = null;
  for (const form of looked) {
    const ids = form === null || form === '' ? NO_GROUPS : groups.groupsOf(form);
    if (ids.length === 0) {
      continue;
    }
    if (merged === null && found.length === 0) {
      found = ids;
      continue;
    }
    if (merged === null) {
      merged = [];
      for (const id of found) {
        if (!merged.includes(id)) {
          merged.push(id);
        }
      }
    }
    for (const id of ids) {
      if (!merged.includes(id)) {
        merged.push(id);
      }
    }
  }
  if (merged !== null) {
    return merged;
  }
  // One form's groups, each once (the variant groups list each group of a form once).
  return found.length <= 1 || new Set(found).size === found.length ? found : [...new Set(found)];
}

function lengthsOf(forms: { simple: string; expanded: string; original: string | null }) {
  return {
    simple: codePoints(forms.simple).length,
    expanded: codePoints(forms.expanded).length,
    original: forms.original === null ? 0 : codePoints(forms.original).length,
  };
}

function singleUnit(token: NameToken, index: number, groups: VariantGroups): Unit {
  const lengths = lengthsOf(token);
  return {
    tokens: [index],
    simple: token.simple,
    expanded: token.expanded,
    original: token.original,
    lengths,
    script: token.script,
    reliability: token.reliability,
    type: token.type,
    family: token.role === 'family',
    given: token.role === 'given',
    low: LOW_TYPES.has(token.type),
    initial: token.script === 'latin' && lengths.simple === 1,
    groups: token.type === 'legal_form' ? NO_GROUPS : groupsOf(token, reliable(token), groups),
    joined: false,
    token,
    pairs: undefined,
  };
}

function joinedUnit(a: Unit, b: Unit, groups: VariantGroups): Unit {
  work.joinedUnits += 1;
  const reliability =
    RELIABILITY_ORDER[
      Math.max(RELIABILITY_ORDER.indexOf(a.reliability), RELIABILITY_ORDER.indexOf(b.reliability))
    ] ?? 'none';
  const latin = hasLatin(a) && hasLatin(b);
  const forms = {
    simple: latin ? a.simple + b.simple : '',
    expanded: latin ? a.expanded + b.expanded : '',
    original:
      a.original !== null && b.original !== null && a.script === b.script
        ? a.original + b.original
        : null,
  };
  return {
    tokens: [...a.tokens, ...b.tokens],
    ...forms,
    lengths: lengthsOf(forms),
    script: a.script === b.script ? a.script : 'mixed',
    reliability: latin ? reliability : 'none',
    type: a.low && b.low ? a.type : 'word',
    family: a.family || b.family,
    given: a.given || b.given,
    low: a.low && b.low,
    initial: false,
    groups: groupsOf(forms, reliability === 'native' || reliability === 'icao', groups),
    joined: true,
    token: null,
    pairs: undefined,
  };
}

/** Whether two equal-length strings differ by two adjacent code points swapped. */
function transposed(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const differ = left.flatMap((letter, index) => (letter === right[index] ? [] : [index]));
  const [first, second] = differ;
  return (
    differ.length === 2 &&
    first !== undefined &&
    second === first + 1 &&
    left[first] === right[second] &&
    left[second] === right[first]
  );
}

/**
 * Whether two strings are one typo apart (C78.4): one inserted, deleted or substituted code point,
 * or, under the optimal string alignment distance (owner decision 4 after 6B), two adjacent code
 * points swapped.
 */
function withinOneEdit(a: string, b: string): boolean {
  const left = codePoints(a);
  const right = codePoints(b);
  if (Math.abs(left.length - right.length) > 1) {
    return false;
  }
  if (TYPO_EDIT_DISTANCE.value === 'optimal_string_alignment' && transposed(left, right)) {
    return true;
  }
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) {
      return false;
    }
    if (shorter.length === longer.length) {
      i += 1;
    }
    j += 1;
  }
  return edits + (longer.length - j) <= 1;
}

interface PairContext {
  readonly matching: ResolvedNameMatching;
  /** The subject has one name word: only exact and group pairs count (C78.4). */
  readonly singleWordSubject: boolean;
}

interface PairScore {
  readonly score: number;
  readonly method: NameScoreMethod;
  readonly lossy: boolean;
}

/** The best pair score of a subject unit and a list unit under the preset, or `null`. */
function pairScore(a: Unit, b: Unit, context: PairContext): PairScore | null {
  if (a.joined && b.joined) {
    return null;
  }
  if (
    a.type === 'legal_form' ||
    b.type === 'legal_form' ||
    a.type === 'suffix' ||
    b.type === 'suffix'
  ) {
    return a.type === b.type && a.simple === b.simple
      ? { score: 1, method: a.type === 'legal_form' ? 'legal-form' : 'equal', lossy: false }
      : null;
  }
  const { rules, typoBudget } = context.matching;
  let best: PairScore | null = null;
  const consider = (score: number, method: NameScoreMethod, lossy = false) => {
    if (best === null || score > best.score) {
      best = { score, method, lossy };
    }
  };
  const latin = hasLatin(a) && hasLatin(b);
  const latinEqual =
    latin &&
    (a.simple === b.simple ||
      a.expanded === b.expanded ||
      a.simple === b.expanded ||
      a.expanded === b.simple);
  if (latinEqual && reliable(a) && reliable(b)) {
    if (a.reliability === 'native' && b.reliability === 'native') {
      if (rules.has('equal_tokens')) {
        consider(C('token-equal'), 'equal');
      }
    } else if (rules.has('icao_transliteration_equal')) {
      consider(C('token-equal'), 'icao-transliteration');
    }
  }
  if (
    a.original !== null &&
    a.original === b.original &&
    a.script === b.script &&
    rules.has('original_script_equal')
  ) {
    consider(C('token-equal'), 'original-script');
  }
  const lossy = a.reliability === 'lossy' || b.reliability === 'lossy';
  if (latinEqual && lossy && rules.has('icao_transliteration_equal')) {
    consider(C('lossy-pair-cap'), 'lossy-transliteration', true);
  }
  if (a.groups.some((group) => b.groups.includes(group))) {
    const rule = a.script === b.script ? 'same_script_variant_group' : 'cross_script_variant_group';
    if (rules.has(rule)) {
      consider(C('token-variant-group'), 'variant-group');
    }
  }
  if (context.singleWordSubject && a.type === 'word') {
    return best;
  }
  const native = a.reliability === 'native' && b.reliability === 'native';
  if (!a.joined && !b.joined && native) {
    if (rules.has('nicknames') && areNicknameTokens(a.simple, b.simple)) {
      consider(C('token-nickname'), 'nickname');
    }
    const [shorter, longer] = a.initial ? [a, b] : [b, a];
    if (
      rules.has('initials') &&
      a.initial !== b.initial &&
      (shortcuts.unitLengths ? longer.lengths.simple : codePoints(longer.simple).length) > 1 &&
      longer.simple.startsWith(shorter.simple)
    ) {
      consider(C('token-initial'), 'initial');
    }
  }
  const budget = TYPO_BUDGET_MIN_TOKEN_LENGTH[typoBudget];
  if (latin && rules.has('typos') && budget !== null) {
    for (const [left, right, leftLength, rightLength] of [
      [a.simple, b.simple, a.lengths.simple, b.lengths.simple],
      [a.expanded, b.expanded, a.lengths.expanded, b.lengths.expanded],
    ] as const) {
      // With `unitLengths`, the lengths are the units' own, and two forms more than one code point
      // apart are never one edit apart, so `withinOneEdit` is not asked.
      const counted = shortcuts.unitLengths
        ? [leftLength, rightLength]
        : [codePoints(left).length, codePoints(right).length];
      const [l = 0, r = 0] = counted;
      if (
        left !== right &&
        Math.min(l, r) >= budget &&
        (!shortcuts.unitLengths || Math.abs(l - r) <= 1) &&
        withinOneEdit(left, right)
      ) {
        const similarity = jaroWinkler(left, right, {
          boostThreshold: C('jaro-winkler-prefix-gate'),
        });
        if (similarity >= C('jaro-winkler-minimum')) {
          consider(lossy ? Math.min(similarity, C('lossy-pair-cap')) : similarity, 'typo', lossy);
        }
      }
    }
  }
  return best;
}

/** The weight of a matched pair: family 1.3, low 0.5, initial 0.5, each multiplying. */
function pairWeight(a: Unit, b: Unit): number {
  return (
    (a.family || b.family ? C('family-name-weight') : 1) *
    (a.low || b.low ? C('particle-weight') : 1) *
    (a.initial || b.initial ? C('token-initial-weight') : 1)
  );
}

/** The weight of an unmatched unit: its tokens at `base`, family 1.3 and low 0.5 multiplying. */
function unmatchedWeight(
  unit: Unit,
  tokens: readonly NameToken[],
  base: number,
  otherHasSuffix: boolean,
): number {
  return unit.tokens.reduce((total, index) => {
    const token = tokens[index];
    if (token === undefined || (token.type === 'suffix' && !otherHasSuffix)) {
      return total;
    }
    return (
      total +
      base *
        (token.role === 'family' ? C('family-name-weight') : 1) *
        (LOW_TYPES.has(token.type) ? C('particle-weight') : 1)
    );
  }, 0);
}

/** The adjacent pairs of a side that pair with some unit of the other side. */
function usefulJoins(
  singles: readonly Unit[],
  cached: readonly (Unit | null)[] | null,
  others: readonly Unit[],
  groups: VariantGroups,
  pair: (unit: Unit, other: Unit) => PairScore | null,
): Unit[] {
  const joins: Unit[] = [];
  for (let index = 0; index + 1 < singles.length && joins.length < MAX_JOINS_TRIED; index += 1) {
    const joined =
      cached === null ? joinable(singles[index], singles[index + 1], groups) : cached[index];
    if (
      joined !== null &&
      joined !== undefined &&
      others.some((other) => mayPair(joined, other) && pair(joined, other) !== null)
    ) {
      joins.push(joined);
    }
  }
  return joins;
}

/** Every choice of non-overlapping joins, the empty choice first. */
function joinChoices(joins: readonly Unit[]): Unit[][] {
  const choices: Unit[][] = [[]];
  for (const join of joins) {
    const extended = choices
      .filter((choice) =>
        choice.every((chosen) => !chosen.tokens.some((token) => join.tokens.includes(token))),
      )
      .map((choice) => [...choice, join]);
    choices.push(...extended);
  }
  return choices;
}

/** A side's units under a choice of joins, in token order. */
function unitsOf(singles: readonly Unit[], joins: readonly Unit[]): Unit[] {
  const covered = new Set(joins.flatMap((join) => join.tokens));
  return [...singles.filter((unit) => !covered.has(unit.tokens[0] ?? -1)), ...joins].sort(
    (left, right) => (left.tokens[0] ?? 0) - (right.tokens[0] ?? 0),
  );
}

interface Candidate {
  readonly ratio: number;
  readonly pairs: readonly Pair[];
  readonly left: readonly Unit[];
  readonly right: readonly Unit[];
  readonly scores: readonly (readonly (PairScore | null)[])[];
  readonly subset: boolean;
}

function solve(
  left: readonly Unit[],
  right: readonly Unit[],
  subject: AnalysedName,
  list: AnalysedName,
  pair: Pairing,
  subjectBase: number,
): Omit<Candidate, 'subset'> {
  const scores = left.map((a) => right.map((b) => pair(a, b)));
  const subjectSuffix = subject.tokens.some((token) => token.type === 'suffix');
  const listSuffix = list.tokens.some((token) => token.type === 'suffix');
  const problem: RatioProblem = {
    scores: scores.map((row) => row.map((pair) => pair?.score ?? null)),
    weights: left.map((a) => right.map((b) => pairWeight(a, b))),
    unmatchedLeft: left.map((unit) =>
      unmatchedWeight(unit, subject.tokens, subjectBase, listSuffix),
    ),
    unmatchedRight: right.map((unit) =>
      unmatchedWeight(unit, list.tokens, C('unmatched-list-token-weight'), subjectSuffix),
    ),
  };
  const { ratio, pairs } = bestRatioMatching(problem);
  return { ratio, pairs, left, right, scores };
}

const NO_SCORE: NameScore = Object.freeze({ score: 0, exact: false, methods: [], lossy: false });

/** What the scorer did since the last {@link resetScorerWork}: a measure of its work, for tests. */
export interface ScorerWork {
  /** Token pairs scored. */
  readonly pairScores: number;
  /** Token units built. */
  readonly units: number;
  /** Exact alignments solved (one per name pair scored in full). */
  readonly alignments: number;
  /** Joined units (two adjacent tokens as one) built. */
  readonly joinedUnits: number;
  /** Strings whose code points were counted. */
  readonly codePointCounts: number;
  /** Maps made to keep a name pair's token pair scores (`shared-matrix`). */
  readonly matrixMaps: number;
  /** Name pairs not aligned because their best ratio is shown below the floor (`ratio-check`). */
  readonly ratioExits: number;
  /** Upper bounds computed (C271.2: `rescreen-bound-memo` keeps them across subjects). */
  readonly bounds: number;
}

const work = {
  pairScores: 0,
  units: 0,
  alignments: 0,
  joinedUnits: 0,
  codePointCounts: 0,
  matrixMaps: 0,
  ratioExits: 0,
  bounds: 0,
};

/** The scorer's work since the last {@link resetScorerWork}. */
export function scorerWork(): ScorerWork {
  return { ...work };
}

/** Starts counting the scorer's work again. */
export function resetScorerWork(): void {
  work.pairScores = 0;
  work.units = 0;
  work.alignments = 0;
  work.joinedUnits = 0;
  work.codePointCounts = 0;
  work.matrixMaps = 0;
  work.ratioExits = 0;
  work.bounds = 0;
}

/**
 * The scorer's shortcuts (owner decision 1 after 6B; `unitLengths` and `joinCache`, owner decision 3
 * after 6C), switched by `match/shortcuts.ts`.
 */
const shortcuts = {
  unitCache: true,
  sharedMatrix: true,
  unitLengths: true,
  joinCache: true,
  indexedMatrix: true,
  ratioCheck: true,
  tokenPairs: true,
};

/** Switches the scorer's shortcuts (see `match/shortcuts.ts`); a member left out keeps its state. */
export function setScorerShortcuts(next: {
  readonly unitCache: boolean;
  readonly sharedMatrix: boolean;
  readonly unitLengths?: boolean | undefined;
  readonly joinCache?: boolean | undefined;
  readonly indexedMatrix?: boolean | undefined;
  readonly ratioCheck?: boolean | undefined;
  readonly tokenPairs?: boolean | undefined;
}): void {
  shortcuts.unitCache = next.unitCache;
  shortcuts.sharedMatrix = next.sharedMatrix;
  shortcuts.unitLengths = next.unitLengths ?? shortcuts.unitLengths;
  shortcuts.joinCache = next.joinCache ?? shortcuts.joinCache;
  shortcuts.indexedMatrix = next.indexedMatrix ?? shortcuts.indexedMatrix;
  shortcuts.ratioCheck = next.ratioCheck ?? shortcuts.ratioCheck;
  shortcuts.tokenPairs = next.tokenPairs ?? shortcuts.tokenPairs;
}

/** What the scorer keeps of one name, per variant groups: its single units and joined units. */
interface NameUnits {
  singles: readonly Unit[] | undefined;
  joins: readonly (Unit | null)[] | undefined;
}

/**
 * Each name's {@link NameUnits}, by variant groups and analysed name: one slot per name holds both
 * caches, so a name new to the process costs one entry, not one per cache.
 */
const nameUnits = new WeakMap<VariantGroups, WeakMap<AnalysedName, NameUnits>>();

function slotOf(name: AnalysedName, groups: VariantGroups): NameUnits {
  let byName = nameUnits.get(groups);
  if (byName === undefined) {
    byName = new WeakMap();
    nameUnits.set(groups, byName);
  }
  let slot = byName.get(name);
  if (slot === undefined) {
    slot = { singles: undefined, joins: undefined };
    byName.set(name, slot);
  }
  return slot;
}

/**
 * A name's single-token units, built once per name and variant groups while `unitCache` is on (a
 * list name analysed once per process is then also unitised once).
 */
function singlesOf(name: AnalysedName, groups: VariantGroups): readonly Unit[] {
  const build = () =>
    name.tokens.map((token, index) => {
      work.units += 1;
      return singleUnit(token, index, groups);
    });
  if (!shortcuts.unitCache) {
    return build();
  }
  const slot = slotOf(name, groups);
  slot.singles ??= build();
  return slot.singles;
}

/**
 * Owner decision 3 after 6C (`joinCache`): a name's joined units, one per adjacent pair of its
 * single units (`null` where either never joins), built once per name and variant groups, so the
 * bound and the alignment no longer rebuild them for every pair. `null` while the cache is off: the
 * callers then build each one as they need it, as before.
 */
function cachedJoinsOf(
  name: AnalysedName,
  singles: readonly Unit[],
  groups: VariantGroups,
): readonly (Unit | null)[] | null {
  if (!shortcuts.joinCache) {
    return null;
  }
  const slot = slotOf(name, groups);
  slot.joins ??= singles.slice(1).map((next, index) => joinable(singles[index], next, groups));
  return slot.joins;
}

/** Scores a subject unit against a list unit; with `sharedMatrix`, each pair once per name pair. */
type Pairing = (a: Unit, b: Unit) => PairScore | null;

/**
 * A unit's place in its name: its token for a single unit, the name's token count plus its first
 * token for a joined unit (two adjacent tokens), so each unit of a name has its own place below
 * twice the token count. Units at one place of one name have the same content.
 */
const placeOf = (unit: Unit, tokens: number): number =>
  (unit.joined ? tokens : 0) + (unit.tokens[0] ?? 0);

/** No score is known yet at this place of the indexed matrix. */
const UNSCORED = undefined;

/**
 * A pair's score; with `token-pairs`, a subject unit keeps its score with each single list unit by
 * the list unit's token (whose forms, script, reliability and type are the unit's, its variant
 * groups those of the same groups), under the matching: `pairScore` reads nothing else of either
 * unit, and the context's one-word flag is the subject unit's own name's.
 */
function scoredPair(a: Unit, b: Unit, context: PairContext): PairScore | null {
  if (!shortcuts.tokenPairs || b.token === null) {
    work.pairScores += 1;
    return pairScore(a, b, context);
  }
  a.pairs ??= new Map();
  let row = a.pairs.get(context.matching);
  if (row === undefined) {
    row = new Map();
    a.pairs.set(context.matching, row);
  }
  const known = row.get(b.token);
  if (known !== undefined || row.has(b.token)) {
    return known ?? null;
  }
  work.pairScores += 1;
  const scored = pairScore(a, b, context);
  row.set(b.token, scored);
  return scored;
}

function pairingOf(context: PairContext, subjectTokens: number, listTokens: number): Pairing {
  if (!shortcuts.sharedMatrix) {
    return (a, b) => {
      return scoredPair(a, b, context);
    };
  }
  if (shortcuts.indexedMatrix) {
    // Owner decision 3 after 6C (`indexed-matrix`): one array, a row per subject place.
    const width = 2 * listTokens;
    const table = new Array<PairScore | null | typeof UNSCORED>(2 * subjectTokens * width);
    return (a, b) => {
      const at = placeOf(a, subjectTokens) * width + placeOf(b, listTokens);
      const known = table[at];
      if (known !== UNSCORED) {
        return known;
      }
      const scored = scoredPair(a, b, context);
      table[at] = scored;
      return scored;
    };
  }
  const table = new Map<Unit, Map<Unit, PairScore | null>>();
  work.matrixMaps += 1;
  return (a, b) => {
    let row = table.get(a);
    if (row === undefined) {
      row = new Map();
      work.matrixMaps += 1;
      table.set(a, row);
    }
    const known = row.get(b);
    if (known !== undefined || row.has(b)) {
      return known ?? null;
    }
    const scored = scoredPair(a, b, context);
    row.set(b, scored);
    return scored;
  };
}

const contextOf = (subject: AnalysedName, matching: ResolvedNameMatching): PairContext => ({
  matching,
  singleWordSubject: subject.tokens.filter((token) => token.type === 'word').length === 1,
});

/** A name pair's bound and, once computed, its score, kept for one screening (`pair-memo`). */
export interface PairMemo {
  readonly bound: number;
  readonly score: NameScore | null;
  /** With no score: the score is known to be below this (`ratio-check`). */
  readonly below?: number | undefined;
}

export interface ScoreAboveOptions {
  /** The pairs of one subject name already bounded or scored in this screening, by list name. */
  readonly memo?: Map<AnalysedName, PairMemo> | undefined;
  /** Refuse a bound equal to `floor` too (an exact best pair no equal score can replace). */
  readonly strict?: boolean | undefined;
}

/**
 * The score of a pair whose upper bound ({@link nameScoreUpperBound}) reaches `floor` (exceeds it
 * when `strict`), else `null`: it could not be returned. With `sharedMatrix` the bound and the
 * alignment read one table of token pair scores, and with a `memo` a pair met before in this
 * screening is not bounded or aligned again (owner decision 1 after 6B); the score is
 * {@link scoreNamePair}'s either way.
 */
export function scoreNamePairAbove(
  subject: AnalysedName,
  list: AnalysedName,
  matching: ResolvedNameMatching,
  groups: VariantGroups,
  floor: number,
  options: ScoreAboveOptions = {},
): NameScore | null {
  const passes = (bound: number) => (options.strict === true ? bound > floor : bound >= floor);
  const known = options.memo?.get(list);
  if (
    known !== undefined &&
    (!passes(known.bound) ||
      known.score !== null ||
      (known.below !== undefined && floor >= known.below))
  ) {
    return passes(known.bound) ? known.score : null;
  }
  const context = contextOf(subject, matching);
  const pair = pairingOf(context, subject.tokens.length, list.tokens.length);
  const bound =
    known?.bound ??
    (matching.preset === 'exact'
      ? nameScoreUpperBound(subject, list, matching, groups)
      : upperBound(subject, list, matching, groups, context, pair));
  if (!passes(bound)) {
    options.memo?.set(list, { bound, score: null });
    return null;
  }
  const score =
    matching.preset === 'exact'
      ? scoreNamePair(subject, list, matching, groups)
      : scoreWith(
          subject,
          list,
          matching,
          groups,
          context,
          shortcuts.sharedMatrix && known === undefined
            ? pair
            : pairingOf(context, subject.tokens.length, list.tokens.length),
          floor,
        );
  options.memo?.set(list, score === null ? { bound, score, below: floor } : { bound, score });
  return score;
}

/** Scores a subject name against a list name under a preset. */
export function scoreNamePair(
  subject: AnalysedName,
  list: AnalysedName,
  matching: ResolvedNameMatching,
  groups: VariantGroups,
): NameScore {
  if (matching.preset === 'exact') {
    const exact = namesExactlyEqual(subject, list);
    return exact ? { score: 1, exact, methods: ['equal'], lossy: false } : NO_SCORE;
  }
  const context = contextOf(subject, matching);
  return (
    scoreWith(
      subject,
      list,
      matching,
      groups,
      context,
      pairingOf(context, subject.tokens.length, list.tokens.length),
      null,
    ) ?? NO_SCORE
  );
}

/** What {@link cannotReach} reads besides the units. */
interface ReachCheck {
  readonly subject: AnalysedName;
  readonly list: AnalysedName;
  readonly pair: Pairing;
  readonly floor: number;
  readonly subsetApplies: boolean;
}

/** A value of the parametric alignment shown below zero by this much is below it (rounding). */
const REACH_MARGIN = 1e-9;

/**
 * Owner decision 3 after 6C (`ratio-check`): whether no alignment of the name pair can reach
 * `floor`, under any choice of joins, plain or as a subset. An alignment reaches a ratio of
 * `floor` exactly when its pairs' values `w(s - floor) + floor(u_left + u_right)` sum to at least
 * `floor` times every unit's unmatched weight (Dinkelbach's parametric form, `assignment.ts`); the
 * sum of each unit's best positive value over every unit of every choice bounds every alignment's
 * sum (an alignment takes each unit once, and a choice's units are among them), and every choice's
 * unmatched weights add up to the same total, its tokens'. So a sum below that total, by more than
 * rounding, means every alignment's ratio, and the score it gives (the role swap only lowers it),
 * is below `floor`.
 */
function cannotReach(
  left: readonly Unit[],
  right: readonly Unit[],
  { subject, list, pair, floor, subsetApplies }: ReachCheck,
): boolean {
  const subjectSuffix = subject.tokens.some((token) => token.type === 'suffix');
  const listSuffix = list.tokens.some((token) => token.type === 'suffix');
  const unmatchedRight = right.map((unit) =>
    unmatchedWeight(unit, list.tokens, C('unmatched-list-token-weight'), subjectSuffix),
  );
  const rightTotal = right.reduce(
    (total, unit, j) => (unit.joined ? total : total + (unmatchedRight[j] ?? 0)),
    0,
  );
  const bases = subsetApplies
    ? [C('unmatched-subject-token-weight'), C('subset-unmatched-weight')]
    : [C('unmatched-subject-token-weight')];
  return bases.every((base) => {
    let relaxed = 0;
    let total = rightTotal;
    left.forEach((a) => {
      const unmatched = unmatchedWeight(a, subject.tokens, base, listSuffix);
      if (!a.joined) {
        total += unmatched;
      }
      let best = 0;
      right.forEach((b, j) => {
        // A joined unit pairs only where `mayPair` allows (a superset of `pairScore`).
        const scored = (a.joined || b.joined) && !mayPair(a, b) ? null : pair(a, b);
        if (scored !== null) {
          const value =
            pairWeight(a, b) * (scored.score - floor) +
            floor * (unmatched + (unmatchedRight[j] ?? 0));
          best = Math.max(best, value);
        }
      });
      relaxed += best;
    });
    return relaxed - floor * total < -REACH_MARGIN;
  });
}

function scoreWith(
  subject: AnalysedName,
  list: AnalysedName,
  matching: ResolvedNameMatching,
  groups: VariantGroups,
  context: PairContext,
  pair: Pairing,
  floor: number | null,
): NameScore | null {
  const exact = namesExactlyEqual(subject, list);
  const leftSingles = singlesOf(subject, groups);
  const rightSingles = singlesOf(list, groups);
  const leftJoins = matching.rules.has('joined_tokens')
    ? usefulJoins(
        leftSingles,
        cachedJoinsOf(subject, leftSingles, groups),
        rightSingles,
        groups,
        pair,
      )
    : [];
  const rightJoins = matching.rules.has('joined_tokens')
    ? usefulJoins(
        rightSingles,
        cachedJoinsOf(list, rightSingles, groups),
        leftSingles,
        groups,
        (unit, other) => pair(other, unit),
      )
    : [];
  const subsetApplies =
    matching.rules.has('subset') &&
    subject.tokens.length > list.tokens.length &&
    list.tokens.length >= 2;
  if (
    floor !== null &&
    shortcuts.ratioCheck &&
    !exact &&
    cannotReach([...leftSingles, ...leftJoins], [...rightSingles, ...rightJoins], {
      subject,
      list,
      pair,
      floor,
      subsetApplies,
    })
  ) {
    work.ratioExits += 1;
    return null;
  }
  work.alignments += 1;
  let best: Candidate | null = null;
  for (const leftChoice of joinChoices(leftJoins)) {
    for (const rightChoice of joinChoices(rightJoins)) {
      const left = unitsOf(leftSingles, leftChoice);
      const right = unitsOf(rightSingles, rightChoice);
      const plain = solve(left, right, subject, list, pair, C('unmatched-subject-token-weight'));
      if (best === null || plain.ratio > best.ratio) {
        best = { ...plain, subset: false };
      }
      if (subsetApplies) {
        const subset = solve(left, right, subject, list, pair, C('subset-unmatched-weight'));
        const covered = new Set(
          subset.pairs.flatMap(({ right: index }) => right[index]?.tokens ?? []),
        );
        if (covered.size === list.tokens.length && subset.ratio > best.ratio) {
          best = { ...subset, subset: true };
        }
      }
    }
  }
  if (best === null || best.pairs.length === 0) {
    return { ...NO_SCORE, exact };
  }
  const methods = new Set<NameScoreMethod>();
  let lossy = false;
  let swapped = false;
  for (const { left, right } of best.pairs) {
    const a = best.left[left];
    const b = best.right[right];
    const scored = best.scores[left]?.[right] ?? null;
    if (a === undefined || b === undefined || scored === null) {
      continue;
    }
    methods.add(scored.method);
    lossy ||= scored.lossy;
    if (a.joined || b.joined) {
      methods.add('joined');
    }
    swapped ||= (a.given && b.family) || (a.family && b.given);
  }
  if (best.subset) {
    methods.add('subset');
  }
  if (swapped) {
    methods.add('role-swap');
  }
  const score = Math.min(1, Math.max(0, best.ratio * (swapped ? C('role-swap-factor') : 1)));
  return { score, exact, methods: [...methods].sort(), lossy };
}

/**
 * C271.2 (`rescreen-bound-memo`, Workflow 11D; rescreen-6d item 9(a)): token pair scores kept across
 * the name pairs of one re-screen, so a pair of tokens many subjects' names meet (a common given
 * name against a changed entry's) is scored once, not once per subject. A single unit's pair score
 * reads only its own token's content (its forms, script, reliability, role and type; its lengths,
 * initial flag and variant groups follow from them), the other unit's, the variant groups, the
 * matching and whether the subject's name has one word, so the memo is keyed by exactly those: the
 * subject token by its content (names analysed apart hold equal tokens, not always one object) and
 * the list token by identity (a list name's tokens live as long as its analysis, and a token never
 * changes). Joined units are never kept. It also keeps each name pair's bound, the subject name by
 * its tokens' content in order (what the bound reads of it) and the list name by identity, so a
 * subject of a name another subject met is not bounded again. It holds at most `limit` token and
 * name pairs together and starts again when one would pass it (bounded memory).
 */
export interface TokenPairMemo {
  /** The token pairs it holds. */
  readonly size: number;
  /** The most it holds before it starts again. */
  readonly limit: number;
}

/** The most token pairs one memo holds before it starts again (bounded memory). */
export const TOKEN_PAIR_MEMO_LIMIT = 1_000_000;

/** A memo's pair scores under one variant groups, matching and one-word flag: subject token content, then list token. */
type TokenPairRows = Map<string, Map<NameToken, PairScore | null>>;

class TokenPairs implements TokenPairMemo {
  size = 0;
  /** Bumped each time the memo starts again, so a view looks its rows up again. */
  generation = 0;
  private tables = new WeakMap<
    VariantGroups,
    Map<ResolvedNameMatching, [TokenPairRows, TokenPairRows]>
  >();

  /** The bounds of name pairs: subject name (its tokens' content in order), then list name. */
  private bounds = new WeakMap<
    VariantGroups,
    Map<ResolvedNameMatching, Map<string, Map<AnalysedName, number>>>
  >();

  /** Each subject name's key, made once per name. */
  private readonly names = new WeakMap<AnalysedName, string>();

  constructor(readonly limit: number) {}

  /** A subject name's key: its tokens' content in order (all a bound reads of it). */
  nameKey(name: AnalysedName): string {
    let key = this.names.get(name);
    if (key === undefined) {
      key = name.tokens.map(contentKeyOf).join('\u0001');
      this.names.set(name, key);
    }
    return key;
  }

  /** The kept bounds of a subject name under the groups and the matching. */
  boundsOf(
    groups: VariantGroups,
    matching: ResolvedNameMatching,
    key: string,
  ): Map<AnalysedName, number> {
    let byMatching = this.bounds.get(groups);
    if (byMatching === undefined) {
      byMatching = new Map();
      this.bounds.set(groups, byMatching);
    }
    let byName = byMatching.get(matching);
    if (byName === undefined) {
      byName = new Map();
      byMatching.set(matching, byName);
    }
    let kept = byName.get(key);
    if (kept === undefined) {
      kept = new Map();
      byName.set(key, kept);
    }
    return kept;
  }

  rows(groups: VariantGroups, matching: ResolvedNameMatching, singleWord: boolean): TokenPairRows {
    let byMatching = this.tables.get(groups);
    if (byMatching === undefined) {
      byMatching = new Map();
      this.tables.set(groups, byMatching);
    }
    let pair = byMatching.get(matching);
    if (pair === undefined) {
      pair = [new Map(), new Map()];
      byMatching.set(matching, pair);
    }
    return pair[singleWord ? 1 : 0];
  }

  /** Makes room for one more pair: starts again (forgetting every pair) when full. */
  room(): void {
    if (this.size >= this.limit) {
      this.tables = new WeakMap();
      this.bounds = new WeakMap();
      this.size = 0;
      this.generation += 1;
    }
  }
}

/** A memo of at most `limit` token pairs (at least one). */
export function createTokenPairMemo(limit: number = TOKEN_PAIR_MEMO_LIMIT): TokenPairMemo {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('a token pair memo holds at least one pair');
  }
  return new TokenPairs(limit);
}

/** One bound's view of a memo: the rows of its groups, matching and one-word flag. */
interface MemoView {
  readonly memo: TokenPairs;
  readonly groups: VariantGroups;
  readonly context: PairContext;
  generation: number;
  rows: TokenPairRows;
}

function memoView(
  memo: TokenPairMemo | undefined,
  groups: VariantGroups,
  context: PairContext,
): MemoView | undefined {
  if (!(memo instanceof TokenPairs)) {
    return undefined;
  }
  return {
    memo,
    groups,
    context,
    generation: memo.generation,
    rows: memo.rows(groups, context.matching, context.singleWordSubject),
  };
}

/** The current rows of a view (looked up again after the memo started again). */
function rowsOf(view: MemoView): TokenPairRows {
  if (view.generation !== view.memo.generation) {
    view.generation = view.memo.generation;
    view.rows = view.memo.rows(view.groups, view.context.matching, view.context.singleWordSubject);
  }
  return view.rows;
}

/** What a single unit's pair score reads of its token, as one string. */
const contentKeyOf = (token: NameToken): string =>
  [
    token.simple,
    token.expanded,
    token.original ?? '',
    token.original === null ? '0' : '1',
    token.script ?? '',
    token.reliability,
    token.role ?? '',
    token.type,
  ].join('\u0000');

/**
 * A single-unit pair's score from the memo, scored and kept on a miss. With `token-pairs` the
 * subject unit keeps it too, as {@link scoredPair} does, so the screening that follows the bound
 * check reads it there.
 */
function memoPair(view: MemoView, a: Unit, b: Unit): PairScore | null {
  const left = a.token;
  const right = b.token;
  if (left === null || right === null) {
    return scoredPair(a, b, view.context);
  }
  let own: Map<NameToken, PairScore | null> | undefined;
  if (shortcuts.tokenPairs) {
    a.pairs ??= new Map();
    own = a.pairs.get(view.context.matching);
    if (own === undefined) {
      own = new Map();
      a.pairs.set(view.context.matching, own);
    }
    const mine = own.get(right);
    if (mine !== undefined || own.has(right)) {
      return mine ?? null;
    }
  }
  a.contentKey ??= contentKeyOf(left);
  const row = rowsOf(view).get(a.contentKey);
  const known = row?.get(right);
  if (known !== undefined || row?.has(right) === true) {
    own?.set(right, known ?? null);
    return known ?? null;
  }
  work.pairScores += 1;
  const scored = pairScore(a, b, view.context);
  own?.set(right, scored);
  view.memo.room();
  const rows = rowsOf(view);
  let kept = rows.get(a.contentKey);
  if (kept === undefined) {
    kept = new Map();
    rows.set(a.contentKey, kept);
  }
  kept.set(right, scored);
  view.memo.size += 1;
  return scored;
}

/**
 * An upper bound of {@link scoreNamePair}, cheaper than the score: every subject token that can
 * pair with anything is taken as matched at its heaviest pair, every token that can pair with
 * nothing (alone or joined) as unmatched. The screening skips the exact alignment of a pair whose
 * bound is below what it needs (C78.7); it never changes a score.
 */
export function nameScoreUpperBound(
  subject: AnalysedName,
  list: AnalysedName,
  matching: ResolvedNameMatching,
  groups: VariantGroups,
  memo?: TokenPairMemo,
): number {
  if (matching.preset === 'exact') {
    return namesExactlyEqual(subject, list) ? 1 : 0;
  }
  const pairs = memo instanceof TokenPairs ? memo : undefined;
  const key = pairs?.nameKey(subject);
  const known = key === undefined ? undefined : pairs?.boundsOf(groups, matching, key).get(list);
  if (known !== undefined) {
    return known;
  }
  const context = contextOf(subject, matching);
  const view = memoView(memo, groups, context);
  // The bound asks each single pair once, so with the memo it reads the memo directly, without a
  // name pair's matrix (which only an alignment sharing the pairing would read again).
  const bound = upperBound(
    subject,
    list,
    matching,
    groups,
    context,
    view === undefined
      ? pairingOf(context, subject.tokens.length, list.tokens.length)
      : (a, b) => memoPair(view, a, b),
  );
  if (pairs !== undefined && key !== undefined) {
    pairs.room();
    pairs.boundsOf(groups, matching, key).set(list, bound);
    pairs.size += 1;
  }
  return bound;
}

function upperBound(
  subject: AnalysedName,
  list: AnalysedName,
  matching: ResolvedNameMatching,
  groups: VariantGroups,
  context: PairContext,
  pair: Pairing,
): number {
  work.bounds += 1;
  const left = singlesOf(subject, groups);
  const right = singlesOf(list, groups);
  // The heaviest pair each subject token can be in (0: none), and the list tokens that can pair.
  const heaviest = new Array<number>(left.length).fill(0);
  const reachable = new Array<boolean>(right.length).fill(false);
  left.forEach((a, i) => {
    right.forEach((b, j) => {
      if (pair(a, b) !== null) {
        heaviest[i] = Math.max(heaviest[i] ?? 0, pairWeight(a, b));
        reachable[j] = true;
      }
    });
  });
  if (matching.rules.has('joined_tokens')) {
    const heaviestPair = C('family-name-weight');
    const leftJoins = cachedJoinsOf(subject, left, groups);
    const rightJoins = cachedJoinsOf(list, right, groups);
    for (let i = 0; i + 1 < left.length; i += 1) {
      const joined =
        leftJoins === null ? joinable(left[i], left[i + 1], groups) : (leftJoins[i] ?? null);
      right.forEach((b, j) => {
        if (joined !== null && mayPair(joined, b)) {
          heaviest[i] = Math.max(heaviest[i] ?? 0, heaviestPair);
          heaviest[i + 1] = Math.max(heaviest[i + 1] ?? 0, heaviestPair);
          reachable[j] = true;
        }
      });
    }
    for (let j = 0; j + 1 < right.length; j += 1) {
      const joined =
        rightJoins === null ? joinable(right[j], right[j + 1], groups) : (rightJoins[j] ?? null);
      left.forEach((a, i) => {
        if (joined !== null && mayPair(a, joined)) {
          heaviest[i] = Math.max(heaviest[i] ?? 0, heaviestPair);
          reachable[j] = true;
          reachable[j + 1] = true;
        }
      });
    }
  }
  const subsetApplies =
    matching.rules.has('subset') &&
    subject.tokens.length > list.tokens.length &&
    list.tokens.length >= 2;
  const subjectBase = subsetApplies
    ? Math.min(C('unmatched-subject-token-weight'), C('subset-unmatched-weight'))
    : C('unmatched-subject-token-weight');
  const subjectSuffix = subject.tokens.some((token) => token.type === 'suffix');
  const listSuffix = list.tokens.some((token) => token.type === 'suffix');
  let matched = 0;
  let forced = 0;
  left.forEach((unit, i) => {
    const weight = heaviest[i] ?? 0;
    if (weight > 0) {
      matched += weight;
    } else {
      forced += unmatchedWeight(unit, subject.tokens, subjectBase, listSuffix);
    }
  });
  right.forEach((unit, j) => {
    if (reachable[j] !== true) {
      forced += unmatchedWeight(unit, list.tokens, C('unmatched-list-token-weight'), subjectSuffix);
    }
  });
  return matched === 0 ? 0 : Math.min(1, matched / (matched + forced));
}

/** The joined unit of two adjacent units, or `null` when either never joins. */
function joinable(a: Unit | undefined, b: Unit | undefined, groups: VariantGroups): Unit | null {
  return a === undefined || b === undefined || UNJOINED.has(a.type) || UNJOINED.has(b.type)
    ? null
    : joinedUnit(a, b, groups);
}

const lengthOf = (text: string) => codePoints(text).length;

/**
 * Whether a joined unit may pair with a unit (a superset of {@link pairScore}): their Latin or
 * original forms within one character in length, or a shared variant group.
 */
function mayPair(a: Unit, b: Unit): boolean {
  if (shortcuts.unitLengths) {
    // A form is empty exactly when it has no code point.
    const close = (x: number, y: number) => x > 0 && y > 0 && Math.abs(x - y) <= 1;
    const [p, q] = [a.lengths, b.lengths];
    return (
      close(p.simple, q.simple) ||
      close(p.expanded, q.expanded) ||
      close(p.simple, q.expanded) ||
      close(p.expanded, q.simple) ||
      (a.original !== null && b.original !== null && close(p.original, q.original)) ||
      a.groups.some((group) => b.groups.includes(group))
    );
  }
  const near = (x: string, y: string) =>
    x !== '' && y !== '' && Math.abs(lengthOf(x) - lengthOf(y)) <= 1;
  return (
    near(a.simple, b.simple) ||
    near(a.expanded, b.expanded) ||
    near(a.simple, b.expanded) ||
    near(a.expanded, b.simple) ||
    (a.original !== null && b.original !== null && near(a.original, b.original)) ||
    a.groups.some((group) => b.groups.includes(group))
  );
}
