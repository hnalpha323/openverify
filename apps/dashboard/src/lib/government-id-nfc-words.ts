/**
 * The chip evidence vocabulary in words (C62, C66): passive authentication's integrity and
 * revocation, the data-group states against the signed security object, Active Authentication,
 * the protocols a device may claim, how the anchor was chosen, passive authentication's flags,
 * the MRZ fields compared, what a pass means, and the notes on the device report and the sandbox
 * anchor.
 *
 * The test (`government-id-nfc-words.test.ts`) reads the states, outcomes, schemes, protocols,
 * flags and fields from the verifier's own source (`packages/emrtd`, `packages/checks/src/nfc`),
 * so a value added there without words here fails it. A value the console does not know yet is
 * shown as its code.
 */
import type { CHIP_INTEGRITY_OUTCOMES, CHIP_REVOCATION_OUTCOMES } from '@openverify/contracts';
import type { ReasonText } from './check-reasons';

export type ChipIntegrity = (typeof CHIP_INTEGRITY_OUTCOMES)[number];
export type ChipRevocation = (typeof CHIP_REVOCATION_OUTCOMES)[number];

/** C62.2: integrity is judged apart from revocation. */
export const CHIP_INTEGRITY_TEXT: Readonly<Record<ChipIntegrity, ReasonText>> = Object.freeze({
  established: {
    words: 'Established',
    explanation:
      'The signer chains to a country signing CA the trust store holds, the signed security object verifies, and every data group sent hashes as it says.',
  },
  broken: {
    words: 'Broken',
    explanation:
      'A signer the trust store vouches for signed the security object, and its signature or a data group’s hash fails: proven tampering.',
  },
  not_established: {
    words: 'Not established',
    explanation:
      'A gap of the trust store or a defect of the issuer: the chip goes to review, never to a failure.',
  },
});

export const CHIP_REVOCATION_TEXT: Readonly<Record<ChipRevocation, ReasonText>> = Object.freeze({
  revoked: {
    words: 'Revoked',
    explanation: 'A current CRL of the issuer lists the document signer’s certificate.',
  },
  unrevoked: {
    words: 'Not revoked',
    explanation: 'A current CRL of the issuer does not list the document signer’s certificate.',
  },
  undetermined: {
    words: 'Not determined',
    explanation: 'No current CRL of the issuer is held, so revocation could not be checked.',
  },
});

/** Why revocation is undetermined (`metadata.revocation-gap`). */
export const REVOCATION_GAP_LABELS: Readonly<Record<string, string>> = Object.freeze({
  crl_unavailable: 'No current CRL is held',
  no_distribution_point: 'The country signing CA names no CRL distribution point',
});

/** C62.2: each data group against the signed security object. */
export const DATA_GROUP_STATE_TEXT: Readonly<Record<string, ReasonText>> = Object.freeze({
  identical: {
    words: 'Identical',
    explanation: 'It hashes as the signed security object says.',
  },
  not_identical: {
    words: 'Not identical',
    explanation: 'Its hash differs from the one the security object signs.',
  },
  missing_from_upload: {
    words: 'Missing from the upload',
    explanation: 'The signed security object lists it, and the client did not send it.',
  },
  not_listed: {
    words: 'Not listed by the SOD',
    explanation: 'The client sent it, and the signed security object does not list it.',
  },
});

/** What the Active Authentication response proved (`metadata.outcome`, C62.6). */
export const ACTIVE_AUTHENTICATION_TEXT: Readonly<Record<string, ReasonText>> = Object.freeze({
  verified: {
    words: 'Verified',
    explanation:
      'The chip signed the server’s own nonce with the key its signed DG15 holds: the chip itself was present.',
  },
  failed: {
    words: 'Failed',
    explanation: 'A well-formed response does not verify under the DG15 key.',
  },
  malformed: {
    words: 'Response unreadable',
    explanation: 'The response could not be read, so the chip goes to review.',
  },
  withheld: {
    words: 'Withheld',
    explanation:
      'The security object lists DG15, but no response came, so the chip goes to review.',
  },
  not_listed: {
    words: 'No Active Authentication key',
    explanation:
      'The signed security object lists no DG15, so chip presence cannot be verified here. This is not a pass.',
  },
  untrusted_key: {
    words: 'Key not trusted',
    explanation: 'Integrity was not established, so the DG15 key cannot be trusted.',
  },
});

/** How the response was verified (`metadata.scheme`). */
export const AA_SCHEME_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'rsa-iso9796-2': 'RSA, ISO/IEC 9796-2 scheme 1',
  'ecdsa-plain': 'Plain ECDSA',
});

