/**
 * C208 (Phase 10, Workflow 10C): the sandbox test chip. Owned by `api-nfc`; `contracts-10c` froze
 * the route (`routes/flow/sandbox-chip.ts`) over these stubs.
 *
 * {@link createSandboxChip} builds a synthetic chip for the session's NFC verification and
 * challenge (C208.1): signed by the environment's sandbox Utopia anchor (409
 * `sandbox_chip_anchor_missing` without it), DG1 from the latest decided government ID's MRZ, DG2
 * attached on the server by reference to the stored selfie ({@link attachSandboxChipPortrait}, so
 * no image leaves the server), a per-verification Active Authentication key that signs the
 * challenge's nonce, and `sandbox-chip: <scenario>` recorded on the challenge
 * (`chip_challenges.sandbox_scenario`). `face-mismatch` needs the generated fixture faces
 * (`fixtures/generated/selfie/`, named by `OPENVERIFY_SANDBOX_CHIP_FACES`; 422
 * `sandbox_chip_scenario_unavailable` without them).
 *
 * C208.3: `@openverify/emrtd/testing` is imported lazily, here and only behind the route's
 * environment check; a test asserts the production path never loads it.
 *
 * What a sandbox chip is, and is not (C208.4; rule 10): a TD3 passport of Utopia (`UTO`, Doc
 * 9303's specimen state) under the sandbox test anchor. It proves the flow and the server's
 * checks, never a reader, and its verification is labelled with the scenario
 * ({@link sandboxChipLabelOf}). Known limits, stated rather than hidden:
 * - DG2 carries the stored selfie centre as it was uploaded, so that photo must be a JPEG whose DG2
 *   fits the 1 MiB a `chip-dg2` file may be; anything else answers 422
 *   `sandbox_chip_scenario_unavailable` (this server holds no image encoder to shrink it).
 * - The government ID's reading does not keep its MRZ lines, so DG1 is rebuilt from the fields the
 *   reading took from the MRZ. The server's MRZ comparison finds its reference only for an ID that
 *   is itself a Utopia passport; for any other ID a `match` chip ends in review
 *   (`no_reference_data`), which is the honest answer.
 * - The challenge row keeps only the nonce's SHA-256. A P-256 Active Authentication signature is
 *   an ECDSA signature over exactly that digest, so the response is computed from the stored digest
 *   by the test chips' own prehashed signer (`testSignDigest` of `@openverify/emrtd/testing`,
 *   KP10-40) and verifies against the nonce the client holds.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeCountryCode } from '@openverify/checks';
import {
  detectImageMimeType,
  maxUploadBytes,
  type FlowSandboxChipBody,
  type FlowSandboxChipResponse,
  type SandboxChipScenario,
} from '@openverify/contracts';
import {
  getChipChallenge,
  getGovernmentIdExtraction,
  getInquirySession,
  listChipChallenges,
  listInquiryVerifications,
  listVerificationFiles,
  replaceVerificationFile,
  setChipChallengeSandboxScenario,
  trustAnchorSourceOf,
  encryptBytes,
  type Db,
  type Inquiry,
  type VerificationWithChecks,
} from '@openverify/db';
import type { FlowSession } from '../auth/flow-session.js';
import { ConflictError, Phase10FlowProblemError } from '../errors.js';
import { pinnedFlowOf } from '../flow-engine/pinned-flow.js';
import { latestOfKind, readStoredImage } from '../jobs/images.js';
import { newStorageKey } from '../storage/index.js';
import { chipChallengeInvalid } from './chip-challenges/rules.js';
import type { ApiDependencies } from './context.js';
import { requireFlowVerification, requireFlowVerificationUnderLock } from './flow-preconditions.js';

/**
 * C208.1 (review P15): the variable that names the directory of fetched fixture faces a
 * `face-mismatch` chip takes its portrait from (the e2e stack and the Testcontainers harness set
 * it; no image bundles a face). Unset or empty, the scenario answers 422.
 */
export const SANDBOX_CHIP_FACES_ENV = 'OPENVERIFY_SANDBOX_CHIP_FACES';

