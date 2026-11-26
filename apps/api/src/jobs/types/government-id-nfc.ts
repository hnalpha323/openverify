/**
 * C62.3-C62.6, C54.1: the `government_id_nfc` job (`api-nfc`).
 *
 * `evaluate` reads, before any write:
 * - the verification's chip files (the latest upload of each kind, decrypted and checked against
 *   their SHA-256) and its consumed challenge (the nonce and the AA response sealed with it);
 * - the trust store of the environment's kind (`loadTrustStore`: a production environment never
 *   receives a sandbox-only anchor, the filter is in SQL, C62.8);
 * - Passive Authentication (`@openverify/emrtd`, integrity judged apart from revocation, with
 *   the process's self-test, C62.9) and Active Authentication over the challenge's nonce with the
 *   DG15 key (trusted only with integrity established);
 * - DG2, decoded through vision's guard as a chip portrait only once its hash verified, embedded
 *   and compared with the inquiry's latest selfie centre; and, with integrity established, the
 *   PNG `chip-portrait` the console shows;
 * - the inquiry's government ID MRZ readings (the fields its extraction took from the MRZ), and,
 *   with integrity established, the selfie-bound sightings of the SOD on other accounts.
 *
 * Then every enabled check runs (`evaluateGovernmentIdNfcChecks`). In the decision transaction
 * `persistInDecisionTx` writes `chip_reads` (only with integrity established; `selfie_bound`
 * when the selfie comparison passed and the verification ended `passed` or `needs_review`),
 * stores the `chip-portrait`, and marks the challenge `processed`, which clears its AA response
 * and device report (decision 43); a processing failure clears them too. Nothing here logs a chip
 * file, a field, a nonce or an embedding; results carry levels, states and counts only.
 */
import {
  DEVICE_REPORTED_PROTOCOLS,
  NFC_MRZ_REFERENCE_FIELDS,
  evaluateGovernmentIdNfcChecks,
  nfcChipFields,
  nfcIssuerCountry,
  nfcPassiveAuthenticationOptions,
  type GovernmentIdNfcCheckInput,
  type NfcChipFields,
  type NfcChipPortrait,
  type NfcMrzReference,
  type NfcSelfieReference,
} from '@openverify/checks';
import type { CheckModel } from '@openverify/core';
import {
  countChipSightings,
  getGovernmentIdExtraction,
  getSubmittedChipChallenge,
  listInquiryVerifications,
  listVerificationFiles,
  loadTrustStore,
  markChipChallengeProcessed,
  openChipChallengeSubmission,
  trustAnchorSourceOf,
  writeChipRead,
} from '@openverify/db';
import {
  EmrtdError,
  parseDg1,
  parseDg2,
  parseSod,
  selfTest,
  verifyActiveAuthentication,
  verifyPassiveAuthentication,
  type ActiveAuthenticationReport,
  type ChipFiles,
  type ParsedDg1,
  type PassiveAuthenticationReport,
  type SelfTestResult,
} from '@openverify/emrtd';
import type { FaceEmbeddingResult } from '../../ports.js';
import {
  ChipFileUnreadableError,
  loadChipFiles,
  wipeChipFiles,
} from '../../services/chip-challenges/chip-files.js';
import { storeServerFile } from '../../services/server-files.js';
import { attemptVision } from '../attempts.js';
import { PermanentJobError } from '../errors.js';
import { latestOfKind, readStoredImage } from '../images.js';
import type { WorkerLogger } from '../logger.js';
import { MODEL_DIGESTS } from '../models.js';
import type { ProcessVerificationDeps } from '../process-verification.js';
import type { TypeEvaluationJob, VerificationTypeJob } from './index.js';

/** What the decision hooks need. Chip data in memory only. */
export interface GovernmentIdNfcDecisionState {
  /** The consumed challenge, or `null` when the verification had none. */
  challengeId: string | null;
  /** What `chip_reads` keeps, only with integrity established and a readable DG1. PII. */
  chipRead: {
    fields: Readonly<Record<string, string | null>>;
    sodSignature: Uint8Array;
    issuingCountry: string | null;
    paSummary: Readonly<Record<string, unknown>>;
  } | null;
  /** The `chip-portrait` PNG, only with integrity established. Biometric. */
  portrait: Uint8Array | null;
  /** Objects of the portrait files the decision replaced, deleted after the commit. */
  replacedStorageKeys: string[];
}

