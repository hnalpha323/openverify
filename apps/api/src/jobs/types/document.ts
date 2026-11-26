/**
 * C60, C54.1: the `document` job (`api-document`).
 *
 * - `evaluate` decrypts the verification's latest `document` upload (checked against its stored
 *   SHA-256 and typed by its content, C52.4) and sends it to vision's `/v1/analyze/document` as the
 *   type it is (a PDF, or a photo of a document). A refusal (413, 415, 422 with or without
 *   `pdf_encrypted`, `pdf_unprocessable` or `too_many_pages`) is the user's to fix: the type check
 *   answers its user-behaviour failure (`documentVisionRefusalOf`). An outage or a guarded worker
 *   failure (503) is retried while BullMQ has attempts left, then recorded as `execution_error`, as
 *   is at once an answer that breaks the contract (C30.3); the verification then goes to review.
 *   After an analysis, vision renders page 1 for the preview (C60.4); a render outage is retried
 *   the same way, and on the last attempt, or when vision cannot render the page for good, the
 *   decision stands without a preview (the console then has none to show; nothing is invented).
 *   The checks run over the analysis, the step's classes and the references the name and address
 *   are compared with (C60.6): the inquiry's fields, else the latest passed or reviewed government
 *   ID's extraction of the inquiry, else the account's fields.
 * - `persistInDecisionTx`, under the decision's locks (the inquiry checked unredacted first,
 *   C40.6), writes the extraction (`document_extractions`: the class, its confidence, the page
 *   count, the media type and the extracted fields sealed to the row) and stores the preview
 *   through `storeServerFile`, which replaces the kind's earlier file, so every run leaves one;
 *   then it stages the verification event, whose payload carries the extraction.
 * - `afterCommit` deletes the replaced previews' objects.
 * - `onProcessingFailed` has nothing to close: a document has no sub-resource.
 *
 * Extracted values (PII) never reach a log or check metadata: logs carry ids, the endpoint, the
 * error class and vision's status and problem code; results carry classes, levels, flags, counts
 * and field names. The decrypted upload is wiped after the vision calls.
 */
import { createHash } from 'node:crypto';
import {
  documentVisionRefusalOf,
  evaluateDocument,
  type DocumentModels,
  type DocumentReading,
  type DocumentReference,
  type DocumentReferences,
  type DocumentVisionRefusal,
} from '@openverify/checks';
import { detectUploadMimeType, stepForVerificationType } from '@openverify/contracts';
import type { CheckId, CheckModel, VerificationTemplateConfig } from '@openverify/core';
import {
  decryptBytes,
  getAccount,
  listGovernmentIdExtractions,
  listInquiryVerifications,
  putDocumentExtraction,
  type DocumentMimeType,
  type StoredFile,
} from '@openverify/db';
import type { DocumentAnalysis, VisionDocument } from '../../ports.js';
import { servedDocumentFields } from '../../services/attributes/document.js';
import { deleteObjects } from '../../services/selfie-captures.js';
import { storeServerFile } from '../../services/server-files.js';
import { VisionError, VisionServiceError } from '../../vision/index.js';
import { PermanentJobError } from '../errors.js';
import { latestOfKind } from '../images.js';
import { MODEL_DIGESTS } from '../models.js';
import type { ProcessVerificationDeps } from '../process-verification.js';
import type { TypeEvaluationJob, VerificationTypeJob } from './index.js';

/** What the decision hooks need. */
export interface DocumentDecisionState {
  /** What `document_extractions` stores; `null` when vision did not analyse the document. */
  extraction: { reading: DocumentReading; mimeType: DocumentMimeType } | null;
  /** Page 1 as vision rendered it (a PNG), or `null` when there is none. */
  preview: Uint8Array | null;
  /** Objects of the previews the decision replaced, deleted once it committed. */
  replacedStorageKeys: string[];
}

/** vision's answer about the document, as the job reads it. */
type DocumentVisionAnswer =
  | { kind: 'analysis'; analysis: DocumentAnalysis }
  | { kind: 'refused'; refusal: DocumentVisionRefusal }
  | { kind: 'error' };

/** The statuses vision answers for a document it will not read (C60.1): the user's to fix. */
const REFUSAL_STATUSES: ReadonlySet<number> = new Set([413, 415, 422]);

