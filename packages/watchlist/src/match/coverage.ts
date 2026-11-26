/**
 * C78.5 (H05, H12): how completely a run compared the subject's names. Per subject name and per
 * source: `same_script` (Latin, or the source carries the name's script), `transliterated`
 * (Cyrillic through ICAO 9303 §6.B), `lossy` (another script through a lossy form) or
 * `not_compared` (no key at all). The report's `coverage` serves `complete` and `limits` from a
 * closed set (`lossy_script`, `not_compared`, `truncated`, `unclassified_format`), never names or
 * scripts; the per-name detail is for the sealed result.
 */
import { REPORT_COVERAGE_LIMITS, type ReportCoverageLimit } from '@openverify/core';
import type { AnalysedName } from '../names/index.js';
import type { TokenScript } from '../translit/index.js';

export type NameComparison = 'same_script' | 'transliterated' | 'lossy' | 'not_compared';

export interface CoverageInput {
  readonly sourceIds: readonly string[];
  /**
   * The scripts each source's names carry (`watchlist_names.script`); a source missing here is
   * taken to carry Latin only, which can only flag more.
   */
  readonly sourceScripts?: ReadonlyMap<string, ReadonlySet<TokenScript>> | undefined;
  /** Retrieval reached its cap, or a provider filled its record cap. */
  readonly truncated: boolean;
  /** The crypto query's format is unclassified (C79.3). */
  readonly unclassifiedFormat?: boolean | undefined;
}

export interface ScreeningCoverage {
  readonly complete: boolean;
  readonly limits: readonly ReportCoverageLimit[];
  /** Per subject name, in the subject's order: each source's comparison (sealed detail). */
  readonly names: readonly Readonly<Record<string, NameComparison>>[];
  readonly truncated: boolean;
}

/** The coverage of one run. */
export function screeningCoverage(
  names: readonly AnalysedName[],
  input: CoverageInput,
): ScreeningCoverage {
  const perName = names.map((name) =>
    Object.fromEntries(
      input.sourceIds.map((sourceId) => [
        sourceId,
        nameComparison(name, input.sourceScripts?.get(sourceId)),
      ]),
    ),
  );
  const seen = new Set(perName.flatMap((comparisons) => Object.values(comparisons)));
  const found = new Set<ReportCoverageLimit>();
  if (seen.has('lossy')) {
    found.add('lossy_script');
  }
  if (seen.has('not_compared')) {
    found.add('not_compared');
  }
  if (input.truncated) {
    found.add('truncated');
  }
  if (input.unclassifiedFormat === true) {
    found.add('unclassified_format');
  }
  const limits = REPORT_COVERAGE_LIMITS.filter((limit) => found.has(limit));
  return { complete: limits.length === 0, limits, names: perName, truncated: input.truncated };
}

const RANK: readonly NameComparison[] = ['same_script', 'transliterated', 'lossy', 'not_compared'];

/** One name against one source: the worst comparison of its tokens. */
function nameComparison(
  name: AnalysedName,
  scripts: ReadonlySet<TokenScript> | undefined,
): NameComparison {
  let worst = 0;
  for (const token of name.tokens) {
    if (token.script === null || token.script === 'latin' || scripts?.has(token.script) === true) {
      continue;
    }
    const comparison: NameComparison =
      token.reliability === 'icao'
        ? 'transliterated'
        : token.reliability === 'none'
          ? 'not_compared'
          : 'lossy';
    worst = Math.max(worst, RANK.indexOf(comparison));
  }
  return RANK[worst] ?? 'not_compared';
}
