/**
 * C62.2: Passive Authentication, with integrity judged apart from revocation (H02, H15). It reads
 * the filtered trust store it is given and never fetches anything (a DSC whose distribution point
 * is a URL causes no network call, C62.7).
 *
 * - **established:** an anchor chosen by AKI→SKI (else by issuer DN, accepted only when that
 *   anchor's key verifies the DSC), not withdrawn, valid now, with the CSCA profile (`cA`,
 *   `keyCertSign`); the DSC's signature verifies, its profile holds (not a CA, `digitalSignature`,
 *   not a master list signer, no critical extension we do not understand) and it is valid now;
 *   the SOD's `contentType`, `messageDigest` and signature over the received signed-attribute
 *   bytes verify; every uploaded data group the SOD lists hashes identically; DG1's issuer
 *   agrees with the DSC's and the CSCA's country.
 * - **broken:** an anchor chosen by AKI→SKI verifies the DSC, the SOD parsed without a structural
 *   defect, and the SOD signature (or its `messageDigest`) fails, or it verifies and an uploaded
 *   data group's hash differs. Proven tampering: `failed`.
 * - **not established:** anything else, with the first gap found (C62.3: review, never
 *   `failed`). With only a DN match, a failing signature or hash is flagged, not broken.
 *
 * Revocation comes from the store's current CRLs issued under the CSCA's name (Doc 9303-12 App.
 * D.1.2): `revoked`, `unrevoked`, or `undetermined` with `crl_unavailable` or, when neither the
 * CSCA nor the DSC names a distribution point, `no_distribution_point`.
 */
import { createHash } from 'node:crypto';
import { equalBytes } from './bytes.js';
import { signerMatches } from './cms.js';
import { EmrtdError } from './errors.js';
import { importPublicKey, type PublicKeyImport } from './keys.js';
import { EMRTD_LIMITS } from './limits.js';
import { ICAO_OIDS } from './oids.js';
import { parseDg1, readSod, type SodContents } from './parse.js';
import { checkCertificateSignature, issuerKeyOf, parseCertificate, parseCrl } from './pki.js';
import { selfTest } from './self-test.js';
import { checkSignature, hashAlgorithmOf, type SignatureCheck } from './signatures.js';
import { readTlv } from './tlv.js';
import type {
  ChipFiles,
  ChosenAnchor,
  DataGroupNumber,
  DataGroupState,
  HashAlgorithm,
  IntegrityReason,
  ParsedCertificate,
  PassiveAuthenticationOptions,
  PassiveAuthenticationReport,
  Revocation,
  RevocationGap,
  SelfTestResult,
  TrustAnchor,
  TrustStore,
} from './types.js';

let cachedSelfTest: SelfTestResult | null = null;

/** The self-test, run once per process (C62.9). */
function processSelfTest(): SelfTestResult {
  cachedSelfTest ??= selfTest();
  return cachedSelfTest;
}

/** What the run found so far; a refusal mid-way keeps it. */
interface Findings {
  dataGroups: Partial<Record<DataGroupNumber, DataGroupState>>;
  hashAlgorithm: HashAlgorithm | null;
  signatureAlgorithm: string | null;
  anchor: ChosenAnchor | null;
  dsc: PassiveAuthenticationReport['dsc'];
  issuingState: string | null;
  revocation: Revocation;
  revocationGap: RevocationGap | null;
  flags: Set<string>;
  gaps: IntegrityReason[];
}

interface Candidate {
  readonly anchor: TrustAnchor;
  readonly certificate: ParsedCertificate;
}

class Deadline {
  readonly #started = performance.now();
  readonly #budgetMs: number;

  constructor(budgetMs: number) {
    this.#budgetMs = budgetMs;
  }

  check(step: string): void {
    if (performance.now() - this.#started >= this.#budgetMs) {
      throw new EmrtdError('time_budget_exceeded', step);
    }
  }
}

const STEP = 'verifyPassiveAuthentication';

const isValidAt = (certificate: ParsedCertificate, now: Date) =>
  certificate.notBefore.getTime() <= now.getTime() &&
  now.getTime() <= certificate.notAfter.getTime();

