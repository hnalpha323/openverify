/**
 * The government ID evaluation of the `process-verification` job (Phase 3, C29-C35):
 *
 * 1. vision analyses the decrypted sides (C32); a failure follows the C30.3 rule (`attempts.ts`);
 * 2. the C31 extraction is built from the analysis with the checks package's parsers and
 *    `consolidateExtraction` (`extractGovernmentId`), which also establishes the class and issuer;
 * 3. the providers bound for the environment's kind answer the enabled A-tier checks (C35), the
 *    age estimator while the front is still decrypted;
 * 4. the C34 lookups gather the history (blind index and pHash bands; same-number extractions,
 *    their fronts re-embedded while the files exist), the inquiry's and account's fields, and the
 *    inquiry's newest selfie (re-embedded);
 * 5. every enabled §4.1 evaluator runs over one context, with the template's config, the flow
 *    step's allowlists, the environment kind (C30.7) and the pinned models (C29.2).
 *
 * The extraction is returned for the job to store in the transaction that writes the checks.
 * Extracted values, OCR text and embeddings stay in memory: they never reach a log, a check's
 * metadata or an error (C29.3, C31.6, C32.5).
 */
import { comparisonSourceFor } from '../flow-engine/initial-fields.js';
import {
  evaluateGovernmentIdChecks,
  extractGovernmentId,
  faceMatch,
  unreadableImageChecks,
  type GovernmentIdHistory,
  type GovernmentIdProviders as ProviderOutcomes,
  type GovernmentIdReferences,
  type InconsistentRepeatHistory,
  type ProviderOutcome,
  type RepeatHistory,
  type SelfieFace,
  type GovernmentIdExtraction as Extraction,
} from '@openverify/checks';
import {
  GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS,
  getCheckDefinition,
  type CheckId,
  type CheckResult,
  type ExtractedFields,
  type ExtractionFieldSources,
  type VerificationTemplateConfig,
} from '@openverify/core';
import {
  extractionIndexOf,
  findRepeatCandidates,
  findSameNumberExtractions,
  getAccount,
  idClassGroup,
  listInquiryVerifications,
  listVerificationFiles,
  type Db,
  type IdClass,
  type IdClassGroup,
  type Inquiry,
  type StoredFile,
} from '@openverify/db';
import type { Flow } from '@openverify/flow-spec';
import { unbuiltCompromisedIdLookup } from '../services/lists/compromised-ids.js';
import type {
  CompromisedIdAnswer,
  CompromisedIdLookup,
  EnvironmentKind,
  GovernmentIdAnalysis,
  GovernmentIdProviders,
  ProviderBindings,
  ProviderIdentity,
  VisionClient,
  VisionFace,
  VisionImage,
} from '../ports.js';
import { attemptProvider, attemptVision, type AttemptContext } from './attempts.js';
import { PermanentJobError } from './errors.js';
import { executionError, visionFailureChecks } from './execution-errors.js';
import { latestOfKind, readStoredImage, withImages, type ImageDeps } from './images.js';
import type { WorkerLogger } from './logger.js';
import { governmentIdModels } from './models.js';

/**
 * The checks a failed re-embedding leaves without evidence (C30.3): they read faces vision
 * re-embeds from stored files (an earlier front, the inquiry's selfie).
 */
export const REEMBEDDING_CHECKS = Object.freeze([
  'id_inconsistent_repeat_detection',
  'id_selfie_comparison',
] as const satisfies readonly CheckId[]);

/** Same-number extractions compared, newest first; each may cost a re-embedding (C31.9). */
export const INCONSISTENT_REPEAT_CANDIDATE_LIMIT = 5;

/**
 * The selfies `id_selfie_comparison` compares with (C43, amending C34): the latest that is
 * `passed`, `submitted` or `needs_review`; a failed attempt is never the reference.
 */
const COMPARED_SELFIE_STATUSES: ReadonlySet<string> = new Set([
  'submitted',
  'passed',
  'needs_review',
]);