/**
 * The file of that directory a `face-mismatch` chip carries: the C45.2 fixture set's centre still
 * of person B (`fixtures/generated/selfie/`, written by
 * `services/vision/tools/make_synthetic_fixtures.py` from the pinned public-domain faces), where
 * the sandbox selfies are person A's.
 */
export const SANDBOX_CHIP_OTHER_FACE_FILE = 'head-turn-b-center.jpg';

/** The golden problems' details (C221.6). */
export const SANDBOX_CHIP_ANCHOR_MISSING_DETAIL =
  'The sandbox trust store does not hold the current test anchor; run trust:sandbox-utopia.';
export const SANDBOX_CHIP_SCENARIO_UNAVAILABLE_DETAIL =
  'This sandbox chip scenario is not available on this server.';

const scenarioUnavailable = (): Phase10FlowProblemError =>
  new Phase10FlowProblemError(
    'sandbox_chip_scenario_unavailable',
    SANDBOX_CHIP_SCENARIO_UNAVAILABLE_DETAIL,
  );

/** The test-only builder, loaded at the call and never before (C208.3). */
const loadBuilder = () => import('@openverify/emrtd/testing');

// The chip's holder ----------------------------------------------------------------------------

/** What a TD3 MRZ says of its holder (synthetic, or the decided ID's MRZ-read fields). */
interface ChipHolder {
  surname: string;
  givenNames: string;
  /** 1 to 9 MRZ characters. */
  documentNumber: string;
  /** ICAO alpha-3. */
  nationality: string;
  /** YYMMDD. */
  birthDate: string;
  sex: 'M' | 'F' | '<';
  /** YYMMDD. */
  expiryDate: string;
}

/** The issuer of every sandbox chip: Doc 9303's specimen state. */
const ISSUER = 'UTO';

/** The fixed synthetic holder of a chip no decided ID gives a holder to; no real person. */
function syntheticHolder(now: Date): ChipHolder {
  return {
    surname: 'SPECIMEN',
    givenNames: 'SANDBOX',
    documentNumber: 'UT0000000',
    nationality: ISSUER,
    birthDate: '900101',
    sex: '<',
    // Five years ahead, so the chip is never expired.
    expiryDate: `${String((now.getUTCFullYear() + 5) % 100).padStart(2, '0')}1231`,
  };
}

/** ICAO 9303 check digit (weights 7, 3, 1; `<` is 0, letters 10 to 35). */
function checkDigit(field: string): string {
  let sum = 0;
  for (let index = 0; index < field.length; index += 1) {
    const code = field.charCodeAt(index);
    const value = code >= 65 && code <= 90 ? code - 55 : code >= 48 && code <= 57 ? code - 48 : 0;
    sum += value * ([7, 3, 1][index % 3] ?? 1);
  }
  return String(sum % 10);
}

const pad = (value: string, length: number): string => value.padEnd(length, '<').slice(0, length);

/** The holder's TD3 MRZ (two lines of 44), every check digit computed. */
export function td3LinesOf(holder: ChipHolder): [string, string] {
  const name = pad(`${holder.surname}<<${holder.givenNames}`, 39);
  const number = pad(holder.documentNumber, 9);
  const optional = pad('', 14);
  const parts = [
    `${number}${checkDigit(number)}`,
    `${holder.birthDate}${checkDigit(holder.birthDate)}`,
    `${holder.expiryDate}${checkDigit(holder.expiryDate)}`,
    `${optional}${checkDigit(optional)}`,
  ];
  const composite = checkDigit(parts.join(''));
  return [
    `P<${ISSUER}${name}`,
    `${parts[0] ?? ''}${holder.nationality}${parts[1] ?? ''}${holder.sex}${parts[2] ?? ''}${parts[3] ?? ''}${composite}`,
  ];
}

/** A name as the MRZ writes it: upper-case letters, every other run one filler. */
function mrzName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replaceAll(/\p{M}/gu, '')
    .toUpperCase()
    .replaceAll(/[^A-Z]+/g, '<')
    .replaceAll(/^<+|<+$/g, '');
}