/** A data group against its signed hash: the TLV itself, or the whole upload with its padding. */
function dataGroupState(
  file: Uint8Array,
  expected: Uint8Array,
  hash: HashAlgorithm,
  flags: Set<string>,
): DataGroupState {
  const digest = (bytes: Uint8Array) => new Uint8Array(createHash(hash).update(bytes).digest());
  let end = file.length;
  try {
    end = readTlv(file).end;
  } catch (error) {
    if (!(error instanceof EmrtdError)) {
      throw error;
    }
  }
  if (equalBytes(digest(file.subarray(0, end)), expected)) {
    if (end < file.length) {
      flags.add('trailing-bytes');
    }
    return 'identical';
  }
  return end < file.length && equalBytes(digest(file), expected) ? 'identical' : 'not_identical';
}

function compareDataGroups(files: ChipFiles, sod: SodContents, findings: Findings): void {
  const hash = sod.parsed.hashAlgorithm;
  const uploaded = Object.entries(files.dataGroups).map(
    ([number]) => Number(number) as DataGroupNumber,
  );
  const numbers = [...new Set([...sod.hashes.keys(), ...uploaded])].sort((a, b) => a - b);
  for (const number of numbers) {
    const expected = sod.hashes.get(number);
    const file = files.dataGroups[number];
    if (expected === undefined) {
      findings.dataGroups[number] = 'not_listed';
    } else if (file === undefined) {
      findings.dataGroups[number] = 'missing_from_upload';
      // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
    } else if (hash !== null) {
      findings.dataGroups[number] = dataGroupState(file, expected, hash, findings.flags);
    }
  }
}

/** DG1's issuing state (MRZ line 1, positions 2-4, fillers removed), or `null` unread. */
function issuingStateOf(dg1: Uint8Array | undefined, findings: Findings): string | null {
  if (dg1 === undefined) {
    return null;
  }
  try {
    const code = (parseDg1(dg1).mrzLines[0] ?? '').slice(2, 5);
    const end = code.indexOf('<');
    return end === -1 ? code : code.slice(0, end);
  } catch (error) {
    if (!(error instanceof EmrtdError)) {
      throw error;
    }
    findings.flags.add('dg1-malformed');
    return null;
  }
}

/** The embedded DSC the signer identifier names, else one whose key verifies the SOD. */
function findDsc(
  sod: SodContents,
  acceptSha1: boolean,
  findings: Findings,
): ParsedCertificate | null {
  const certificates = sod.signedData.certificates.flatMap((der) => {
    try {
      return [parseCertificate(der)];
    } catch (error) {
      if (error instanceof EmrtdError) {
        return [];
      }
      throw error;
    }
  });
  const named = certificates.find((certificate) =>
    signerMatches(certificate, sod.signedData.signer.sid),
  );
  if (named !== undefined) {
    return named;
  }
  // BSI TR-03135 §4.8.2.2.4 "Wrong Signer Identifier": try every embedded certificate.
  const { signer } = sod.signedData;
  const verifying = certificates.find((certificate) => {
    const key = issuerKeyOf(certificate, STEP);
    return (
      key !== null &&
      signer.signedAttributes !== null &&
      checkSignature({
        algorithm: signer.signatureAlgorithm,
        digest: hashAlgorithmOf(signer.digestAlgorithm.oid),
        key,
        data: signer.signedAttributes,
        signature: signer.signature,
        acceptSha1,
      }).check === 'valid'
    );
  });
  if (verifying !== undefined) {
    findings.flags.add('signer-identifier-mismatch');
  }
  return verifying ?? null;
}

interface AnchorChoice {
  readonly chosen: Candidate | null;
  readonly matchedBy: ChosenAnchor['matchedBy'];
  readonly sawUnsupported: boolean;
}

