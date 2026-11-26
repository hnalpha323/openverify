/**
 * C61.1: which of a register's search results is the business entered. A search answers several
 * records; the one kept is the closest by name (C58.6 `matchBusinessNames`, over every name it
 * holds), and a name search keeps none whose names do not reach `partial`, so a register never
 * answers a different business for a vague name. Ties keep the register's order.
 */
import { matchBusinessNames, type MatchLevel } from '@openverify/checks';

const RANK: Readonly<Record<MatchLevel, number>> = { full: 3, partial: 2, none: 1, missing: 0 };

/** The closest candidate by name, with its level; `null` when there is no candidate. */
export function closestByName<Candidate>(
  businessName: string,
  candidates: readonly Candidate[],
  namesOf: (candidate: Candidate) => readonly string[],
): { candidate: Candidate; level: MatchLevel } | null {
  let best: { candidate: Candidate; level: MatchLevel } | null = null;
  for (const candidate of candidates) {
    for (const name of namesOf(candidate)) {
      const { level } = matchBusinessNames(businessName, name);
      if (best === null || RANK[level] > RANK[best.level]) {
        best = { candidate, level };
      }
    }
  }
  return best;
}

/** Whether a name search may keep a candidate of `level` (C61.1). */
export const nameSearchKeeps = (level: MatchLevel): boolean =>
  level === 'full' || level === 'partial';