/** The checks that read the references. */
const COMPARISON_CHECKS: readonly CheckId[] = [
  'document_name_comparison',
  'document_address_comparison',
];

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/**
 * The decrypted upload, typed by its content.
 * @throws {PermanentJobError} `file_missing`, `file_undecryptable`, `file_integrity` or
 * `file_type`: retrying cannot bring a file back.
 */
async function decryptDocument(
  deps: ProcessVerificationDeps,
  file: StoredFile,
): Promise<VisionDocument> {
  const ciphertext = await deps.storage.get(file.storageKey);
  if (ciphertext === null) {
    throw new PermanentJobError('file_missing');
  }
  let bytes: Buffer;
  try {
    bytes = decryptBytes({ wrappedDek: file.wrappedDek, ciphertext }, deps.keyring, {
      context: file.id,
    });
  } catch {
    throw new PermanentJobError('file_undecryptable');
  }
  const mimeType = detectUploadMimeType('document', bytes);
  const intact = sha256(bytes) === file.sha256;
  if (!intact || mimeType === null || mimeType === 'application/octet-stream') {
    bytes.fill(0);
    throw new PermanentJobError(intact ? 'file_type' : 'file_integrity');
  }
  return { bytes, mimeType };
}

/** A vision failure as the logs name it: never a body, a value or a document. */
function failureOf(error: VisionError) {
  return {
    endpoint: error.endpoint,
    error: error.name,
    status: error instanceof VisionServiceError ? error.status : null,
    code: error instanceof VisionServiceError ? error.code : null,
  };
}

/** `/v1/analyze/document` under the C30.3 rule, its refusals mapped for the type check. */
async function analyse(
  deps: ProcessVerificationDeps,
  job: TypeEvaluationJob,
  document: VisionDocument,
): Promise<DocumentVisionAnswer> {
  try {
    return { kind: 'analysis', analysis: await deps.vision.analyzeDocument({ document }) };
  } catch (error) {
    if (error instanceof VisionServiceError && REFUSAL_STATUSES.has(error.status)) {
      return { kind: 'refused', refusal: documentVisionRefusalOf(error.status, error.code) };
    }
    if (error instanceof VisionError && (!error.retryable || job.lastAttempt)) {
      deps.logger.warn(
        { verificationId: job.verificationId, ...failureOf(error) },
        'vision could not analyse the document for good; its checks are recorded as execution_error',
      );
      return { kind: 'error' };
    }
    throw error;
  }
}

/**
 * Page 1 as a PNG for the preview (C60.4); `null` when vision cannot render it for good, or on
 * the last attempt. An outage is rethrown while attempts remain.
 */