/** C62.2: AKI→SKI first; the issuer DN only when no AKI-chosen anchor verifies the DSC. */
function chooseAnchor(
  dsc: ParsedCertificate,
  trust: TrustStore,
  options: PassiveAuthenticationOptions,
  deadline: Deadline,
): AnchorChoice {
  const parsed = new Map<TrustAnchor, ParsedCertificate | null>();
  const certificateOf = (anchor: TrustAnchor) => {
    if (!parsed.has(anchor)) {
      // A DN fallback over a large store parses many anchors: the budget bounds that too.
      deadline.check(STEP);
      try {
        parsed.set(anchor, parseCertificate(anchor.certificate));
      } catch (error) {
        if (!(error instanceof EmrtdError)) {
          throw error;
        }
        parsed.set(anchor, null);
      }
    }
    return parsed.get(anchor) ?? null;
  };
  let sawUnsupported = false;
  const verified = (anchors: readonly TrustAnchor[]): Candidate[] =>
    anchors.flatMap((anchor) => {
      deadline.check(STEP);
      const certificate = certificateOf(anchor);
      const key = certificate === null ? null : issuerKeyOf(certificate, STEP);
      if (certificate === null || key === null) {
        sawUnsupported ||= certificate !== null;
        return [];
      }
      const check = checkCertificateSignature(dsc, key, options.acceptSha1).check;
      sawUnsupported ||= check === 'unsupported';
      return check === 'valid' ? [{ anchor, certificate }] : [];
    });
  // Prefer an anchor that is current, valid now and not a link certificate.
  const best = (candidates: Candidate[]) =>
    [...candidates].sort((a, b) => score(b) - score(a))[0] ?? null;
  const score = ({ anchor, certificate }: Candidate) =>
    (anchor.withdrawn ? 0 : 4) +
    (isValidAt(certificate, options.now) ? 2 : 0) +
    (anchor.isLink ? 0 : 1);

  const byKey =
    dsc.aki === null
      ? []
      : verified(
          trust.anchors.filter((anchor) => (anchor.ski ?? certificateOf(anchor)?.ski) === dsc.aki),
        );
  if (byKey.length > 0) {
    return { chosen: best(byKey), matchedBy: 'aki', sawUnsupported };
  }
  const sameCountry = trust.anchors.filter(
    (anchor) => dsc.country === null || anchor.country.toUpperCase() === dsc.country,
  );
  const byName = verified(
    sameCountry.filter((anchor) => certificateOf(anchor)?.subjectDnKey === dsc.issuerDnKey),
  );
  return { chosen: best(byName), matchedBy: 'issuer_dn', sawUnsupported };
}

function checkProfiles(
  dsc: ParsedCertificate,
  candidate: Candidate,
  now: Date,
  findings: Findings,
): void {
  const { anchor, certificate } = candidate;
  if (anchor.withdrawn) {
    findings.gaps.push('trust_anchor_withdrawn');
  }
  if (!isValidAt(certificate, now) || !isValidAt(dsc, now)) {
    findings.gaps.push('certificate_expired');
  }
  const cscaProfile = certificate.isCa && certificate.keyUsage.includes('keyCertSign');
  const dscProfile =
    !dsc.isCa &&
    dsc.keyUsage.includes('digitalSignature') &&
    !dsc.extendedKeyUsage.includes(ICAO_OIDS.cscaMasterListSigningKey) &&
    dsc.unknownCriticalExtensions.length === 0;
  if (!cscaProfile || !dscProfile) {
    findings.gaps.push('certificate_profile_invalid');
  }
  if (dsc.issuerDnKey !== certificate.subjectDnKey) {
    findings.flags.add('issuer-dn-differs');
  }
}

type SodSignature = 'valid' | 'invalid' | 'unchecked';

/** The SOD's contentType, messageDigest and signature over the signed attributes (RFC 5652). */
function checkSodSignature(
  sod: SodContents,
  key: PublicKeyImport,
  acceptSha1: boolean,
  findings: Findings,
): { readonly signature: SodSignature; readonly structural: boolean } {
  const { signer, eContent } = sod.signedData;
  if (signer.signedAttributes === null || signer.contentType !== ICAO_OIDS.ldsSecurityObject) {
    findings.gaps.push('chip_data_malformed');
    return { signature: 'unchecked', structural: false };
  }
  const digest = hashAlgorithmOf(signer.digestAlgorithm.oid);
  const outcome = checkSignature({
    algorithm: signer.signatureAlgorithm,
    digest,
    key,
    data: signer.signedAttributes,
    signature: signer.signature,
    acceptSha1,
  });
  findings.signatureAlgorithm = outcome.algorithm?.name ?? null;
  const check: SignatureCheck =
    digest === null || (digest === 'sha1' && !acceptSha1) ? 'unsupported' : outcome.check;
  if (outcome.algorithm?.hash === 'sha1' || digest === 'sha1') {
    findings.flags.add('sha1');
  }
  if (check === 'unsupported') {
    findings.gaps.push('algorithm_unsupported');
    return { signature: 'unchecked', structural: true };
  }
  const digestMatches =
    digest !== null &&
    signer.messageDigest !== null &&
    equalBytes(new Uint8Array(createHash(digest).update(eContent).digest()), signer.messageDigest);
  return { signature: check === 'valid' && digestMatches ? 'valid' : 'invalid', structural: true };
}