export interface GovernmentIdDeps extends ImageDeps {
  db: Db;
  vision: VisionClient;
  logger: WorkerLogger;
  /** C31.8 blind index key; without it no index is written and the number lookups do not run. */
  blindIndexKey?: Uint8Array | undefined;
  providers?: ProviderBindings | undefined;
  /** C99.9 (Workflow 7B): the opted-in lists; absent, the check's input stays absent. */
  compromisedIds?: CompromisedIdLookup | undefined;
}

export interface GovernmentIdJob {
  environmentId: string;
  environmentKind: EnvironmentKind;
  inquiry: Inquiry;
  verificationId: string;
  flow: Flow;
  files: readonly StoredFile[];
  config: VerificationTemplateConfig;
  now: Date;
  lastAttempt: boolean;
  /**
   * Prepares the analysis for the evaluators (the C11 whole-image thresholds of Phase 2), and
   * finishes the results (their configured thresholds in metadata and provenance).
   */
  adjust?: {
    analysis(analysis: GovernmentIdAnalysis): GovernmentIdAnalysis;
    results(results: CheckResult[]): CheckResult[];
  };
}

/** The C31 extraction to store with the checks, and the document it establishes. */
export interface ExtractionToStore {
  fields: ExtractedFields;
  fieldSources: ExtractionFieldSources;
  identificationNumberIndex: string | null;
  frontPhash: string | null;
  idClassGroup: IdClassGroup;
  /** The verification's `country` and `id_class` where the user chose none (C31.5). */
  document: { country: string | null; idClass: IdClass | null };
}

export interface GovernmentIdEvaluation {
  results: CheckResult[];
  /** Vision could not read an upload: the Phase 1 `image_unreadable` results. */
  unreadable: boolean;
  /** `null` when no analysis ran. */
  extraction: ExtractionToStore | null;
}

const isEnabled = (config: VerificationTemplateConfig, checkId: CheckId): boolean =>
  config.checks[checkId]?.enabled === true;

/** A check's configured number, over its C29.5 default; `null` when neither sets it. */
function configuredNumber(
  config: VerificationTemplateConfig,
  checkId: CheckId,
  key: string,
): number | null {
  const parsed = getCheckDefinition(checkId)?.configSchema?.safeParse(
    config.checks[checkId]?.config ?? {},
  );
  const configured =
    parsed?.success === true ? (parsed.data as Record<string, unknown>)[key] : null;
  const fallback = GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS[checkId]?.[key];
  const value = configured ?? fallback;
  return typeof value === 'number' ? value : null;
}

const identityOf = (provider: ProviderIdentity) => ({ id: provider.id, sandbox: provider.sandbox });

/** Asks a bound provider under the C30.3 rule; `not_configured` without one. */
async function ask<Provider extends ProviderIdentity, Result>(
  provider: Provider | undefined,
  call: (provider: Provider) => Promise<Result>,
  context: AttemptContext,
): Promise<ProviderOutcome<Result>> {
  if (provider === undefined) {
    return { kind: 'not_configured' };
  }
  const answered = await attemptProvider(() => call(provider), context);
  return answered.ok
    ? { kind: 'result', provider: identityOf(provider), result: answered.value }
    : { kind: 'error' };
}

/** The C35 provider outcomes of the enabled A-tier checks. */
async function askProviders(
  deps: GovernmentIdDeps,
  job: GovernmentIdJob,
  scan: { analysis: GovernmentIdAnalysis; extraction: Extraction; front: VisionImage },
): Promise<ProviderOutcomes> {
  const bound: GovernmentIdProviders = deps.providers?.[job.environmentKind] ?? {};
  const fields = scan.extraction.consolidated.fields;
  const portrait = scan.analysis.sides.front.portrait;
  const context = (check: CheckId): AttemptContext => ({
    lastAttempt: job.lastAttempt,
    logger: deps.logger,
    log: { verificationId: job.verificationId, check },
  });
  const outcomes: ProviderOutcomes = {};
  if (isEnabled(job.config, 'id_aamva_database_lookup')) {
    const jurisdiction = scan.extraction.document.issuer?.jurisdiction ?? null;
    outcomes.aamva = await ask(
      bound.aamva,
      (provider) => provider.lookup({ jurisdiction, fields }),
      context('id_aamva_database_lookup'),
    );
  }
  if (isEnabled(job.config, 'id_public_figure_detection')) {
    outcomes.publicFigure = await ask(
      bound.publicFigure,
      (provider) => provider.match({ portrait, fields }),
      context('id_public_figure_detection'),
    );
  }
  if (isEnabled(job.config, 'id_age_inconsistency_detection')) {
    outcomes.ageEstimate = await ask(
      bound.ageEstimate,
      (provider) => provider.estimate({ front: scan.front, portrait, fields }),
      context('id_age_inconsistency_detection'),
    );
  }
  return outcomes;
}