/** `YYYY-MM-DD` as the MRZ writes it (`YYMMDD`); `null` for anything else. */
export function mrzDateOf(value: string | null | undefined): string | null {
  const match = /^\d{2}(\d{2})-(\d{2})-(\d{2})$/.exec(value ?? '');
  return match === null ? null : `${match[1] ?? ''}${match[2] ?? ''}${match[3] ?? ''}`;
}

/**
 * A document number as the MRZ holds it: upper case, with the separators a reading may show
 * (spaces, hyphens, fillers) dropped. Any other character stays, so a value the MRZ cannot hold
 * is refused by its caller, never silently shortened.
 */
export function mrzDocumentNumberOf(value: string | null | undefined): string {
  return (value ?? '').toUpperCase().replaceAll(/[\s<-]+/g, '');
}

/** A document number a TD3 line holds whole: 1 to 9 letters and digits. */
const TD3_DOCUMENT_NUMBER = /^[A-Z0-9]{1,9}$/;

/** The verifications whose reading counts as decided. */
const DECIDED: ReadonlySet<string> = new Set(['passed', 'needs_review']);

/**
 * The holder DG1 names: the latest decided government ID whose reading took its document number,
 * birth date and expiry from the MRZ (a number of at most 9 characters, which a TD3 line holds),
 * with its name, nationality and sex where the MRZ gave them; else the fixed synthetic holder.
 */
async function holderOf(db: Db, inquiry: Inquiry, now: Date): Promise<ChipHolder> {
  const fallback = syntheticHolder(now);
  const ids = (await listInquiryVerifications(db, inquiry.environmentId, inquiry.id)).filter(
    (verification) => verification.type === 'government_id' && DECIDED.has(verification.status),
  );
  for (const verification of ids.reverse()) {
    const extraction = await getGovernmentIdExtraction(db, inquiry.environmentId, verification.id);
    if (extraction?.fields == null) {
      continue;
    }
    const { fields, fieldSources } = extraction;
    const fromMrz = <Field extends keyof typeof fields>(field: Field) =>
      fieldSources[field]?.includes('mrz') === true ? fields[field] : null;
    const documentNumber = mrzDocumentNumberOf(fromMrz('identification-number'));
    const birthDate = mrzDateOf(fromMrz('birthdate'));
    const expiryDate = mrzDateOf(fromMrz('expiration-date'));
    if (!TD3_DOCUMENT_NUMBER.test(documentNumber) || birthDate === null || expiryDate === null) {
      continue;
    }
    const sex = fromMrz('sex');
    const surname = mrzName(fromMrz('name-last'));
    return {
      surname: surname === '' ? fallback.surname : surname,
      givenNames: mrzName(fromMrz('name-first')),
      documentNumber,
      nationality: normalizeCountryCode(fromMrz('nationality') ?? '') ?? ISSUER,
      birthDate,
      sex: sex === 'M' || sex === 'F' ? sex : '<',
      expiryDate,
    };
  }
  return fallback;
}

/** Another document number than `value`'s, of the same length: its last character moves on. */
function otherDocumentNumber(value: string): string {
  const last = value.at(-1) ?? '0';
  return `${value.slice(0, -1)}${last === '9' ? '0' : last === 'Z' ? 'A' : String.fromCharCode(last.charCodeAt(0) + 1)}`;
}

// The portrait ---------------------------------------------------------------------------------

/** The DG2 bytes around a JPEG beyond its record's own framing; a generous bound. */
const DG2_FRAMING_BYTES = 256;

/** Whether `bytes` are a JPEG whose DG2 fits a `chip-dg2` file. */
function fitsDg2(bytes: Uint8Array): boolean {
  return (
    detectImageMimeType(bytes) === 'image/jpeg' &&
    bytes.byteLength + DG2_FRAMING_BYTES <= maxUploadBytes('chip-dg2')
  );
}

/**
 * The inquiry's latest selfie centre photo (of a selfie submitted or decided without failing),
 * decrypted; `null` when there is none that a DG2 can carry. Wipe it after use.
 */
