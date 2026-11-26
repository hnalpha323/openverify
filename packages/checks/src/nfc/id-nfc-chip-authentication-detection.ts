/**
 * `id_nfc_chip_authentication_detection` (R, fraud, C62.6): Active Authentication over this
 * challenge's nonce with the DG15 key, as `verifyActiveAuthentication` answered.
 * - verified: passed; a well-formed response that does not verify: `active_authentication_failed`;
 * - unreadable: `chip_data_malformed`; the SOD lists DG15 but the key or response is missing:
 *   `active_authentication_withheld` (review: a genuine read can lose it, H16);
 * - the verified SOD lists no DG15 (the chip has no AA key): `chip_auth_not_server_verifiable`
 *   (non-blocking, decision 33), or `active_authentication_unavailable` (review) with
 *   `require-active-authentication`;
 * - integrity not established: `integrity_not_established`.
 * Chip Authentication and PACE-CAM transcripts are not transferable: a device's claim stays in
 * metadata as `device-reported`, from a closed list of protocol names, never evidence.
 */
import type { CheckResult } from '@openverify/core';
import { booleanIn, phase5CheckConfig, phase5ResultOptions } from '../contact/phase5-config.js';
import { checkResult } from '../result.js';
import type { NfcContext } from './context.js';
import { DEVICE_REPORTED_PROTOCOLS } from './inputs.js';
import { INTEGRITY_NOT_ESTABLISHED } from './integrity.js';

const CHECK_ID = 'id_nfc_chip_authentication_detection';
const KNOWN_PROTOCOLS: ReadonlySet<string> = new Set(DEVICE_REPORTED_PROTOCOLS);

export function idNfcChipAuthenticationDetection(context: NfcContext): CheckResult {
  const config = phase5CheckConfig(context.template, CHECK_ID);
  const options = phase5ResultOptions(config, ['require-active-authentication']);
  const report = context.input.activeAuthentication;
  if (report === null) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], {}, options);
  }
  const claimed = [...new Set(context.input.deviceReportedProtocols ?? [])].filter((protocol) =>
    KNOWN_PROTOCOLS.has(protocol),
  );
  const metadata = {
    outcome: report.outcome,
    ...(report.scheme === null ? {} : { scheme: report.scheme }),
    ...(report.hashAlgorithm === null ? {} : { 'hash-algorithm': report.hashAlgorithm }),
    ...(claimed.length === 0 ? {} : { 'device-reported': claimed }),
  };
  const answer = (status: 'passed' | 'failed' | 'not_applicable', reasons: string[] = []) =>
    checkResult(CHECK_ID, status, reasons, metadata, options);
  switch (report.outcome) {
    case 'verified':
      return answer('passed');
    case 'failed':
      return answer('failed', ['active_authentication_failed']);
    case 'malformed':
      return answer('not_applicable', ['chip_data_malformed']);
    case 'withheld':
      return answer('not_applicable', ['active_authentication_withheld']);
    case 'not_listed':
      return answer('not_applicable', [
        booleanIn(config, 'require-active-authentication', false)
          ? 'active_authentication_unavailable'
          : 'chip_auth_not_server_verifiable',
      ]);
    case 'untrusted_key':
      return answer('not_applicable', [INTEGRITY_NOT_ESTABLISHED]);
  }
}