async function renderPreview(
  deps: ProcessVerificationDeps,
  job: TypeEvaluationJob,
  document: VisionDocument,
): Promise<Uint8Array | null> {
  try {
    return await deps.vision.renderDocumentPage({ document, page: 1 });
  } catch (error) {
    if (!(error instanceof VisionError) || (error.retryable && !job.lastAttempt)) {
      throw error;
    }
    deps.logger.warn(
      { verificationId: job.verificationId, ...failureOf(error) },
      'vision did not render the document preview; the decision stands without one',
    );
    return null;
  }
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

/** A reference from inquiry or account fields (the snake_case keys of the fields schemas). */
function fieldsReference(fields: Readonly<Record<string, unknown>>): DocumentReference {
  return {
    name: {
      first: text(fields.name_first),
      middle: text(fields.name_middle),
      last: text(fields.name_last),
    },
    address: {
      street1: text(fields.address_street_1),
      street2: text(fields.address_street_2),
      city: text(fields.address_city),
      subdivision: text(fields.address_subdivision),
      postalCode: text(fields.address_postal_code),
      countryCode: text(fields.address_country_code),
    },
  };
}

/**
 * The extraction of the inquiry's latest government ID that passed or went to review (C60.6); a
 * failed one is never a reference, since its reading may be what failed.
 */
async function governmentIdReference(
  deps: ProcessVerificationDeps,
  job: TypeEvaluationJob,
): Promise<DocumentReference | null> {
  const decided = (await listInquiryVerifications(deps.db, job.environmentId, job.inquiry.id))
    .filter(
      (verification) =>
        verification.type === 'government_id' &&
        (verification.status === 'passed' || verification.status === 'needs_review'),
    )
    .map((verification) => verification.id);
  const extractions = await listGovernmentIdExtractions(deps.db, job.environmentId, decided);
  for (const id of decided.reverse()) {
    const fields = extractions.get(id)?.fields;
    if (fields != null) {
      return {
        name: {
          first: fields['name-first'],
          middle: fields['name-middle'],
          last: fields['name-last'],
        },
        address: {
          street1: fields['address-street-1'],
          street2: fields['address-street-2'],
          city: fields['address-city'],
          subdivision: fields['address-subdivision'],
          postalCode: fields['address-postal-code'],
          countryCode: fields['address-country-code'],
        },
      };
    }
  }
  return null;
}

/** C60.6: the references, in the order the comparisons read them. */
async function referencesOf(
  deps: ProcessVerificationDeps,
  job: TypeEvaluationJob,
): Promise<DocumentReferences> {
  const account = await getAccount(deps.db, job.environmentId, job.inquiry.accountId);
  return {
    inquiry: fieldsReference(job.inquiry.fields),
    governmentId: await governmentIdReference(deps, job),
    account: fieldsReference(account?.fields ?? {}),
  };
}

/** The model `id` pinned by its digest in `models/manifest.json`, or `undefined` (C29.2). */
function pinnedModel(id: string | null): CheckModel | undefined {
  const digest = id !== null && Object.hasOwn(MODEL_DIGESTS, id) ? MODEL_DIGESTS[id] : undefined;
  return id === null || digest === undefined ? undefined : { id, sha256: digest.sha256 };
}

/** The OCR models vision names in its answer, pinned. */
function modelsOf(answer: DocumentVisionAnswer | null): DocumentModels | undefined {
  if (answer?.kind !== 'analysis') {
    return undefined;
  }
  const versions = answer.analysis.model_versions;
  return {
    textDetector: pinnedModel(versions.text_detector),
    textRecognizer: pinnedModel(versions.text_recognizer),
  };
}

const comparesAny = (config: VerificationTemplateConfig): boolean =>
  COMPARISON_CHECKS.some((check) => config.checks[check]?.enabled === true);

export const documentJob: VerificationTypeJob<DocumentDecisionState> = {
  type: 'document',
  runnable: true,
  async evaluate(deps, job) {
    const step = stepForVerificationType(job.flow, 'document');
    const upload = latestOfKind(job.files, 'document');
    let answer: DocumentVisionAnswer | null = null;
    let preview: Uint8Array | null = null;
    let mimeType: DocumentMimeType | null = null;
    if (upload !== undefined) {
      const document = await decryptDocument(deps, upload);
      try {
        answer = await analyse(deps, job, document);
        preview = answer.kind === 'analysis' ? await renderPreview(deps, job, document) : null;
        mimeType = document.mimeType;
      } finally {
        document.bytes.fill(0);
      }
    }
    const references = comparesAny(job.config) ? await referencesOf(deps, job) : undefined;
    const models = modelsOf(answer);
    const { results, reading } = evaluateDocument(
      {
        vision: answer,
        acceptedTypes: step?.type === 'document' ? step.documentTypes : [],
        ...(references === undefined ? {} : { references }),
        ...(models === undefined ? {} : { models }),
        now: job.now,
      },
      job.config,
    );
    return {
      results,
      state: {
        extraction: reading === null || mimeType === null ? null : { reading, mimeType },
        preview,
        replacedStorageKeys: [],
      },
    };
  },
  async persistInDecisionTx(tx, ctx) {
    const { extraction, preview } = ctx.state;
    if (extraction !== null) {
      const { reading, mimeType } = extraction;
      await putDocumentExtraction(tx, ctx.environmentId, {
        verificationId: ctx.verificationId,
        inquiryId: ctx.inquiry.id,
        documentType: reading.documentType,
        typeConfidence: reading.typeConfidence,
        fields: servedDocumentFields(reading.fields),
        pageCount: reading.pageCount,
        mimeType,
      });
    }
    if (preview !== null) {
      const stored = await storeServerFile(tx, ctx.deps, {
        environmentId: ctx.environmentId,
        verificationId: ctx.verificationId,
        kind: 'document-preview',
        bytes: preview,
      });
      ctx.state.replacedStorageKeys.push(...stored.replacedStorageKeys);
    }
    return ctx.verificationEvent();
  },
  async afterCommit(ctx) {
    ctx.state.preview?.fill(0);
    const failed = await deleteObjects(ctx.deps.storage, ctx.state.replacedStorageKeys);
    if (failed > 0) {
      ctx.deps.logger.warn(
        { verificationId: ctx.verificationId, failed },
        'replaced document preview objects were not deleted; they are unreadable without their rows',
      );
    }
  },
  onProcessingFailed: () => Promise.resolve([]),
};