async function selfieCentreOf(
  deps: Pick<ApiDependencies, 'db' | 'storage' | 'keyring'>,
  inquiry: Inquiry,
): Promise<Uint8Array | null> {
  const selfies = (
    await listInquiryVerifications(deps.db, inquiry.environmentId, inquiry.id)
  ).filter(
    (verification) =>
      verification.type === 'selfie' &&
      (verification.status === 'submitted' || DECIDED.has(verification.status)),
  );
  for (const selfie of selfies.reverse()) {
    const centre = latestOfKind(
      await listVerificationFiles(deps.db, inquiry.environmentId, [selfie.id]),
      'selfie-center',
    );
    const image = centre === undefined ? null : await readStoredImage(deps, centre);
    if (image === null) {
      continue;
    }
    if (fitsDg2(image.bytes)) {
      return image.bytes;
    }
    image.bytes.fill(0);
    return null;
  }
  return null;
}

/** The directory `OPENVERIFY_SANDBOX_CHIP_FACES` names; `null` when unset or empty. */
export function sandboxChipFacesDirectory(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env[SANDBOX_CHIP_FACES_ENV]?.trim() ?? '';
  return value === '' ? null : value;
}

/**
 * The fixture face of another person, for `face-mismatch`; `null` where no directory is
 * configured, the file is missing or unreadable, or a DG2 cannot carry it.
 */
async function otherFaceOf(): Promise<Uint8Array | null> {
  const directory = sandboxChipFacesDirectory();
  if (directory === null) {
    return null;
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(path.join(directory, SANDBOX_CHIP_OTHER_FACE_FILE)));
  } catch {
    return null;
  }
  return fitsDg2(bytes) ? bytes : null;
}

// The route's service ----------------------------------------------------------------------------

/**
 * C208.1, C208.2: whether the trust store lists the current Utopia test anchor (the one
 * `trust:sandbox-utopia` and `seed:dev` install as of `now`): its certificate's SHA-256 is a
 * current member of an enabled source. Loads the test-only builder: call it only for a sandbox
 * environment.
 */
export async function sandboxUtopiaAnchorHeld(db: Db, now: Date): Promise<boolean> {
  const { buildUtopiaCsca } = await loadBuilder();
  const anchorId = createHash('sha256').update(buildUtopiaCsca({ now }).der).digest('hex');
  return (await trustAnchorSourceOf(db, anchorId)) !== null;
}

/**
 * Whether the session's client is an SDK (`mobile-sdk-name`, Phase 7 C94.5) and the inquiry's
 * position is an active `nfc` step: where `prefillMrz` is served and a sandbox chip is taken
 * (C207.2, C208.1).
 */
export async function sdkClientAtNfcStep(
  db: Db,
  inquiry: Pick<Inquiry, 'environmentId' | 'inquiryTemplateVersionId' | 'flowStepId' | 'flowState'>,
  sessionId: string | null,
): Promise<boolean> {
  if (sessionId === null || inquiry.flowStepId === null || inquiry.flowState !== 'active') {
    return false;
  }
  const session = await getInquirySession(db, inquiry.environmentId, sessionId);
  if ((session?.mobileSdkName ?? null) === null) {
    return false;
  }
  const pinned = await pinnedFlowOf(db, inquiry);
  return pinned?.flow.steps.find((step) => step.id === inquiry.flowStepId)?.type === 'nfc';
}

/** The upload kind of each file the route answers, in the order it answers them. */
const RETURNED_GROUPS = [
  [1, 'chip-dg1'],
  [14, 'chip-dg14'],
  [15, 'chip-dg15'],
] as const;

const base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

