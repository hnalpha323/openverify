/**
 * `id_nfc_repeat_detection` (R, fraud, ours, C62.6, decision 35, V01): earlier selfie-bound reads
 * of this chip's signed SOD in other accounts' unredacted inquiries (the worker's blind-index
 * lookup). A sighting is review-level (`not_applicable`/`chip_seen_on_other_account`) unless the
 * template sets `sighting-outcome: fail`: one person on two accounts is an operator policy, and
 * the selfie binding, not this check, stops a different person. Evaluated only with integrity
 * established; metadata counts the sightings.
 */
import type { CheckResult } from '@openverify/core';
import { phase5CheckConfig, phase5ResultOptions } from '../contact/phase5-config.js';
import { checkResult } from '../result.js';
import type { NfcContext } from './context.js';
import { INTEGRITY_NOT_ESTABLISHED } from './integrity.js';

const CHECK_ID = 'id_nfc_repeat_detection';
const SIGHTING = 'chip_seen_on_other_account';

export function idNfcRepeatDetection(context: NfcContext): CheckResult {
  const config = phase5CheckConfig(context.template, CHECK_ID);
  const options = phase5ResultOptions(config, ['sighting-outcome']);
  if (context.input.passiveAuthentication?.integrity !== 'established') {
    return checkResult(CHECK_ID, 'not_applicable', [INTEGRITY_NOT_ESTABLISHED], {}, options);
  }
  const { sightings } = context.input;
  if (sightings === null) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], {}, options);
  }
  const metadata = { sightings };
  if (sightings === 0) {
    return checkResult(CHECK_ID, 'passed', [], metadata, options);
  }
  return config.values['sighting-outcome'] === 'fail'
    ? checkResult(CHECK_ID, 'failed', [SIGHTING], metadata, options)
    : checkResult(CHECK_ID, 'not_applicable', [SIGHTING], metadata, options);
}