const SELFIE_CHECK = 'id_nfc_selfie_comparison';
const REPEAT_CHECK = 'id_nfc_repeat_detection';

/** The government ID verifications whose reading the MRZ comparison may use. */
const REFERENCE_STATUSES: ReadonlySet<string> = new Set(['passed', 'needs_review', 'submitted']);

/**
 * Workflow 5C review P005: a selfie is the chip's reference only once decided, its liveness
 * judged (C62.6), never while it is still `submitted`.
 */
const SELFIE_REFERENCE_STATUSES: ReadonlySet<string> = new Set(['passed', 'needs_review']);

/**
 * The inquiry's latest selfie is still being judged (P005): the job is retried later, while
 * attempts remain, rather than bind the chip to a selfie whose liveness may yet fail. Carries no
 * data.
 */
export class SelfieReferencePendingError extends Error {
  override name = 'SelfieReferencePendingError';

  constructor() {
    super('The inquiry’s latest selfie is not decided yet');
  }
}

/** An all-zero nonce for a submit without an AA response: AA then answers before reading it. */
const NO_NONCE = new Uint8Array(8);

let processSelfTest: SelfTestResult | undefined;

/**
 * C62.9: the platform's explicit-brainpool self-test, run once per process and logged when it
 * fails (curve names only). Passive Authentication answers `algorithm_unsupported` while it
 * fails, because such a platform would misread a genuine signature as invalid.
 */
export function nfcSelfTest(logger?: WorkerLogger): SelfTestResult {
  if (processSelfTest === undefined) {
    processSelfTest = selfTest();
    if (!processSelfTest.ok) {
      logger?.error(
        {
          failures: processSelfTest.failures,
          node: processSelfTest.node,
          openssl: processSelfTest.openssl,
        },
        'NFC self-test failed: passive authentication answers algorithm_unsupported',
      );
    }
  }
  return processSelfTest;
}

const isEnabled = (job: TypeEvaluationJob, check: string): boolean =>
  job.config.checks[check]?.enabled === true;

/** The model ids vision reports, pinned by their manifest digests (unknown ones left out). */
function faceModelsOf(result: FaceEmbeddingResult | null): CheckModel[] {
  if (result === null) {
    return [];
  }
  return [result.model_versions.detector, result.model_versions.recognizer].flatMap((id) => {
    const digest = Object.hasOwn(MODEL_DIGESTS, id) ? MODEL_DIGESTS[id] : undefined;
    return digest === undefined ? [] : [{ id, sha256: digest.sha256 }];
  });
}

/**
 * C62.6: the inquiry's latest decided selfie centre face, or why there is none. While the latest
 * selfie is still `submitted` its liveness is not judged (P005): the job retries while attempts
 * remain ({@link SelfieReferencePendingError}), then there is no reference.
 */
async function selfieReferenceOf(
  deps: ProcessVerificationDeps,
  job: TypeEvaluationJob,
): Promise<{ reference: NfcSelfieReference; embedded: FaceEmbeddingResult | null }> {
  const selfies = (
    await listInquiryVerifications(deps.db, job.environmentId, job.inquiry.id)
  ).filter((verification) => verification.type === 'selfie');
  if (selfies.at(-1)?.status === 'submitted') {
    if (!job.lastAttempt) {
      throw new SelfieReferencePendingError();
    }
    return { reference: { kind: 'missing' }, embedded: null };
  }
  const selfie = selfies
    .filter((verification) => SELFIE_REFERENCE_STATUSES.has(verification.status))
    .at(-1);
  if (selfie === undefined) {
    return { reference: { kind: 'missing' }, embedded: null };
  }
  const center = latestOfKind(
    await listVerificationFiles(deps.db, job.environmentId, [selfie.id]),
    'selfie-center',
  );
  const image = center === undefined ? null : await readStoredImage(deps, center);
  if (image === null) {
    return { reference: { kind: 'missing' }, embedded: null };
  }
  try {
    const embedded = await attemptVision(
      () => deps.vision.embedFace({ image, subject: 'selfie' }),
      {
        lastAttempt: job.lastAttempt,
        logger: deps.logger,
        log: { verificationId: job.verificationId, check: SELFIE_CHECK },
      },
    );
    if (!embedded.ok) {
      return {
        reference: embedded.unreadable ? { kind: 'missing' } : { kind: 'error' },
        embedded: null,
      };
    }
    const { face } = embedded.value;
    return face === null
      ? { reference: { kind: 'missing' }, embedded: embedded.value }
      : {
          reference: { kind: 'face', verificationId: selfie.id, embedding: face.embedding },
          embedded: embedded.value,
        };
  } finally {
    image.bytes.fill(0);
  }
}

