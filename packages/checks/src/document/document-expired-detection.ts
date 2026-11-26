/**
 * `document_expired_detection` (R, user behaviour, required; C60.6, H08): the document's own expiry,
 * by the feature table. A lease whose end date is before today minus `grace-days` fails
 * `document_expired`; a lease that prints no end (a periodic tenancy) and every class without an
 * expiry answer `feature_absent` (non-blocking); two end dates, or readings that disagree,
 * answer `input_missing`.
 */
import type { CheckResult } from '@openverify/core';
import { phase5CheckConfig, phase5ResultOptions } from '../contact/phase5-config.js';
import { daysBetween, parseIsoDate, utcToday } from '../dates.js';
import { checkResult } from '../result.js';
import type { DocumentContext } from './context.js';
import { DOCUMENT_FEATURE_TABLE } from './feature-table.js';

const ID = 'document_expired_detection';

export function documentExpiredDetection(context: DocumentContext): CheckResult {
  const config = phase5CheckConfig(context.template, ID);
  const options = phase5ResultOptions(config, ['grace-days']);
  const { established, extraction } = context;
  if (established === null || extraction === null) {
    return checkResult(ID, 'not_applicable', ['input_missing'], {}, options);
  }
  const metadata = { 'document-class': established };
  if (DOCUMENT_FEATURE_TABLE[established].expiry === 'none') {
    return checkResult(ID, 'not_applicable', ['feature_absent'], metadata, options);
  }
  if (extraction.expiryConflict) {
    return checkResult(
      ID,
      'not_applicable',
      ['input_missing'],
      { ...metadata, flags: ['expiry-conflict'] },
      options,
    );
  }
  if (extraction.expiry === null) {
    // A lease that prints no end is a periodic tenancy (C60.6, V20).
    return checkResult(
      ID,
      'not_applicable',
      ['feature_absent'],
      { ...metadata, flags: ['periodic-tenancy'] },
      options,
    );
  }
  const grace = config.values['grace-days'];
  const today = utcToday(context.now);
  const outcomes = new Set(
    extraction.expiry.readings.map((reading) => {
      const end = parseIsoDate(reading);
      return end !== null && daysBetween(end, today) > (typeof grace === 'number' ? grace : 0)
        ? 'expired'
        : 'valid';
    }),
  );
  if (outcomes.size > 1) {
    return checkResult(
      ID,
      'not_applicable',
      ['input_missing'],
      { ...metadata, flags: ['ambiguous-date'] },
      options,
    );
  }
  return outcomes.has('expired')
    ? checkResult(ID, 'failed', ['document_expired'], metadata, options)
    : checkResult(ID, 'passed', [], metadata, options);
}
