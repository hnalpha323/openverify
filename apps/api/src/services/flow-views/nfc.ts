/**
 * C207.2, C208.2, C221.1 (Phase 10, Workflow 10C): the `nfc` client view's members that need the
 * inquiry and the environment. Owned by `api-nfc`; `flow-engine/session.ts` (shared) calls
 * {@link nfcSessionMembers} for a session whose served step is an `nfc` view and merges the answer
 * into it (`fallbackAvailable` is `clientViewOf`'s, a pure fact of the flow).
 *
 * - `sandboxChipAvailable`: only in a sandbox environment whose trust store holds the current
 *   Utopia anchor, so the SDK never guesses the environment (review F27).
 * - `prefillMrz`: only for a session whose client declared spec 2 with `mobile-sdk-name` set, only
 *   while the `nfc` step is the current position, and only when the flow has a decided government
 *   ID of a TD1 or TD3 document; never for the web flow (decision 63; review P01). PII: masked in
 *   every exit (`NFC_PREFILL_MRZ_MEMBER`).
 *
 * `prefillMrz` narrows what the web flow can see; it is no secret from the session's holder: a
 * holder of the session token who sends the SDK's `User-Agent` is an SDK client to this server
 * (C207.2 says so, and so do the docs).
 *
 * The reading does not keep the MRZ's format, so "a TD1 or TD3 document" is read from the ID's
 * established class: a passport (TD3), or a national ID, residence permit or passport card (TD1 in
 * practice; an older TD2 card of those classes is served too, and the SDK's key input is the same
 * three fields whatever the format). A visa, a driving licence and an unknown class serve nothing.
 */
import type { EnvironmentKind } from '@openverify/contracts';
import type { IdClass } from '@openverify/core';
import {
  getGovernmentIdExtraction,
  type Db,
  type Inquiry,
  type VerificationWithChecks,
} from '@openverify/db';
import { nfcPrefillMrzSchema, type NfcClientView, type NfcPrefillMrz } from '@openverify/flow-spec';
import { systemClock, type Clock } from '../../ports.js';
import {
  mrzDateOf,
  mrzDocumentNumberOf,
  sandboxUtopiaAnchorHeld,
  sdkClientAtNfcStep,
} from '../sandbox-chip.js';

/** What the session builder knows when it serves an `nfc` step. */
export interface NfcSessionMembersInput {
  inquiry: Inquiry;
  /** The `nfc` view `clientViewOf` built. */
  step: NfcClientView;
  /** The session the request authenticated; `null` when the caller holds none. */
  sessionId: string | null;
  /** The session's environment kind; `null` when the caller did not read it. */
  environmentKind: EnvironmentKind | null;
  /** The inquiry's verifications, as the builder read them. */
  verifications: readonly VerificationWithChecks[];
}

/** The members the hook may add to the `nfc` view. */
export type NfcSessionMembers = Pick<NfcClientView, 'sandboxChipAvailable' | 'prefillMrz'>;

/** The ID classes whose MRZ is TD1 or TD3 (see the header). */
const PREFILL_ID_CLASSES: ReadonlySet<IdClass> = new Set([
  'passport',
  'national_id',
  'residence_permit',
  'passport_card',
]);

/** The statuses of a decided government ID whose reading may be served. */
const DECIDED: ReadonlySet<string> = new Set(['passed', 'needs_review']);

/** The three fields a chip's access key is derived from, as the reading names them. */
const KEY_FIELDS = ['identification-number', 'birthdate', 'expiration-date'] as const;

/**
 * The MRZ key fields of the inquiry's latest decided government ID that can serve them: of a TD1
 * or TD3 class, with all three fields read from the MRZ and in a form the MRZ holds.
 */
async function prefillMrzOf(
  db: Db,
  inquiry: Inquiry,
  verifications: readonly VerificationWithChecks[],
): Promise<NfcPrefillMrz | null> {
  const ids = verifications.filter(
    (verification) =>
      verification.type === 'government_id' &&
      DECIDED.has(verification.status) &&
      verification.idClass !== null &&
      PREFILL_ID_CLASSES.has(verification.idClass),
  );
  for (const verification of [...ids].reverse()) {
    const extraction = await getGovernmentIdExtraction(db, inquiry.environmentId, verification.id);
    if (
      extraction?.fields == null ||
      !KEY_FIELDS.every((field) => extraction.fieldSources[field]?.includes('mrz') === true)
    ) {
      continue;
    }
    const prefill = nfcPrefillMrzSchema.safeParse({
      documentNumber: mrzDocumentNumberOf(extraction.fields['identification-number']),
      birthDate: mrzDateOf(extraction.fields.birthdate) ?? '',
      expiryDate: mrzDateOf(extraction.fields['expiration-date']) ?? '',
    });
    if (prefill.success) {
      return prefill.data;
    }
  }
  return null;
}

/**
 * The `nfc` view's inquiry- and environment-bound members, for an SDK client while the `nfc` step
 * is the active position; none for anyone else. `clock` dates the test anchor the sandbox chip
 * needs (the session builder passes none, so the system clock). The test-only chip builder is
 * loaded only for a sandbox environment (C208.3).
 */
export async function nfcSessionMembers(
  db: Db,
  input: NfcSessionMembersInput,
  clock: Clock = systemClock,
): Promise<NfcSessionMembers> {
  const { inquiry, step } = input;
  if (inquiry.flowStepId !== step.id || !(await sdkClientAtNfcStep(db, inquiry, input.sessionId))) {
    return {};
  }
  const prefillMrz = await prefillMrzOf(db, inquiry, input.verifications);
  const sandboxChipAvailable =
    input.environmentKind === 'sandbox' && (await sandboxUtopiaAnchorHeld(db, clock.now()));
  return {
    ...(sandboxChipAvailable ? { sandboxChipAvailable: true } : {}),
    ...(prefillMrz === null ? {} : { prefillMrz }),
  };
}