/**
 * C62.6: DG2's face, decoded through vision's guard as a chip portrait, only once DG2's hash
 * verified against the SOD; and, with integrity established, the PNG the console shows.
 */
async function chipPortraitOf(
  deps: ProcessVerificationDeps,
  job: TypeEvaluationJob,
  files: ChipFiles | null,
  report: PassiveAuthenticationReport | null,
  wanted: { face: boolean; png: boolean },
): Promise<{
  portrait: NfcChipPortrait;
  png: Uint8Array | null;
  embedded: FaceEmbeddingResult | null;
}> {
  const dg2 = files?.dataGroups[2];
  if (dg2 === undefined || report?.dataGroups[2] !== 'identical') {
    return { portrait: { kind: 'not_decoded' }, png: null, embedded: null };
  }
  let parsed;
  try {
    parsed = parseDg2(dg2);
  } catch (error) {
    if (error instanceof EmrtdError) {
      return { portrait: { kind: 'not_decoded' }, png: null, embedded: null };
    }
    throw error;
  }
  const image = { bytes: parsed.image, mimeType: parsed.mimeType };
  const context = {
    lastAttempt: job.lastAttempt,
    logger: deps.logger,
    log: { verificationId: job.verificationId, check: SELFIE_CHECK },
  };
  let portrait: NfcChipPortrait = { kind: 'not_decoded' };
  let embedded: FaceEmbeddingResult | null = null;
  if (wanted.face) {
    const answer = await attemptVision(
      () => deps.vision.embedFace({ image, subject: 'chip' }),
      context,
    );
    if (answer.ok) {
      embedded = answer.value;
      portrait =
        answer.value.face === null
          ? { kind: 'no_face' }
          : { kind: 'face', embedding: answer.value.face.embedding };
    } else {
      portrait = answer.unreadable ? { kind: 'not_decoded' } : { kind: 'error' };
    }
  }
  let png: Uint8Array | null = null;
  if (wanted.png && report.integrity === 'established') {
    const converted = await attemptVision(
      () => deps.vision.convertPortrait({ portrait: image }),
      context,
    );
    png = converted.ok ? converted.value : null;
  }
  return { portrait, png, embedded };
}

/** C62.6: the inquiry's government ID MRZ readings, latest first, MRZ-sourced fields only. */
async function mrzReferencesOf(
  deps: ProcessVerificationDeps,
  job: TypeEvaluationJob,
): Promise<NfcMrzReference[]> {
  const ids = (await listInquiryVerifications(deps.db, job.environmentId, job.inquiry.id)).filter(
    (verification) =>
      verification.type === 'government_id' && REFERENCE_STATUSES.has(verification.status),
  );
  const references: NfcMrzReference[] = [];
  for (const verification of ids.reverse()) {
    const extraction = await getGovernmentIdExtraction(deps.db, job.environmentId, verification.id);
    if (extraction?.fields == null) {
      continue;
    }
    const fields: Partial<Record<(typeof NFC_MRZ_REFERENCE_FIELDS)[number], string | null>> = {};
    for (const field of NFC_MRZ_REFERENCE_FIELDS) {
      if (extraction.fieldSources[field]?.includes('mrz') === true) {
        fields[field] = extraction.fields[field];
      }
    }
    // The extraction does not keep whether the printed MRZ's check digits held: null tolerates
    // OCR confusables, so a genuine user is never failed on an OCR slip (C62.6).
    references.push({
      verificationId: verification.id,
      idClass: verification.idClass,
      fields,
      checkDigitsValid: null,
    });
  }
  return references;
}

/** The protocols the device says succeeded, in the checks' spelling; never evidence. */
function deviceReportedProtocols(report: string | null): string[] {
  if (report === null) {
    return [];
  }
  try {
    const parsed = JSON.parse(report) as {
      protocols?: { protocol?: unknown; outcome?: unknown }[];
    };
    const known: ReadonlySet<string> = new Set(DEVICE_REPORTED_PROTOCOLS);
    return (parsed.protocols ?? [])
      .filter((entry) => entry.outcome === 'succeeded' && typeof entry.protocol === 'string')
      .map((entry) => String(entry.protocol).replaceAll('-', '_'))
      .filter((protocol) => known.has(protocol));
  } catch {
    return [];
  }
}