/**
 * `POST /api/v1/flow/verifications/:id/sandbox-chip`, in a sandbox environment (the route checks
 * it). In order:
 * 1. C52.1's preconditions (another inquiry's verification 404, a finished inquiry 409, a redacted
 *    one 410, no consent 409, another type 422, a verification no longer `initiated` 409);
 * 2. 409 unless the session's client is an SDK and the position is an active `nfc` step, as
 *    `prefillMrz` (DG1 holds the same MRZ);
 * 3. 409 `sandbox_chip_anchor_missing` unless the trust store lists the current test anchor;
 * 4. 422 `sandbox_chip_scenario_unavailable` for `face-mismatch` without the fixture face, and for
 *    any other scenario without a stored selfie centre a DG2 can carry;
 * 5. under the C40.6 locks: 409 `chip_challenge_invalid` unless the challenge is the
 *    verification's open, unexpired one; the scenario is recorded on it and DG2 is stored as the
 *    verification's `chip-dg2` file.
 *
 * The answer carries every file but DG2 and, when the chip has a key, its signature over the
 * challenge's nonce. Nothing here is logged: DG1 is the MRZ.
 * @throws {Phase10FlowProblemError} `sandbox_chip_anchor_missing`, `sandbox_chip_scenario_unavailable`.
 * @throws {Phase5ProblemError} 409 `chip_challenge_invalid`.
 */
export async function createSandboxChip(
  deps: ApiDependencies,
  session: FlowSession,
  verificationId: string,
  body: FlowSandboxChipBody,
): Promise<FlowSandboxChipResponse> {
  const { db, clock } = deps;
  const { environmentId } = session;
  const { scenario } = body;
  const { inquiry, verification } = await requireFlowVerification(deps, session, verificationId, {
    types: ['government_id_nfc'],
  });
  if (!(await sdkClientAtNfcStep(db, inquiry, session.id))) {
    throw new ConflictError(
      'A sandbox test chip is taken by an SDK client at the current nfc step.',
    );
  }
  const now = clock.now();
  if (!(await sandboxUtopiaAnchorHeld(db, now))) {
    throw new Phase10FlowProblemError(
      'sandbox_chip_anchor_missing',
      SANDBOX_CHIP_ANCHOR_MISSING_DETAIL,
    );
  }
  const portrait =
    scenario === 'face-mismatch' ? await otherFaceOf() : await selfieCentreOf(deps, inquiry);
  if (portrait === null) {
    throw scenarioUnavailable();
  }
  try {
    const challenge = await getChipChallenge(db, environmentId, body['challenge-id']);
    if (
      challenge?.verificationId !== verification.id ||
      challenge.status !== 'initiated' ||
      challenge.expiresAt.getTime() <= now.getTime()
    ) {
      throw chipChallengeInvalid();
    }
    const base = await holderOf(db, inquiry, now);
    const holder =
      scenario === 'mrz-mismatch'
        ? { ...base, documentNumber: otherDocumentNumber(base.documentNumber) }
        : base;
    const { buildChip, buildDsc, buildUtopiaCsca, testSignDigest } = await loadBuilder();
    // The environment's signer under the test anchor, and the verification's own chip keys.
    const dsc = buildDsc({
      seed: `openverify/sandbox-chip/${environmentId}/dsc`,
      issuer: buildUtopiaCsca({ now }),
      now,
    });
    const built = buildChip({
      dsc,
      seed: `openverify/sandbox-chip/${verification.id}`,
      mrzLines: td3LinesOf(holder),
      portrait: { bytes: portrait, mimeType: 'image/jpeg' },
      ...(scenario === 'no-active-authentication'
        ? {}
        : { activeAuthentication: { kind: 'ec', curve: 'P-256' } as const }),
      ...(scenario === 'tampered-dg1' ? { variants: ['tampered-dg1'] as const } : {}),
    });
    const { files, activeAuthenticationKey } = built;
    const dg2 = files.dataGroups[2];
    if (dg2 === undefined || dg2.byteLength > maxUploadBytes('chip-dg2')) {
      throw scenarioUnavailable();
    }
    const replacedKeys = await db.transaction(async (tx) => {
      await requireFlowVerificationUnderLock(tx, session, verification.id);
      const earlier = (await listVerificationFiles(tx, environmentId, [verification.id]))
        .filter((file) => file.kind === 'chip-dg2')
        .map((file) => file.storageKey);
      const recorded = await setChipChallengeSandboxScenario(tx, environmentId, {
        id: challenge.id,
        verificationId: verification.id,
        scenario,
      });
      if (!recorded) {
        throw chipChallengeInvalid();
      }
      await attachSandboxChipPortrait(tx, deps, {
        environmentId,
        verificationId: verification.id,
        dg2,
      });
      return earlier;
    });
    for (const key of replacedKeys) {
      await deps.storage.delete(key).catch(() => undefined);
    }
    const returned: FlowSandboxChipResponse['files'] = [
      { kind: 'chip-sod', content: base64(files.sod) },
    ];
    for (const [group, kind] of RETURNED_GROUPS) {
      const bytes = files.dataGroups[group];
      if (bytes !== undefined) {
        returned.push({ kind, content: base64(bytes) });
      }
    }
    if (files.com !== undefined) {
      returned.push({ kind: 'chip-com', content: base64(files.com) });
    }
    return {
      files: returned,
      'dg2-attached': true,
      ...(activeAuthenticationKey === null
        ? {}
        : {
            'active-authentication-response': base64(
              // Plain `r || s` over the stored SHA-256 of the nonce: what the chip's key gives
              // over the nonce itself.
              testSignDigest(
                activeAuthenticationKey,
                new Uint8Array(Buffer.from(challenge.nonceSha256, 'hex')),
                { ec: 'plain', hash: 'sha256' },
              ),
            ),
          }),
    };
  } finally {
    if (scenario !== 'face-mismatch') {
      portrait.fill(0);
    }
  }
}