/**
 * The face on a stored front or selfie, re-embedded through `/v1/embed/face`; `null` when the
 * file is gone or unreadable or shows no face, `'failed'` when vision failed for good (C30.3).
 * A government ID front is sent as a `document`, so vision embeds the portrait inside the card's
 * quad; a selfie is sent without a subject, as vision's default (K101).
 */
async function embedStored(
  deps: GovernmentIdDeps,
  file: StoredFile,
  context: AttemptContext,
): Promise<VisionFace | null | 'failed'> {
  const image = await readStoredImage(deps, file);
  if (image === null) {
    return null;
  }
  const subject = file.kind === 'front' ? 'document' : undefined;
  try {
    const embedded = await attemptVision(() => deps.vision.embedFace({ image, subject }), context);
    if (!embedded.ok) {
      return embedded.unreadable ? null : 'failed';
    }
    return embedded.value.face;
  } finally {
    image.bytes.fill(0);
  }
}

async function latestFile(
  deps: GovernmentIdDeps,
  environmentId: string,
  verificationId: string,
  kind: 'front' | 'selfie-center',
): Promise<StoredFile | undefined> {
  return latestOfKind(await listVerificationFiles(deps.db, environmentId, [verificationId]), kind);
}

interface LookupKeys {
  identificationNumberIndex: string | null;
  frontPhash: string | null;
  portrait: VisionFace | null;
}

/** C34 `id_repeat_detection`: the blind index and pHash band lookup, other accounts only. */
async function repeatHistory(
  deps: GovernmentIdDeps,
  job: GovernmentIdJob,
  keys: LookupKeys,
): Promise<RepeatHistory> {
  const maxPhashDistance = configuredNumber(
    job.config,
    'id_repeat_detection',
    'max-phash-distance',
  );
  const candidates = await findRepeatCandidates(deps.db, job.environmentId, {
    verificationId: job.verificationId,
    accountId: job.inquiry.accountId,
    identificationNumberIndex: keys.identificationNumberIndex,
    frontPhash: keys.frontPhash,
    maxPhashDistance,
  });
  return {
    identificationNumberLookup: keys.identificationNumberIndex !== null,
    phashLookup: maxPhashDistance !== null && keys.frontPhash !== null,
    candidates: candidates.map((candidate) => ({ ...candidate, sameAccount: false })),
  };
}

/**
 * C34 `id_inconsistent_repeat_detection`: earlier extractions with the same blind index, their
 * names and birth date decrypted, their fronts re-embedded while the files exist (C31.9).
 */
async function inconsistentRepeatHistory(
  deps: GovernmentIdDeps,
  job: GovernmentIdJob,
  keys: LookupKeys & { identificationNumberIndex: string },
  failed: Set<(typeof REEMBEDDING_CHECKS)[number]>,
): Promise<InconsistentRepeatHistory> {
  const earlier = await findSameNumberExtractions(deps.db, job.environmentId, {
    verificationId: job.verificationId,
    identificationNumberIndex: keys.identificationNumberIndex,
    limit: INCONSISTENT_REPEAT_CANDIDATE_LIMIT,
  });
  const context: AttemptContext = {
    lastAttempt: job.lastAttempt,
    logger: deps.logger,
    log: { verificationId: job.verificationId, check: 'id_inconsistent_repeat_detection' },
  };
  const candidates = [];
  for (const candidate of earlier) {
    let faceSimilarity: number | null = null;
    const front =
      keys.portrait === null || failed.has('id_inconsistent_repeat_detection')
        ? undefined
        : await latestFile(deps, job.environmentId, candidate.verificationId, 'front');
    if (keys.portrait !== null && front !== undefined) {
      const face = await embedStored(deps, front, context);
      if (face === 'failed') {
        failed.add('id_inconsistent_repeat_detection');
      } else if (face !== null) {
        faceSimilarity = faceMatch(keys.portrait.embedding, face.embedding).similarity;
      }
    }
    candidates.push({
      verificationId: candidate.verificationId,
      fields: candidate.fields,
      faceSimilarity,
    });
  }
  return { candidates };
}

