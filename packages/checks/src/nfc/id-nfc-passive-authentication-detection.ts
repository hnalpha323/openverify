/**
 * `id_nfc_passive_authentication_detection` (R, fraud, C62.3): the `@openverify/emrtd` report
 * judged.
 * - a Utopia (`UTO`) chip in a production environment fails `specimen_issuer`, before anything
 *   else (V04: only sandbox environments trust the synthetic anchor);
 * - broken integrity fails with its reason (`sod_signature_invalid`, `dg_hash_mismatch`), proven
 *   tampering; a DSC an anchor verified that a current CRL lists fails `dsc_revoked`;
 * - integrity not established is review with its reason, never `failed` (a trust-store gap or an
 *   issuer defect is ours to resolve, ADR 0002);
 * - established and unrevoked passes; undetermined revocation is review (`crl_unavailable`, the
 *   report's gap in metadata) under `strict`, and passes, flagged, under `best-effort`.
 *
 * Metadata holds the integrity and revocation states, the algorithms, how the anchor was chosen
 * and each data group's state: measurements, never chip data.
 */
import type { CheckResult } from '@openverify/core';
import type { PassiveAuthenticationReport } from '@openverify/emrtd';
import { phase5CheckConfig, phase5ResultOptions } from '../contact/phase5-config.js';
import { SANDBOX_TEST_ISSUER } from '../data/feature-table.js';
import { checkResult } from '../result.js';
import type { NfcContext } from './context.js';

const CHECK_ID = 'id_nfc_passive_authentication_detection';
const UTOPIA_COUNTRY = 'UT';

function metadataOf(
  report: PassiveAuthenticationReport,
  extraFlags: readonly string[],
): Record<string, unknown> {
  return {
    integrity: report.integrity,
    ...(report.integrityReason === null ? {} : { 'integrity-reason': report.integrityReason }),
    revocation: report.revocation,
    ...(report.revocationGap === null ? {} : { 'revocation-gap': report.revocationGap }),
    'hash-algorithm': report.hashAlgorithm,
    'signature-algorithm': report.signatureAlgorithm,
    ...(report.anchor === null
      ? {}
      : {
          'anchor-matched-by': report.anchor.matchedBy,
          'anchor-link': report.anchor.isLink,
          'anchor-sandbox-only': report.anchor.sandboxOnly,
        }),
    'data-groups': Object.fromEntries(
      Object.entries(report.dataGroups).map(([group, state]) => [`dg${group}`, state]),
    ),
    flags: [...report.flags, ...extraFlags],
  };
}

/** C62.3, V04: the specimen state's chip, by DG1's issuer or the certificates' country. */
function isSpecimen(context: NfcContext, report: PassiveAuthenticationReport): boolean {
  const printed = context.input.dg1?.mrzLines[0]?.slice(2, 5);
  return (
    report.issuingState === SANDBOX_TEST_ISSUER ||
    printed === SANDBOX_TEST_ISSUER ||
    report.dsc?.country === UTOPIA_COUNTRY ||
    report.anchor?.country === UTOPIA_COUNTRY
  );
}

export function idNfcPassiveAuthenticationDetection(context: NfcContext): CheckResult {
  const config = phase5CheckConfig(context.template, CHECK_ID);
  const options = phase5ResultOptions(config, ['revocation', 'accept-sha1']);
  const report = context.input.passiveAuthentication;
  if (report === null) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], {}, options);
  }
  const metadata = metadataOf(report, []);
  if (context.input.environment === 'production' && isSpecimen(context, report)) {
    return checkResult(CHECK_ID, 'failed', ['specimen_issuer'], metadata, options);
  }
  const revoked = report.revocation === 'revoked' && report.anchor !== null;
  if (report.integrity === 'broken') {
    const reasons = [
      report.integrityReason ?? 'sod_signature_invalid',
      ...(revoked ? ['dsc_revoked'] : []),
    ];
    return checkResult(CHECK_ID, 'failed', reasons, metadata, options);
  }
  if (revoked) {
    return checkResult(CHECK_ID, 'failed', ['dsc_revoked'], metadata, options);
  }
  if (report.integrity === 'not_established') {
    return checkResult(
      CHECK_ID,
      'not_applicable',
      [report.integrityReason ?? 'chip_data_malformed'],
      metadata,
      options,
    );
  }
  if (report.revocation === 'unrevoked') {
    return checkResult(CHECK_ID, 'passed', [], metadata, options);
  }
  return config.values.revocation === 'best-effort'
    ? checkResult(CHECK_ID, 'passed', [], metadataOf(report, ['revocation-undetermined']), options)
    : checkResult(CHECK_ID, 'not_applicable', ['crl_unavailable'], metadata, options);
}
