/**
 * `id_nfc_expired_detection` (R, fraud, C29.5, C62.6) on the chip: DG1's expiry (`YYMMDD`, read
 * at most 50 years ahead) past `grace-days` fails `expired`; within them it passes with
 * `expired_within_grace_period`; a date that is no calendar date fails
 * `expiration_date_invalid`; an unknown or unreadable one is `input_missing`. Judged on DG1's
 * integrity (C62.4): an expired document fails even unverified; a current one is evidence only
 * with integrity established.
 */
import type { CheckResult } from '@openverify/core';
import { phase5CheckConfig, phase5ResultOptions } from '../contact/phase5-config.js';
import { idNfcExpiredDetection } from '../id-nfc-expired-detection.js';
import { MrzParseError, parseMrz } from '../mrz.js';
import { checkResult } from '../result.js';
import type { NfcContext } from './context.js';
import { mrzDateToIso } from './dates.js';
import { dataGroupIntegrity, onIntegrity } from './integrity.js';

const CHECK_ID = 'id_nfc_expired_detection';

/** DG1's expiry in full, or `null` when DG1 is absent, unreadable or leaves it unknown. */
function expiryOf(context: NfcContext): string | null {
  const { dg1 } = context.input;
  if (dg1 === null) {
    return null;
  }
  try {
    return mrzDateToIso(parseMrz(dg1.mrzLines).expirationDate, 'expiry', context.now);
  } catch (error) {
    if (error instanceof MrzParseError) {
      return null;
    }
    throw error;
  }
}

export function nfcExpiredDetection(context: NfcContext): CheckResult {
  const config = phase5CheckConfig(context.template, CHECK_ID);
  const graceDays =
    typeof config.values['grace-days'] === 'number' ? config.values['grace-days'] : 0;
  const options = phase5ResultOptions(config, ['grace-days']);
  const integrity = dataGroupIntegrity(context.input.passiveAuthentication, 1);
  const judged = idNfcExpiredDetection(
    { expirationDate: expiryOf(context) },
    { graceDays, now: context.now },
  );
  const verdict = onIntegrity(integrity, judged);
  const metadata =
    verdict.status === judged.status ? { ...judged.metadata, integrity } : { integrity };
  return checkResult(CHECK_ID, verdict.status, verdict.reasons, metadata, options);
}