/** The protocols a device may say it ran (`metadata.device-reported`). */
export const DEVICE_PROTOCOL_LABELS: Readonly<Record<string, string>> = Object.freeze({
  bac: 'BAC',
  pace: 'PACE',
  pace_cam: 'PACE-CAM',
  chip_authentication: 'Chip Authentication',
  active_authentication: 'Active Authentication',
  terminal_authentication: 'Terminal Authentication',
});

/** How passive authentication chose the anchor (`metadata.anchor-matched-by`). */
export const ANCHOR_MATCH_LABELS: Readonly<Record<string, string>> = Object.freeze({
  aki: 'By the signer’s authority key identifier',
  issuer_dn: 'By issuer name, its key verifying the signer',
});

/** Passive authentication's flags (`metadata.flags`): facts, never chip data. */
export const PASSIVE_AUTHENTICATION_FLAG_TEXT: Readonly<Record<string, string>> = Object.freeze({
  'trailing-bytes': 'Bytes follow a data group or the security object',
  'dg1-malformed': 'DG1 could not be read',
  'signer-identifier-mismatch': 'The signer identifier names no embedded certificate',
  'issuer-dn-differs': 'The signer’s issuer name differs from the anchor’s',
  sha1: 'SHA-1 in use (accepted, flagged)',
  'issuer-country-unmapped': 'DG1’s issuer has no country',
  'sod-v0': 'Security object version 0',
  'issuer-dn-match': 'Anchor chosen by issuer name',
  'link-anchor': 'Chained through a link certificate',
  'sod-signature-invalid': 'The security object signature failed under that anchor',
  'dg-hash-mismatch': 'A data group hash failed under that anchor',
  'time-budget-exceeded': 'The verification ran out of time',
  'self-test-failed': 'The platform self-test failed',
  'revocation-undetermined': 'Revocation not determined, accepted under best-effort',
});

/** The fields the MRZ comparison reads (`metadata.compared-fields`). */
export const MRZ_COMPARED_FIELD_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'identification-number': 'Document number',
  birthdate: 'Date of birth',
  'expiration-date': 'Expiry date',
  name: 'Name',
  nationality: 'Nationality',
});

/**
 * What a passed chip verification means, and when it shows the chip was present: sentences of
 * docs/checks/nfc.md's "What a pass means" (the test reads the page).
 */
export const NFC_PASS_MEANS =
  "A passed NFC verification means: data signed by a document's issuer, bound to the person in the live selfie. It shows that the chip itself was present only when Active Authentication passed: the chip signed the server's own nonce with the key its signed DG15 holds.";

/** Why the device report is shown apart from the evidence (C62.5). */
export const DEVICE_REPORT_NOTE =
  'As reported by the client: what the reading device says it ran. It is never evidence, since Chip Authentication and PACE-CAM cannot be verified on the server.';

/** The Utopia test CSCA that seed:dev inserts (C62.8). */
export const SANDBOX_ANCHOR_NOTE =
  'Sandbox-only anchor: the Utopia test country signing CA, never trusted in a production environment.';

/** C208.4: the label of a verification read from a sandbox test chip, as the device shows it. */
export const SANDBOX_CHIP_LABEL = 'Test chip (sandbox)';

/** C208.4, rule 10: what a sandbox test chip is, and what it does not prove. */
export const SANDBOX_CHIP_NOTE =
  'The server built this chip for a sandbox inquiry; no document was read. It shows that the flow and the server’s checks work, and says nothing about a chip reader or a real document.';

/** What each data group holds, for the ones the console names. */
const DATA_GROUP_CONTENTS: ReadonlyMap<number, string> = new Map([
  [1, 'MRZ'],
  [2, 'portrait'],
  [3, 'fingerprints'],
  [4, 'iris'],
  [11, 'additional personal details'],
  [12, 'additional document details'],
  [14, 'chip authentication keys'],
  [15, 'Active Authentication key'],
]);

/** A data group's name (`dg2` is "DG2 (portrait)"); a key it cannot read stays as it is. */
export function dataGroupLabel(key: string): string {
  const match = /^dg([1-9]\d?)$/.exec(key);
  if (match?.[1] === undefined) {
    return key;
  }
  const number = Number(match[1]);
  const contents = DATA_GROUP_CONTENTS.get(number);
  return contents === undefined ? `DG${String(number)}` : `DG${String(number)} (${contents})`;
}
