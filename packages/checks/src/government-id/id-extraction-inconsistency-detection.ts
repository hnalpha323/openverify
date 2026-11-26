/**
 * `id_extraction_inconsistency_detection` (R, fraud): every pair of sources present (MRZ,
 * barcode, visual zone, and the chip from Phase 5) agrees on the fields both read, under the C31.2
 * rules. A field two sources read differently fails the check (`extraction_inconsistent`, the
 * fields named in `disagreeing-fields`). Agreement needs two sources sharing at least two fields
 * (C31.4); otherwise the check answers `input_missing`.
 *
 * Phase 12A (C3): the metadata names how the visual zone read each field it compares with another
 * source (`viz-via`: `label`, `pattern` or `layout`), so a disagreement on a field read by its
 * place on the layout can be weighed below one read after its label. The verdict does not change.
 */
import { EXTRACTION_SOURCES, type CheckResult, type ExtractionSource } from '@openverify/core';
import { fieldsReadByBoth } from '../extraction/consolidate.js';
import { checkResult } from '../result.js';
import type { GovernmentIdContext } from './context.js';

const CHECK_ID = 'id_extraction_inconsistency_detection';
const MIN_COMMON_FIELDS = 2;

export function idExtractionInconsistencyDetection(context: GovernmentIdContext): CheckResult {
  const { consolidated } = context.extraction;
  const read = new Set(Object.values(consolidated.details).flatMap((detail) => [...detail.readBy]));
  const sources = EXTRACTION_SOURCES.filter((source) => read.has(source));
  const pairs: [ExtractionSource, ExtractionSource][] = [];
  sources.forEach((left, index) => {
    for (const right of sources.slice(index + 1)) {
      pairs.push([left, right]);
    }
  });
  const common = Math.max(0, ...pairs.map(([a, b]) => fieldsReadByBoth(consolidated, a, b).length));
  const readings = context.extraction.sources.viz?.readings ?? {};
  const vizVia = Object.fromEntries(
    Object.entries(consolidated.details).flatMap(([field, detail]) => {
      const via = readings[field as keyof typeof readings]?.via;
      return via !== undefined && detail.readBy.includes('viz') && detail.readBy.length > 1
        ? [[field, via]]
        : [];
    }),
  );
  const metadata = {
    sources,
    'compared-pairs': pairs.map(([a, b]) => `${a}-${b}`),
    'common-fields': common,
    'disagreeing-fields': consolidated.disagreeingFields,
    ...(Object.keys(vizVia).length > 0 ? { 'viz-via': vizVia } : {}),
  };
  if (consolidated.disagreeingFields.length > 0) {
    return checkResult(CHECK_ID, 'failed', ['extraction_inconsistent'], metadata);
  }
  return common < MIN_COMMON_FIELDS
    ? checkResult(CHECK_ID, 'not_applicable', ['input_missing'], metadata)
    : checkResult(CHECK_ID, 'passed', [], metadata);
}
