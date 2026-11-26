/**
 * Name normalization and fuzzy similarity, shared by the comparison checks
 * (inquiry, account, database, document) and later by watchlist matching.
 * All scores are in [0, 1]; callers choose their own thresholds.
 */

/** Letters that Unicode decomposition does not reduce to a base letter. */
const SPECIAL_LETTERS: Readonly<Record<string, string>> = {
  ß: 'ss',
  æ: 'ae',
  ø: 'o',
  œ: 'oe',
  þ: 'th',
  ð: 'd',
  đ: 'd',
  ł: 'l',
  ı: 'i',
  ħ: 'h',
};

/**
 * Lowercases, strips diacritics, transliterates letters such as ß and æ,
 * drops apostrophes (O'Brien -> obrien), turns other punctuation into spaces
 * and collapses whitespace. Non-Latin scripts are kept (lowercased).
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[ßæøœþðđłıħ]/g, (letter) => SPECIAL_LETTERS[letter] ?? letter)
    .replace(/['’‘`´ʼ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function nameTokens(name: string): string[] {
  const normalized = normalizeName(name);
  return normalized === '' ? [] : normalized.split(' ');
}

/** Jaro similarity over Unicode code points. */
export function jaroSimilarity(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);
  if (left.length === 0 && right.length === 0) {
    return 1;
  }
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const window = Math.max(0, Math.floor(Math.max(left.length, right.length) / 2) - 1);
  const leftMatched = new Array<boolean>(left.length).fill(false);
  const rightMatched = new Array<boolean>(right.length).fill(false);
  let matches = 0;

  for (let i = 0; i < left.length; i += 1) {
    const start = Math.max(0, i - window);
    const end = Math.min(right.length - 1, i + window);
    for (let j = start; j <= end; j += 1) {
      if (!rightMatched[j] && left[i] === right[j]) {
        leftMatched[i] = true;
        rightMatched[j] = true;
        matches += 1;
        break;
      }
    }
  }
  if (matches === 0) {
    return 0;
  }

  let halfTranspositions = 0;
  let k = 0;
  for (let i = 0; i < left.length; i += 1) {
    if (leftMatched[i]) {
      while (!rightMatched[k]) {
        k += 1;
      }
      if (left[i] !== right[k]) {
        halfTranspositions += 1;
      }
      k += 1;
    }
  }
  const transpositions = halfTranspositions / 2;

  return (
    (matches / left.length + matches / right.length + (matches - transpositions) / matches) / 3
  );
}

export interface JaroWinklerOptions {
  /** Weight of the shared prefix (at most four characters); 0 to 0.25, default 0.1. */
  prefixScale?: number;
  /** The prefix bonus applies only above this Jaro score (Winkler's original rule); default 0.7. */
  boostThreshold?: number;
}

/**
 * Jaro-Winkler similarity: Jaro boosted by a shared prefix of up to four code
 * points, once the Jaro score exceeds the boost threshold.
 */
export function jaroWinkler(a: string, b: string, options: JaroWinklerOptions = {}): number {
  const { prefixScale = 0.1, boostThreshold = 0.7 } = options;
  if (prefixScale < 0 || prefixScale > 0.25) {
    throw new RangeError('prefixScale must be between 0 and 0.25');
  }
  const jaro = jaroSimilarity(a, b);
  if (jaro <= boostThreshold) {
    return jaro;
  }
  const left = Array.from(a);
  const right = Array.from(b);
  let prefix = 0;
  while (prefix < 4 && prefix < left.length && left[prefix] === right[prefix]) {
    prefix += 1;
  }
  return jaro + prefix * prefixScale * (1 - jaro);
}

function sortedTokens(tokens: Iterable<string>): string {
  return [...tokens].sort().join(' ');
}

/**
 * Token-set similarity: compares the shared tokens with each side's full token
 * set and keeps the best Jaro-Winkler score. Word order and duplicates do not
 * matter, and one name whose tokens are a subset of the other scores 1
 * (e.g. a missing middle name), so callers should not rely on it alone.
 */
export function tokenSetSimilarity(a: string, b: string): number {
  const left = new Set(nameTokens(a));
  const right = new Set(nameTokens(b));
  if (left.size === 0 && right.size === 0) {
    return 1;
  }
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  const shared = sortedTokens([...left].filter((token) => right.has(token)));
  const join = (onlyIn: Set<string>, other: Set<string>): string =>
    [shared, sortedTokens([...onlyIn].filter((token) => !other.has(token)))]
      .filter(Boolean)
      .join(' ');
  const withLeft = join(left, right);
  const withRight = join(right, left);
  return Math.max(
    shared === '' ? 0 : jaroWinkler(shared, withLeft),
    shared === '' ? 0 : jaroWinkler(shared, withRight),
    jaroWinkler(withLeft, withRight),
  );
}

export interface NameComparison {
  normalizedA: string;
  normalizedB: string;
  /** Equal after normalization. */
  exact: boolean;
  /** Jaro-Winkler of the normalized names. */
  jaroWinkler: number;
  /** Jaro-Winkler with tokens sorted, so word order does not matter. */
  tokenSortJaroWinkler: number;
  /** Token-set similarity; 1 when one name's tokens are a subset of the other's. */
  tokenSet: number;
  /** Order-insensitive similarity: the larger of the two Jaro-Winkler scores. */
  score: number;
}

export function compareNames(a: string, b: string): NameComparison {
  const normalizedA = normalizeName(a);
  const normalizedB = normalizeName(b);
  const plain = jaroWinkler(normalizedA, normalizedB);
  const tokenSort = jaroWinkler(sortedTokens(nameTokens(a)), sortedTokens(nameTokens(b)));
  return {
    normalizedA,
    normalizedB,
    exact: normalizedA === normalizedB,
    jaroWinkler: plain,
    tokenSortJaroWinkler: tokenSort,
    tokenSet: tokenSetSimilarity(a, b),
    score: Math.max(plain, tokenSort),
  };
}
