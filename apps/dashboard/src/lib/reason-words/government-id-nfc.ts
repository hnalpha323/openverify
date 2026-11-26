/**
 * C51.2, C62.3, C66: the reason codes of the `verification/government-id-nfc` checks in words,
 * said for a chip read. Every code of the C51.2 table has words here
 * (`government-id-nfc.test.ts` reads the contracts' list first); `reasonText` falls back to the
 * shared words for the C29.4 reasons the registry inputs add (`execution_error`).
 *
 * `failed` means proven tampering or revocation only (C62.3, decision 36): a gap of the trust
 * store, a profile defect or malformed data is review (`not_applicable`), and the words say so.
 * A data check on data whose integrity was not established never passes on a match (C62.4).
 */
import type { ReasonWords } from './types';

export const GOVERNMENT_ID_NFC_REASON_WORDS: ReasonWords = Object.freeze({
  // id_nfc_passive_authentication_detection: proven tampering or revocation fails.
  dg_hash_mismatch: {
    words: 'Data group differs from its signed hash',
    explanation: 'A data group sent does not hash as the signed SOD says: proven tampering.',
  },
  sod_signature_invalid: {
    words: 'Security object signature invalid',
    explanation:
      'The signed security object does not verify under the signer the trust store vouches for: proven tampering.',
  },
  dsc_revoked: {
    words: 'Signer certificate revoked',
    explanation: 'A current CRL of the issuer lists the document signer’s certificate.',
  },
  specimen_issuer: {
    words: 'Test issuer outside the sandbox',
    explanation: 'A Utopia test chip was read in a production environment.',
  },
  // Gaps of the trust store or the issuer: review, never fraud (C62.3).
  trust_anchor_unavailable: {
    words: 'No trust anchor for this signer',
    explanation:
      'The trust store holds no country signing CA that verifies this signer, so the chip goes to review.',
  },
  trust_anchor_withdrawn: {
    words: 'Trust anchor withdrawn',
    explanation:
      'No enabled source lists the country signing CA any more, so the chip goes to review.',
  },
  dsc_missing: {
    words: 'No signer certificate',
    explanation:
      'The security object carries no document signer certificate the trust store could check, so the chip goes to review.',
  },
  crl_unavailable: {
    words: 'Revocation could not be checked',
    explanation:
      'No current CRL of the issuer is held (or its CA names none), so under strict revocation the chip goes to review.',
  },
  certificate_expired: {
    words: 'Certificate outside its validity',
    explanation:
      'The country signing CA or the document signer was not valid at verification time, so the chip goes to review.',
  },
  certificate_profile_invalid: {
    words: 'Certificate profile invalid',
    explanation: 'A certificate lacks the usage its role needs (an issuer defect), so review.',
  },
  issuer_country_inconsistent: {
    words: 'Issuer country inconsistent',
    explanation: 'The chip’s issuer and the certificates’ country disagree, so review.',
  },
  algorithm_unsupported: {
    words: 'Algorithm not supported',
    explanation:
      'An algorithm or curve the server cannot verify (or a failed platform self-test), so review.',
  },
  chip_data_malformed: {
    words: 'Chip data malformed',
    explanation: 'A chip file or the response could not be read, so review.',
  },
  input_missing: {
    words: 'Chip data it needs is missing',
    explanation:
      'A file or result this check reads was not sent or not produced (DG1, a face in the portrait, the sighting count).',
  },
  // id_nfc_chip_authentication_detection (Active Authentication).
  active_authentication_failed: {
    words: 'Active Authentication failed',
    explanation: 'A well-formed response to the server’s nonce does not verify under the DG15 key.',
  },
  chip_auth_not_server_verifiable: {
    words: 'Chip presence not verifiable here',
    explanation:
      'The signed security object lists no DG15, so the chip has no Active Authentication key. This answer does not block, and it is not a pass.',
  },
  active_authentication_withheld: {
    words: 'Active Authentication withheld',
    explanation: 'The security object lists DG15, but no response came, so review.',
  },
  active_authentication_unavailable: {
    words: 'Active Authentication unavailable',
    explanation: 'The template requires it, and this chip has no Active Authentication key.',
  },
  integrity_not_established: {
    words: 'Chip data not verified',
    explanation:
      'Passive authentication did not establish the data’s integrity, so a match here never counts as a pass.',
  },
  // id_nfc_mrz_comparison: the chip's DG1 against the printed MRZ the ID step read.
  document_number_mismatch: { words: 'Document number differs from the ID' },
  birthdate_mismatch: { words: 'Birth date differs from the ID' },
  expiration_date_mismatch: { words: 'Expiry date differs from the ID' },
  name_mismatch: { words: 'Name differs from the ID' },
  nationality_mismatch: { words: 'Nationality differs from the ID' },
  issuer_mismatch: { words: 'Issuer differs from the ID' },
  not_requested: {
    words: 'No ID step to compare with',
    explanation: 'The flow has no government ID step, so the chip’s MRZ is not compared.',
  },
  no_reference_data: {
    words: 'Nothing to compare with',
    explanation:
      'No government ID reading of this document, or no selfie, in the inquiry: chip data alone does not identify the presenter.',
  },
  // id_nfc_selfie_comparison.
  face_mismatch: {
    words: 'Chip portrait does not match the selfie',
    explanation: 'The portrait signed on the chip is not the face in the live selfie.',
  },
  // id_nfc_repeat_detection (ours, advisory, decision 35).
  chip_seen_on_other_account: {
    words: 'Chip seen on another account',
    explanation:
      'An earlier read of this chip, bound to its own selfie, belongs to another account’s inquiry.',
  },
  // id_nfc_expired_detection (on DG1).
  expired: { words: 'Document expired' },
  expired_within_grace_period: {
    words: 'Expired, within the grace period',
    explanation: 'The document expired, within the days the template allows.',
  },
  expiration_date_invalid: { words: 'Expiry date invalid' },
});