function checkCountries(
  dsc: ParsedCertificate,
  anchor: TrustAnchor,
  dg1Uploaded: boolean,
  options: PassiveAuthenticationOptions,
  findings: Findings,
): void {
  const cscaCountry = anchor.country.toUpperCase();
  if (dsc.country === null || dsc.country !== cscaCountry) {
    findings.gaps.push('issuer_country_inconsistent');
    return;
  }
  if (!dg1Uploaded) {
    findings.gaps.push('input_missing');
    return;
  }
  if (findings.issuingState === null) {
    findings.gaps.push('chip_data_malformed');
    return;
  }
  const country = options.issuerCountry(findings.issuingState);
  if (country === null) {
    findings.flags.add('issuer-country-unmapped');
  }
  if (country?.toUpperCase() !== dsc.country) {
    findings.gaps.push('issuer_country_inconsistent');
  }
}

/**
 * Doc 9303-12 App. D.1.2: the store's current CRLs of the CSCA's country issued under the CSCA's
 * name (the chosen anchor's subject, else the DSC's issuer). Serial numbers are unique per issuer
 * only (RFC 5280 §4.1.2.2), so another CSCA of the country can neither revoke the DSC nor vouch
 * for it (Workflow 5C review P001); a CRL a rolled-over key signs under the same name still counts.
 */
function checkRevocation(
  dsc: ParsedCertificate,
  anchorCertificate: ParsedCertificate | null,
  country: string | null,
  trust: TrustStore,
  now: Date,
  findings: Findings,
): void {
  const issuerDnKey = anchorCertificate?.subjectDnKey ?? dsc.issuerDnKey;
  const current = trust.crls.filter(
    (crl) =>
      country !== null &&
      crl.issuerCountry.toUpperCase() === country &&
      crl.thisUpdate.getTime() <= now.getTime() &&
      crl.nextUpdate !== null &&
      now.getTime() < crl.nextUpdate.getTime(),
  );
  let usable = 0;
  for (const crl of current) {
    let revoked: readonly string[];
    try {
      const parsed = parseCrl(crl.der);
      if (parsed.issuerDnKey !== issuerDnKey) {
        continue;
      }
      revoked = parsed.revokedSerials;
    } catch (error) {
      if (!(error instanceof EmrtdError)) {
        throw error;
      }
      continue;
    }
    usable += 1;
    if (revoked.includes(dsc.serialNumber)) {
      findings.revocation = 'revoked';
      findings.revocationGap = null;
      return;
    }
  }
  if (usable > 0) {
    findings.revocation = 'unrevoked';
    findings.revocationGap = null;
    return;
  }
  const named =
    dsc.crlDistributionPoints.length > 0 ||
    (anchorCertificate !== null && anchorCertificate.crlDistributionPoints.length > 0);
  findings.revocation = 'undetermined';
  findings.revocationGap = named ? 'crl_unavailable' : 'no_distribution_point';
}

function reportOf(
  findings: Findings,
  integrity: PassiveAuthenticationReport['integrity'],
  integrityReason: IntegrityReason | null,
): PassiveAuthenticationReport {
  return {
    integrity,
    integrityReason,
    revocation: findings.revocation,
    revocationGap: findings.revocationGap,
    dataGroups: { ...findings.dataGroups },
    hashAlgorithm: findings.hashAlgorithm,
    signatureAlgorithm: findings.signatureAlgorithm,
    anchor: findings.anchor,
    dsc: findings.dsc,
    issuingState: findings.issuingState,
    flags: [...findings.flags],
  };
}