/** DG1 as `parseDg1` reads it, or `null` when absent or malformed. */
function dg1Of(files: ChipFiles | null): ParsedDg1 | null {
  const bytes = files?.dataGroups[1];
  if (bytes === undefined) {
    return null;
  }
  try {
    return parseDg1(bytes);
  } catch (error) {
    if (error instanceof EmrtdError) {
      return null;
    }
    throw error;
  }
}

/** The SOD's signature value (the sighting key), or `null` when the SOD cannot be read. */
function sodSignatureOf(files: ChipFiles): Uint8Array | null {
  try {
    return new Uint8Array(parseSod(files.sod).signature);
  } catch (error) {
    if (error instanceof EmrtdError) {
      return null;
    }
    throw error;
  }
}

/** The non-PII Passive Authentication summary `chip_reads.pa_summary` keeps. */
function paSummaryOf(
  report: PassiveAuthenticationReport,
  anchorSource: string | null,
): Record<string, unknown> {
  return {
    integrity: report.integrity,
    integrityReason: report.integrityReason,
    revocation: report.revocation,
    revocationGap: report.revocationGap,
    dataGroups: report.dataGroups,
    hashAlgorithm: report.hashAlgorithm,
    signatureAlgorithm: report.signatureAlgorithm,
    anchor: report.anchor,
    anchorSource,
    dsc:
      report.dsc === null
        ? null
        : {
            country: report.dsc.country,
            notBefore: report.dsc.notBefore.toISOString(),
            notAfter: report.dsc.notAfter.toISOString(),
            embedded: report.dsc.embedded,
          },
    flags: [...report.flags],
  };
}

/** The chip read's sealed fields: DG1's, with the attributes' names. */
function chipReadFields(fields: NfcChipFields): Record<string, string | null> {
  return {
    'name-first': fields['name-first'],
    'name-last': fields['name-last'],
    birthdate: fields.birthdate,
    sex: fields.sex,
    'expiration-date': fields['expiration-date'],
    'identification-number': fields['identification-number'],
    nationality: fields.nationality,
    'issuing-country': fields['issuing-country'],
    'document-code': fields['document-code'],
    'id-class': fields['id-class'],
  };
}