/** C34: the inquiry's and account's fields, `null` when they hold none. */
async function referencesOf(
  deps: GovernmentIdDeps,
  job: GovernmentIdJob,
): Promise<GovernmentIdReferences> {
  const nonEmpty = (fields: Readonly<Record<string, unknown>> | null | undefined) =>
    fields == null || Object.keys(fields).length === 0 ? null : fields;
  const account = await getAccount(deps.db, job.environmentId, job.inquiry.accountId);
  // C149.4 (Workflow 9A Stage 1b (S)): a field's initial value when one exists (`api-flow-engine`),
  // and (Workflow 9B, api-flow-carry) where each came from, which the check records.
  const compared = await comparisonSourceFor(deps.db, job.inquiry);
  return {
    inquiryFields: nonEmpty(compared.fields),
    inquiryFieldSources: compared.sources,
    accountFields: nonEmpty(account?.fields),
  };
}

/**
 * C34 `id_selfie_comparison`: the face of the inquiry's latest passed, submitted or needs_review
 * selfie (C43), re-embedded; `null` when the inquiry has none yet (the default flow takes the ID
 * first).
 */
async function newestSelfie(
  deps: GovernmentIdDeps,
  job: GovernmentIdJob,
  failed: Set<(typeof REEMBEDDING_CHECKS)[number]>,
): Promise<SelfieFace | null> {
  const selfies = (
    await listInquiryVerifications(deps.db, job.environmentId, job.inquiry.id)
  ).filter(
    (verification) =>
      verification.type === 'selfie' && COMPARED_SELFIE_STATUSES.has(verification.status),
  );
  for (const selfie of [...selfies].reverse()) {
    const center = await latestFile(deps, job.environmentId, selfie.id, 'selfie-center');
    if (center === undefined) {
      continue;
    }
    const face = await embedStored(deps, center, {
      lastAttempt: job.lastAttempt,
      logger: deps.logger,
      log: { verificationId: job.verificationId, check: 'id_selfie_comparison' },
    });
    if (face === 'failed') {
      failed.add('id_selfie_comparison');
      return null;
    }
    return { face, verificationId: selfie.id };
  }
  return null;
}

/** C34 history of the enabled repeat checks. */
async function historyOf(
  deps: GovernmentIdDeps,
  job: GovernmentIdJob,
  keys: LookupKeys,
  failed: Set<(typeof REEMBEDDING_CHECKS)[number]>,
): Promise<GovernmentIdHistory> {
  const history: GovernmentIdHistory = {};
  if (isEnabled(job.config, 'id_repeat_detection')) {
    history.repeat = await repeatHistory(deps, job, keys);
  }
  const index = keys.identificationNumberIndex;
  if (isEnabled(job.config, 'id_inconsistent_repeat_detection') && index !== null) {
    history.inconsistentRepeat = await inconsistentRepeatHistory(
      deps,
      job,
      { ...keys, identificationNumberIndex: index },
      failed,
    );
  }
  return history;
}

/**
 * C99.9: the lists' answer for the extraction's number, or `null` with no number or no configured
 * list, when the check's input stays absent.
 */
async function lookUpCompromisedId(
  deps: GovernmentIdDeps,
  job: GovernmentIdJob,
  extracted: { identificationNumber: string | null; idClass: IdClass | null },
): Promise<CompromisedIdAnswer | null> {
  const { identificationNumber, idClass } = extracted;
  if (identificationNumber === null) {
    return null;
  }
  return (deps.compromisedIds ?? unbuiltCompromisedIdLookup).lookup({
    environmentId: job.environmentId,
    inquiryId: job.inquiry.id,
    verificationId: job.verificationId,
    identificationNumber,
    idClass,
  });
}

