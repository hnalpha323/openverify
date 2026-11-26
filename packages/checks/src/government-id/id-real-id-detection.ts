/**
 * `id_real_id_detection` (R, fraud): whether a US driver licence or ID card is REAL ID compliant,
 * from the AAMVA `DDA` element (`F` compliant, `N` not) and the star the front shows (the C32.1
 * `star_glyph` template match, at least `min-star-glyph-score`).
 * - `DDA F` with the star, or with the front unmeasured: `passed`. `DDA F` without the star, or
 *   `DDA N` with it: `real_id_marker_inconsistent`. `DDA N` without it: `real_id_not_compliant`.
 * - Without `DDA`, the star decides; with the front unmeasured too, `input_missing`.
 * - REAL ID exists only for US AAMVA cards: any other established class with a feature row is
 *   `feature_absent`; a class without a row is `input_missing`.
 */
import type { CheckResult } from '@openverify/core';
import { checkResult } from '../result.js';
import { checkConfigOf, type GovernmentIdContext } from './context.js';
import { numberOf, thresholdsOf } from './values.js';

const CHECK_ID = 'id_real_id_detection';

export function idRealIdDetection(context: GovernmentIdContext): CheckResult {
  const config = checkConfigOf(context, CHECK_ID);
  const thresholds = thresholdsOf(config, ['min-star-glyph-score']);
  const result = (
    status: 'passed' | 'failed' | 'not_applicable',
    reasons: string[],
    metadata: Record<string, unknown> = {},
  ) => checkResult(CHECK_ID, status, reasons, metadata, { thresholds });
  const { features, extraction } = context;
  const usCard = features?.row === 'aamva-card' && extraction.document.issuer?.country === 'US';
  if (!usCard) {
    return result('not_applicable', [features === null ? 'input_missing' : 'feature_absent']);
  }
  const dda = extraction.sources.barcode?.parsed.realIdCompliance ?? null;
  const compliance = dda === 'F' || dda === 'N' ? dda : null;
  const star = context.input.analysis.sides.front.forensics?.star_glyph ?? null;
  const minScore = numberOf(config, 'min-star-glyph-score') ?? 0;
  const starFound = star === null ? null : star.found && star.score >= minScore;
  const metadata = {
    'real-id-compliance': compliance,
    'star-glyph-found': starFound,
    'star-glyph-score': star?.score ?? null,
  };
  if (compliance === 'F') {
    return starFound === false
      ? result('failed', ['real_id_marker_inconsistent'], metadata)
      : result('passed', [], metadata);
  }
  if (compliance === 'N') {
    return result(
      'failed',
      [starFound === true ? 'real_id_marker_inconsistent' : 'real_id_not_compliant'],
      metadata,
    );
  }
  if (starFound === null) {
    return result('not_applicable', ['input_missing'], metadata);
  }
  return starFound
    ? result('passed', [], metadata)
    : result('failed', ['real_id_not_compliant'], metadata);
}