function judge(
  files: ChipFiles,
  trust: TrustStore,
  options: PassiveAuthenticationOptions,
  findings: Findings,
  deadline: Deadline,
): PassiveAuthenticationReport {
  deadline.check(STEP);
  const sod = readSod(files.sod);
  findings.hashAlgorithm = sod.parsed.hashAlgorithm;
  if (sod.parsed.version === 0) {
    findings.flags.add('sod-v0');
  }
  if (sod.trailingBytes) {
    findings.flags.add('trailing-bytes');
  }
  compareDataGroups(files, sod, findings);
  findings.issuingState = issuingStateOf(files.dataGroups[1], findings);
  if (sod.parsed.hashAlgorithm === null) {
    findings.gaps.push('algorithm_unsupported');
  } else if (sod.parsed.hashAlgorithm === 'sha1') {
    findings.flags.add('sha1');
    if (!options.acceptSha1) {
      findings.gaps.push('algorithm_unsupported');
    }
  }
  deadline.check(STEP);
  const dsc = findDsc(sod, options.acceptSha1, findings);
  if (dsc === null) {
    return reportOf(
      findings,
      'not_established',
      [...findings.gaps, 'dsc_missing' as const][0] ?? null,
    );
  }
  findings.dsc = {
    country: dsc.country,
    notBefore: dsc.notBefore,
    notAfter: dsc.notAfter,
    embedded: true,
  };
  let dscKey: PublicKeyImport | null = null;
  try {
    dscKey = importPublicKey(dsc.spki, STEP);
  } catch (error) {
    if (!(error instanceof EmrtdError)) {
      throw error;
    }
    findings.gaps.push(
      error.code === 'algorithm_unsupported' ? 'algorithm_unsupported' : 'chip_data_malformed',
    );
  }

  const choice = chooseAnchor(dsc, trust, options, deadline);
  const { chosen } = choice;
  if (chosen !== null) {
    findings.anchor = {
      id: chosen.anchor.id,
      country: chosen.anchor.country,
      matchedBy: choice.matchedBy,
      isLink: chosen.anchor.isLink,
      sandboxOnly: chosen.anchor.sandboxOnly,
    };
    if (choice.matchedBy === 'issuer_dn') {
      findings.flags.add('issuer-dn-match');
    }
    if (chosen.anchor.isLink) {
      findings.flags.add('link-anchor');
    }
  }
  checkRevocation(
    dsc,
    chosen?.certificate ?? null,
    (chosen?.anchor.country ?? dsc.country)?.toUpperCase() ?? null,
    trust,
    options.now,
    findings,
  );
  if (chosen === null) {
    findings.gaps.push(
      choice.sawUnsupported ? 'algorithm_unsupported' : 'trust_anchor_unavailable',
    );
    return reportOf(findings, 'not_established', findings.gaps[0] ?? null);
  }
  checkProfiles(dsc, chosen, options.now, findings);
  deadline.check(STEP);
  const sodCheck =
    dscKey === null
      ? { signature: 'unchecked' as const, structural: true }
      : checkSodSignature(sod, dscKey, options.acceptSha1, findings);
  checkCountries(dsc, chosen.anchor, files.dataGroups[1] !== undefined, options, findings);
  deadline.check(STEP);

  const hashMismatch = Object.values(findings.dataGroups).includes('not_identical');
  const signatureFails = sodCheck.signature === 'invalid';
  const tampered = signatureFails || (sodCheck.signature === 'valid' && hashMismatch);
  if (tampered && choice.matchedBy === 'aki' && sodCheck.structural) {
    return reportOf(
      findings,
      'broken',
      signatureFails ? 'sod_signature_invalid' : 'dg_hash_mismatch',
    );
  }
  if (tampered) {
    // A DN-only anchor proves no tampering (H02): review, with what failed flagged.
    findings.flags.add(signatureFails ? 'sod-signature-invalid' : 'dg-hash-mismatch');
    return reportOf(findings, 'not_established', findings.gaps[0] ?? 'trust_anchor_unavailable');
  }
  const [gap] = findings.gaps;
  if (gap !== undefined) {
    return reportOf(findings, 'not_established', gap);
  }
  return sodCheck.signature === 'valid'
    ? reportOf(findings, 'established', null)
    : reportOf(findings, 'not_established', 'chip_data_malformed');
}

export function verifyPassiveAuthentication(
  files: ChipFiles,
  trust: TrustStore,
  options: PassiveAuthenticationOptions,
): PassiveAuthenticationReport {
  const findings: Findings = {
    dataGroups: {},
    hashAlgorithm: null,
    signatureAlgorithm: null,
    anchor: null,
    dsc: null,
    issuingState: null,
    revocation: 'undetermined',
    revocationGap: 'crl_unavailable',
    flags: new Set(),
    gaps: [],
  };
  let report: PassiveAuthenticationReport;
  try {
    report = judge(
      files,
      trust,
      options,
      findings,
      new Deadline(options.timeBudgetMs ?? EMRTD_LIMITS.verificationTimeBudgetMs),
    );
  } catch (error) {
    if (!(error instanceof EmrtdError)) {
      throw error;
    }
    if (error.code === 'time_budget_exceeded') {
      findings.flags.add('time-budget-exceeded');
    }
    report = reportOf(
      findings,
      'not_established',
      error.code === 'algorithm_unsupported' ? 'algorithm_unsupported' : 'chip_data_malformed',
    );
  }
  if (!(options.selfTest ?? processSelfTest()).ok) {
    findings.flags.add('self-test-failed');
    return {
      ...report,
      integrity: 'not_established',
      integrityReason: 'algorithm_unsupported',
      flags: [...findings.flags],
    };
  }
  return report;
}