/**
 * C208.1, C208.4: the scenario of the sandbox test chip built for the verification
 * (`chip_challenges.sandbox_scenario`), which the verification's attributes serve as
 * `sandbox-chip`; `null` for a verification no sandbox chip was built for. It reads the latest
 * challenge that carries one, whichever challenge the submit then named: the server-built DG2 was
 * attached to this verification, so the label stays. `services/attributes/government-id-nfc.ts`
 * (shared) calls it.
 */
export async function sandboxChipLabelOf(
  db: Db,
  verification: Pick<VerificationWithChecks, 'environmentId' | 'id'>,
): Promise<SandboxChipScenario | null> {
  const challenges = await listChipChallenges(db, verification.environmentId, verification.id);
  return (
    challenges.find((challenge) => challenge.sandboxScenario !== null)?.sandboxScenario ?? null
  );
}

/** What attaches a server-built DG2 to an NFC verification as its `chip-dg2` file. */
export interface SandboxChipPortraitInput {
  environmentId: string;
  verificationId: string;
  /** The DG2 the server built (a synthetic chip's, over the stored selfie or a fixture face). */
  dg2: Uint8Array;
}

/**
 * C208.1 (decision 69): stores `dg2` as the verification's `chip-dg2` file on the server, in `tx`,
 * in place of an earlier one, sealed as an upload is (its own data key, the file id as context),
 * so the client never uploads (or receives) DG2. Returns the stored file's id. The object is put
 * before the row; should `tx` roll back, it stays unreadable (its wrapped key went with the row).
 * The caller deletes the replaced files' objects once `tx` committed.
 * @throws {ConflictError} when the verification is no longer `initiated`.
 */
export async function attachSandboxChipPortrait(
  tx: Db,
  deps: Pick<ApiDependencies, 'storage' | 'keyring' | 'ids' | 'clock'>,
  input: SandboxChipPortraitInput,
): Promise<string> {
  const id = deps.ids.newId('file');
  const storageKey = newStorageKey(input.environmentId);
  const sealed = encryptBytes(input.dg2, deps.keyring, { context: id });
  await deps.storage.put(storageKey, sealed.ciphertext);
  const stored = await replaceVerificationFile(tx, input.environmentId, {
    id,
    verificationId: input.verificationId,
    kind: 'chip-dg2',
    storageKey,
    mimeType: 'application/octet-stream',
    byteSize: input.dg2.byteLength,
    sha256: createHash('sha256').update(input.dg2).digest('hex'),
    wrappedDek: sealed.wrappedDek,
  });
  if (stored === null) {
    await deps.storage.delete(storageKey).catch(() => undefined);
    throw new ConflictError('The verification is no longer initiated.');
  }
  return stored.file.id;
}