/**
 * Evaluates one government ID verification (C29-C35).
 * @throws {PermanentJobError} for a template without a government ID step or a verification
 * without a front, and when an upload cannot be decrypted.
 * @throws a vision or provider failure that a retry may cure, before the last attempt.
 */
export async function evaluateGovernmentIdVerification(
  deps: GovernmentIdDeps,
  job: GovernmentIdJob,
): Promise<GovernmentIdEvaluation> {
  const step = job.flow.steps.find((candidate) => candidate.type === 'government_id');
  const front = latestOfKind(job.files, 'front');
  const back = latestOfKind(job.files, 'back');
  if (step?.type !== 'government_id') {
    throw new PermanentJobError('invalid_template');
  }
  if (front === undefined) {
    throw new PermanentJobError('missing_front');
  }
  const scanned = await withImages(
    deps,
    back === undefined ? [front] : [front, back],
    async ([frontImage, backImage]) => {
      const analysis = await attemptVision(
        () => deps.vision.analyzeGovernmentId({ front: frontImage, back: backImage }),
        {
          lastAttempt: job.lastAttempt,
          logger: deps.logger,
          log: { verificationId: job.verificationId },
        },
      );
      if (!analysis.ok) {
        return { failure: analysis };
      }
      const extraction = extractGovernmentId(analysis.value, { now: job.now });
      const providers = await askProviders(deps, job, {
        analysis: analysis.value,
        extraction,
        front: frontImage,
      });
      return { analysis: analysis.value, extraction, providers };
    },
  );
  if ('failure' in scanned) {
    return {
      results: scanned.failure.unreadable
        ? unreadableImageChecks('government_id', job.config)
        : visionFailureChecks(job.config),
      unreadable: scanned.failure.unreadable,
      extraction: null,
    };
  }

  const { analysis, extraction, providers } = scanned;
  const { fields, fieldSources } = extraction.consolidated;
  const classGroup = idClassGroup(extraction.document.idClass);
  const keys: LookupKeys = {
    identificationNumberIndex:
      deps.blindIndexKey === undefined
        ? null
        : extractionIndexOf(deps.blindIndexKey, {
            environmentId: job.environmentId,
            fields,
            classGroup,
          }),
    frontPhash: analysis.sides.front.phash,
    portrait: analysis.sides.front.portrait,
  };
  const failed = new Set<(typeof REEMBEDDING_CHECKS)[number]>();
  const history = await historyOf(deps, job, keys, failed);
  const compares =
    isEnabled(job.config, 'id_inquiry_comparison') ||
    isEnabled(job.config, 'id_account_comparison');
  const references = compares ? await referencesOf(deps, job) : undefined;
  const selfie = isEnabled(job.config, 'id_selfie_comparison')
    ? await newestSelfie(deps, job, failed)
    : undefined;

  // C99.9 (Workflow 7B; H09): the opted-in lists; `null` leaves the input absent, as today.
  const compromisedList = await lookUpCompromisedId(deps, job, {
    identificationNumber: fields['identification-number'],
    idClass: extraction.document.idClass,
  });

  const results = evaluateGovernmentIdChecks(
    {
      analysis: job.adjust?.analysis(analysis) ?? analysis,
      requiredSides: step.sides,
      uploads: {
        front: { sha256: front.sha256 },
        back: back === undefined ? null : { sha256: back.sha256 },
      },
      extraction,
      environment: job.environmentKind,
      now: job.now,
      step: { allowedCountries: step.allowedCountries, allowedIdClasses: step.allowedIdClasses },
      history,
      ...(references === undefined ? {} : { references }),
      ...(selfie === undefined ? {} : { selfie }),
      ...(compromisedList === null ? {} : { compromisedList }),
      providers,
      models: governmentIdModels(analysis.model_versions),
    },
    job.config,
  ).map((result) =>
    (failed as ReadonlySet<string>).has(result.name) ? executionError(result) : result,
  );

  return {
    results: job.adjust?.results(results) ?? results,
    unreadable: false,
    extraction: {
      fields,
      fieldSources,
      identificationNumberIndex: keys.identificationNumberIndex,
      frontPhash: keys.frontPhash,
      idClassGroup: classGroup,
      document: {
        country: extraction.document.issuer?.country ?? null,
        idClass: extraction.document.idClass,
      },
    },
  };
}