async function evaluateChip(
  deps: ProcessVerificationDeps,
  job: TypeEvaluationJob,
  files: ChipFiles | null,
) {
  const { db } = deps;
  const challenge = await getSubmittedChipChallenge(db, job.environmentId, job.verificationId);
  const submission =
    challenge === null
      ? null
      : await openChipChallengeSubmission(db, job.environmentId, challenge.id);
  const trust = await loadTrustStore(db, { environmentKind: job.environmentKind });
  const pa =
    files === null
      ? null
      : verifyPassiveAuthentication(files, trust, {
          now: job.now,
          ...nfcPassiveAuthenticationOptions(job.config),
          issuerCountry: nfcIssuerCountry,
          selfTest: nfcSelfTest(deps.logger),
        });
  const dg1 = dg1Of(files);
  let aa: ActiveAuthenticationReport | null = null;
  if (files !== null && pa !== null) {
    const response =
      submission?.aaResponse == null || submission.nonce === null
        ? null
        : new Uint8Array(Buffer.from(submission.aaResponse, 'base64'));
    aa = verifyActiveAuthentication({
      dg15: files.dataGroups[15] ?? null,
      dg15Listed: pa.dataGroups[15] !== undefined && pa.dataGroups[15] !== 'not_listed',
      integrity: pa.integrity,
      nonce:
        response === null || submission?.nonce == null
          ? NO_NONCE
          : new Uint8Array(Buffer.from(submission.nonce, 'hex')),
      response,
      dg14: files.dataGroups[14] ?? null,
    });
  }
  const comparesFaces = isEnabled(job, SELFIE_CHECK);
  const selfie = comparesFaces
    ? await selfieReferenceOf(deps, job)
    : { reference: { kind: 'missing' } as const, embedded: null };
  const portrait = await chipPortraitOf(deps, job, files, pa, { face: comparesFaces, png: true });
  const established = pa?.integrity === 'established';
  const sodSignature = files === null || !established ? null : sodSignatureOf(files);
  const sightings =
    sodSignature === null || deps.blindIndexKey === undefined || !isEnabled(job, REPEAT_CHECK)
      ? null
      : await countChipSightings(db, job.environmentId, {
          inquiryId: job.inquiry.id,
          sodSignature,
          blindIndexKey: deps.blindIndexKey,
        });
  const input: GovernmentIdNfcCheckInput = {
    environment: job.environmentKind,
    passiveAuthentication: pa,
    activeAuthentication: aa,
    dg1,
    governmentIdStep: job.flow.steps.some((step) => step.type === 'government_id'),
    mrzReferences: isEnabled(job, 'id_nfc_mrz_comparison') ? await mrzReferencesOf(deps, job) : [],
    selfie: selfie.reference,
    chipPortrait: portrait.portrait,
    sightings,
    deviceReportedProtocols: deviceReportedProtocols(submission?.deviceReport ?? null),
    faceModels: faceModelsOf(portrait.embedded ?? selfie.embedded),
    now: job.now,
  };
  const chipFields = established && dg1 !== null ? nfcChipFields(dg1, job.now) : null;
  const anchorSource = pa?.anchor == null ? null : await trustAnchorSourceOf(db, pa.anchor.id);
  const state: GovernmentIdNfcDecisionState = {
    challengeId: challenge?.id ?? null,
    chipRead:
      pa === null || chipFields === null || sodSignature === null
        ? null
        : {
            fields: chipReadFields(chipFields),
            sodSignature,
            issuingCountry: chipFields['issuing-country'],
            paSummary: paSummaryOf(pa, anchorSource),
          },
    portrait: established ? portrait.png : null,
    replacedStorageKeys: [],
  };
  return { results: evaluateGovernmentIdNfcChecks(input, job.config), state };
}

export const governmentIdNfcJob: VerificationTypeJob<GovernmentIdNfcDecisionState> = {
  type: 'government_id_nfc',
  runnable: true,
  async evaluate(deps, job) {
    let files: ChipFiles | null = null;
    try {
      files = await loadChipFiles(deps, job.files);
      return await evaluateChip(deps, job, files);
    } catch (error) {
      if (error instanceof ChipFileUnreadableError) {
        throw new PermanentJobError(error.code);
      }
      throw error;
    } finally {
      wipeChipFiles(files);
    }
  },
  async persistInDecisionTx(tx, ctx) {
    const { state, environmentId, verificationId } = ctx;
    if (ctx.status !== 'submitted') {
      // C40.6: the inquiry and the verification are locked; the challenge and the read follow.
      if (state.challengeId !== null) {
        await markChipChallengeProcessed(tx, environmentId, state.challengeId);
      }
      const key = ctx.deps.blindIndexKey;
      if (state.chipRead !== null && key !== undefined) {
        const selfiePassed = ctx.results.some(
          (result) => result.name === SELFIE_CHECK && result.status === 'passed',
        );
        await writeChipRead(tx, environmentId, {
          verificationId,
          inquiryId: ctx.inquiry.id,
          ...state.chipRead,
          integrity: 'established',
          selfieBound: selfiePassed && (ctx.status === 'passed' || ctx.status === 'needs_review'),
          blindIndexKey: key,
          at: ctx.now,
        });
      }
      if (state.portrait !== null) {
        const stored = await storeServerFile(tx, ctx.deps, {
          environmentId,
          verificationId,
          kind: 'chip-portrait',
          bytes: state.portrait,
        });
        state.replacedStorageKeys.push(...stored.replacedStorageKeys);
      }
    }
    return ctx.verificationEvent();
  },
  async afterCommit(ctx) {
    const { state } = ctx;
    state.portrait?.fill(0);
    state.chipRead?.sodSignature.fill(0);
    for (const key of state.replacedStorageKeys) {
      await ctx.deps.storage.delete(key);
    }
  },
  async onProcessingFailed(tx, ctx) {
    const challenge = await getSubmittedChipChallenge(tx, ctx.environmentId, ctx.verificationId);
    if (challenge !== null) {
      // Decision 43: the AA response and the device report go with the processing.
      await markChipChallengeProcessed(tx, ctx.environmentId, challenge.id);
    }
    return [];
  },
};
