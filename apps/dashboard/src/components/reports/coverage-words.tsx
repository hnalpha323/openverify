/**
 * A report's or a run's coverage in words (C86; K20, Phase 6 owner decision 6): "Complete" for a
 * name screening always beside what complete coverage does not promise, "Limited" with each limit,
 * and nothing for a type that compares no names.
 */
import type { ReportCoverageLimit, ReportType } from '@openverify/core';
import { coverageText } from '../../lib/report-result';
import { COMPLETE_COVERAGE_WORDS, NAME_SCREENING_TYPES } from '../../lib/report-words';
import { EmptyValue } from '../masked-value';

export interface CoverageWordsProps {
  readonly coverage: {
    readonly complete: boolean;
    readonly limits: readonly ReportCoverageLimit[];
  } | null;
  readonly type: ReportType;
}

export function CoverageWords({ coverage, type }: CoverageWordsProps) {
  const text = coverageText(coverage);
  if (text === null) {
    return <EmptyValue />;
  }
  const complete = coverage?.complete === true && coverage.limits.length === 0;
  return (
    <>
      {text}
      {complete && NAME_SCREENING_TYPES.has(type) && (
        <span className="mt-1 block text-xs text-ink-muted">{COMPLETE_COVERAGE_WORDS}</span>
      )}
    </>
  );
}
