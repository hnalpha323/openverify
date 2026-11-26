/**
 * Verification resources: the full view for the server API, dashboard and webhooks (with
 * `checks`), and the reduced flow view for the hosted flow and Android, which only ever sees
 * status and user-facing retry hints, never fraud check details (contracts C2, C3).
 */
import {
  EXTRACTION_FIELDS,
  checkCategorySchema,
  checkIdSchema,
  extractedFieldsSchema,
  extractionFieldSourcesSchema,
  checkProvenanceSchema,
  checkStageSchema,
  checkStatusSchema,
  getCheckDefinition,
  idClassSchema,
  isCheckId,
  reasonCodeSchema,
  verificationStatusSchema,
  type CheckId,
  type CheckProvenance,
  type CheckStage,
  type CheckStatus,
  type ExtractedFields,
  type ExtractionField,
  type ExtractionFieldSources,
  type IdClass,
  type VerificationStatus,
  selfieCaptureMethodSchema,
} from '@openverify/core';
import { countryCodeSchema } from '@openverify/flow-spec';
import { z } from 'zod';
import { fileResourceSchema } from './files.js';
import {
  fileIdentifierSchema,
  inquiryIdentifierSchema,
  transactionIdentifierSchema,
} from './identifiers.js';
import {
  selfieCaptureIdentifierSchema,
  selfieCaptureResourceSchema,
  selfiePoseSchema,
} from './selfie-captures.js';
import {
  selfieVerificationAttributes,
  type SelfieVerificationCapture,
} from './selfie-verification-attributes.js';
import {
  AAMVA_VERIFICATION_ATTRIBUTES,
  BUSINESS_WEBSITE_VERIFICATION_ATTRIBUTES,
  CRYPTO_WALLET_VERIFICATION_ATTRIBUTES,
  DATABASE_BUSINESS_VERIFICATION_ATTRIBUTES,
  DATABASE_VERIFICATION_ATTRIBUTES,
  DOCUMENT_VERIFICATION_ATTRIBUTES,
  EMAIL_ADDRESS_VERIFICATION_ATTRIBUTES,
  FLOW_AAMVA_ATTRIBUTES,
  FLOW_BUSINESS_WEBSITE_ATTRIBUTES,
  FLOW_CRYPTO_WALLET_ATTRIBUTES,
  FLOW_DATABASE_ATTRIBUTES,
  FLOW_DATABASE_BUSINESS_ATTRIBUTES,
  FLOW_DOCUMENT_ATTRIBUTES,
  FLOW_EMAIL_ADDRESS_ATTRIBUTES,
  FLOW_GOVERNMENT_ID_NFC_ATTRIBUTES,
  FLOW_PHONE_NUMBER_ATTRIBUTES,
  GOVERNMENT_ID_NFC_VERIFICATION_ATTRIBUTES,
  PHONE_NUMBER_VERIFICATION_ATTRIBUTES,
} from './verification-attributes.js';
import {
  resourceSchema,
  resourceWithRelationshipsSchema,
  singleDocumentSchema,
  timestampSchema,
  toManyRelationshipSchema,
  toOneRelationshipSchema,
  toTimestamp,
} from './json-api.js';
import {
  checkRequirementFor,
  checkRequirementSchema,
  toVerificationResourceType,
  type CheckRequirement,
  type SupportedVerificationType,
  type VerificationResourceType,
} from './verification-types.js';

/**
 * One check outcome on a verification (C2, C29.2). `metadata` holds scores, never PII or
 * embeddings. `stage`, `confidence` and `provenance` are optional so earlier answers still
 * parse; servers send all three (a row stored before Phase 3 has the registry's stage and `null`
 * for the other two).
 */
export const verificationCheckSchema = z.strictObject({
  name: checkIdSchema,
  status: checkStatusSchema,
  reasons: z.array(reasonCodeSchema),
  requirement: checkRequirementSchema,
  metadata: z.record(z.string(), z.unknown()),
  stage: checkStageSchema.optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  provenance: checkProvenanceSchema.nullable().optional(),
  /**
   * C50.8: what the check describes (`biometrics`, `fraud`, `user_action_required`,
   * `validity`), derived from the registry at read time. Optional so earlier answers parse.
   */
  category: checkCategorySchema.optional(),
});
export type VerificationCheck = z.infer<typeof verificationCheckSchema>;

/** Checks of one verification type, each reported once. */
function checksSchema(type: SupportedVerificationType) {
  return z.array(verificationCheckSchema).superRefine((checks, ctx) => {
    const seen = new Set<string>();
    checks.forEach((check, index) => {
      if (seen.has(check.name)) {
        ctx.addIssue({
          code: 'custom',
          message: `check "${check.name}" is reported twice`,
          path: [index, 'name'],
        });
      }
      seen.add(check.name);
      const owner = getCheckDefinition(check.name)?.verificationType;
      if (owner !== type) {
        ctx.addIssue({
          code: 'custom',
          message: `check "${check.name}" belongs to ${String(owner)} verifications`,
          path: [index, 'name'],
        });
      }
    });
  });
}

const timestamps = {
  'created-at': timestampSchema,
  'updated-at': timestampSchema,
  /** C173.2 (Workflow 9B; K17): when the verification was redacted, `null` before. Left out before. */
  'redacted-at': timestampSchema.nullable().optional(),
};

/**
 * C96.3: what every verification carries beside its type's attributes. `from-rejected-handoff` says
 * the phone created it on a handoff the desktop rejected. It is not PII, so it is not masked, and it
 * never reaches the flow view. Optional so earlier answers still parse; servers send it.
 */
const handoffOrigin = {
  'from-rejected-handoff': z.boolean().optional(),
};

/**
 * The C31.5 extraction attributes of a government ID: PII (C31.6), so masked for API keys stored
 * `pii-masked` and users without `pii:view`, `null` after redaction, and never on the flow API.
 * Optional so earlier answers still parse; servers send every one, `null` when not read.
 */
export const GOVERNMENT_ID_EXTRACTION_ATTRIBUTES: readonly ExtractionField[] = Object.freeze([
  ...EXTRACTION_FIELDS,
]);

const extractionAttributes = Object.fromEntries(
  EXTRACTION_FIELDS.map((field) => [
    field,
    // C53.7: marked PII, so PII_VERIFICATION_ATTRIBUTES names it.
    extractedFieldsSchema.shape[field].optional().meta({ pii: true }),
  ]),
) as {
  [Field in ExtractionField]: z.ZodOptional<(typeof extractedFieldsSchema.shape)[Field]>;
};

export const governmentIdVerificationAttributesSchema = z.strictObject({
  status: verificationStatusSchema,
  /** ISO 3166-1 alpha-2 issuing country, when the user chose or the ID revealed it. */
  country: countryCodeSchema.nullable(),
  'id-class': idClassSchema.nullable(),
  checks: checksSchema('government_id'),
  ...extractionAttributes,
  /**
   * Per field, the sources that agreed (C31.5), for example `{"birthdate": ["mrz", "viz"]}`.
   * Field names only, so not masked; `null` when nothing was extracted.
   */
  'extraction-sources': extractionFieldSourcesSchema.nullable().optional(),
  ...handoffOrigin,
  ...timestamps,
});

/** A cosine or score rounded to 4 decimals (C40.10). */
const score = z.number().min(-1).max(1);
/** A corner of the centre face box, normalised to [0, 1] of the image. */
const unitPoint = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);

export const selfieVerificationAttributesSchema = z.strictObject({
  status: verificationStatusSchema,
  checks: checksSchema('selfie'),
  /**
   * C40.10, each nullable and not PII (so never masked), derived at read time from the check
   * metadata (`similarity`, `liveness-score`, `face-cosines`, `face-box`), so redaction nulls them.
   * Optional so earlier answers still parse. The flow API never shows them.
   */
  'capture-method': selfieCaptureMethodSchema.nullable().optional(),
  liveness: z.enum(['passive', 'active']).nullable().optional(),
  /** The processed capture's prompts. */
  poses: z.array(selfiePoseSchema).nullable().optional(),
  /** SFace cosine of the centre face to the ID portrait `selfie_id_comparison` used. */
  'document-similarity-score': score.nullable().optional(),
  /** Each side face's SFace cosine to the centre face. */
  'selfie-similarity-score-left': score.nullable().optional(),
  'selfie-similarity-score-right': score.nullable().optional(),
  /** The centre's passive mean P(real). */
  'liveness-score': z.number().min(0).max(1).nullable().optional(),
  /** The centre face box: top-left, top-right, bottom-right, bottom-left, in [0, 1]. */
  'center-photo-face-coordinates': z
    .tuple([unitPoint, unitPoint, unitPoint, unitPoint])
    .nullable()
    .optional(),
  ...handoffOrigin,
  ...timestamps,
});

export const verificationRelationshipsSchema = z.strictObject({
  inquiry: toOneRelationshipSchema(inquiryIdentifierSchema),
  files: toManyRelationshipSchema(fileIdentifierSchema),
  /** C40.1: a selfie verification's captures, newest first. Optional so earlier answers parse. */
  selfies: toManyRelationshipSchema(selfieCaptureIdentifierSchema).optional(),
  /** C105.7 (Workflow 7B): the latest transaction it was attached to by `add-objects`. */
  transaction: toOneRelationshipSchema(transactionIdentifierSchema.nullable()).optional(),
});

export const governmentIdVerificationResourceSchema = resourceWithRelationshipsSchema(
  'verification/government-id',
  'ver',
  governmentIdVerificationAttributesSchema,
  verificationRelationshipsSchema,
);

export const selfieVerificationResourceSchema = resourceWithRelationshipsSchema(
  'verification/selfie',
  'ver',
  selfieVerificationAttributesSchema,
  verificationRelationshipsSchema,
);

/**
 * C50.6: a Phase 5 type's full resource. Its type attributes (C52.8) come from
 * `verification-attributes.ts`; every one is optional, so a server before the type's job sends
 * status, checks and timestamps only.
 */
function phase5ResourceSchema<
  const Type extends VerificationResourceType,
  const Shape extends z.ZodRawShape,
>(type: Type, domain: SupportedVerificationType, attributes: Shape) {
  return resourceWithRelationshipsSchema(
    type,
    'ver',
    z.strictObject({
      status: verificationStatusSchema,
      checks: checksSchema(domain),
      ...attributes,
      ...handoffOrigin,
      ...timestamps,
    }),
    verificationRelationshipsSchema,
  );
}

export const documentVerificationResourceSchema = phase5ResourceSchema(
  'verification/document',
  'document',
  DOCUMENT_VERIFICATION_ATTRIBUTES,
);
export const databaseVerificationResourceSchema = phase5ResourceSchema(
  'verification/database',
  'database',
  DATABASE_VERIFICATION_ATTRIBUTES,
);
export const aamvaVerificationResourceSchema = phase5ResourceSchema(
  'verification/aamva',
  'aamva',
  AAMVA_VERIFICATION_ATTRIBUTES,
);
export const phoneNumberVerificationResourceSchema = phase5ResourceSchema(
  'verification/phone-number',
  'phone_number',
  PHONE_NUMBER_VERIFICATION_ATTRIBUTES,
);
export const emailAddressVerificationResourceSchema = phase5ResourceSchema(
  'verification/email-address',
  'email_address',
  EMAIL_ADDRESS_VERIFICATION_ATTRIBUTES,
);
export const governmentIdNfcVerificationResourceSchema = phase5ResourceSchema(
  'verification/government-id-nfc',
  'government_id_nfc',
  GOVERNMENT_ID_NFC_VERIFICATION_ATTRIBUTES,
);
export const cryptoWalletVerificationResourceSchema = phase5ResourceSchema(
  'verification/crypto-wallet',
  'crypto_wallet',
  CRYPTO_WALLET_VERIFICATION_ATTRIBUTES,
);
export const databaseBusinessVerificationResourceSchema = phase5ResourceSchema(
  'verification/database-business',
  'database_business',
  DATABASE_BUSINESS_VERIFICATION_ATTRIBUTES,
);
export const businessWebsiteVerificationResourceSchema = phase5ResourceSchema(
  'verification/business-website',
  'business_website',
  BUSINESS_WEBSITE_VERIFICATION_ATTRIBUTES,
);

/**
 * Every verification resource schema, one per type in {@link VERIFICATION_RESOURCE_TYPES} order
 * (C50.6): spread into each union that carries verifications, so none meets an unknown type.
 */
export const VERIFICATION_RESOURCE_SCHEMAS = [
  governmentIdVerificationResourceSchema,
  selfieVerificationResourceSchema,
  documentVerificationResourceSchema,
  databaseVerificationResourceSchema,
  aamvaVerificationResourceSchema,
  phoneNumberVerificationResourceSchema,
  emailAddressVerificationResourceSchema,
  governmentIdNfcVerificationResourceSchema,
  cryptoWalletVerificationResourceSchema,
  databaseBusinessVerificationResourceSchema,
  businessWebsiteVerificationResourceSchema,
] as const;

export const verificationResourceSchema = z.discriminatedUnion(
  'type',
  VERIFICATION_RESOURCE_SCHEMAS,
);
export type VerificationResource = z.infer<typeof verificationResourceSchema>;

/**
 * `GET /api/v1/verifications/:id`; may include the verification's files and, with
 * `?include=selfies` (C40.1), a selfie verification's captures, newest first.
 */
export const verificationDocumentSchema = z.strictObject({
  data: verificationResourceSchema,
  included: z.array(z.union([fileResourceSchema, selfieCaptureResourceSchema])).optional(),
});
export type VerificationDocument = z.infer<typeof verificationDocumentSchema>;

/**
 * C40.1: what `GET /api/v1/verifications/:id` can include; C173.2 (Workflow 9B; K17): `files`, the
 * verification's file resources (metadata only, the existing file contract).
 */
export const VERIFICATION_INCLUDES = ['selfies', 'files'] as const;

/** `GET /api/v1/verifications/:id` query. */
export const getVerificationQuerySchema = z.strictObject({
  include: z.enum(VERIFICATION_INCLUDES).optional(),
});

/** A user-fixable reason a verification failed, shown by the flow as a retry hint. */
export const retryHintSchema = z
  .strictObject({ name: checkIdSchema, reasons: z.array(reasonCodeSchema) })
  .refine((hint) => getCheckDefinition(hint.name)?.checkType === 'user_behavior', {
    message: 'retry hints may only name user_behavior checks',
    path: ['name'],
  });
export type RetryHint = z.infer<typeof retryHintSchema>;

/** The parts of a check outcome that decide whether it becomes a retry hint. */
export interface CheckOutcome {
  name: string;
  status: CheckStatus;
  reasons: readonly string[];
  requirement: CheckRequirement;
}

/**
 * Retry hints for a verification: failed, required `user_behavior` checks only. Fraud checks
 * never reach the client, so their outcome cannot be probed by retrying.
 */
export function retryHintsFromChecks(checks: readonly CheckOutcome[]): RetryHint[] {
  return checks
    .filter(
      (check): check is CheckOutcome & { name: CheckId } =>
        check.status === 'failed' &&
        check.requirement === 'required' &&
        isCheckId(check.name) &&
        getCheckDefinition(check.name)?.checkType === 'user_behavior',
    )
    .map((check) => ({ name: check.name, reasons: [...check.reasons] }));
}

export const flowVerificationAttributesSchema = z.strictObject({
  status: verificationStatusSchema,
  'retry-hints': z.array(retryHintSchema),
  ...timestamps,
});

export const flowGovernmentIdVerificationResourceSchema = resourceSchema(
  'verification/government-id',
  'ver',
  flowVerificationAttributesSchema,
);

export const flowSelfieVerificationResourceSchema = resourceSchema(
  'verification/selfie',
  'ver',
  flowVerificationAttributesSchema,
);

/** C50.6: a Phase 5 type's flow view, with the type's guidance (C52.2) once it is defined. */
function flowPhase5ResourceSchema<
  const Type extends VerificationResourceType,
  const Shape extends z.ZodRawShape,
>(type: Type, attributes: Shape) {
  return resourceSchema(
    type,
    'ver',
    z.strictObject({
      status: verificationStatusSchema,
      'retry-hints': z.array(retryHintSchema),
      ...attributes,
      ...timestamps,
    }),
  );
}

export const flowDocumentVerificationResourceSchema = flowPhase5ResourceSchema(
  'verification/document',
  FLOW_DOCUMENT_ATTRIBUTES,
);
export const flowDatabaseVerificationResourceSchema = flowPhase5ResourceSchema(
  'verification/database',
  FLOW_DATABASE_ATTRIBUTES,
);
export const flowAamvaVerificationResourceSchema = flowPhase5ResourceSchema(
  'verification/aamva',
  FLOW_AAMVA_ATTRIBUTES,
);
export const flowPhoneNumberVerificationResourceSchema = flowPhase5ResourceSchema(
  'verification/phone-number',
  FLOW_PHONE_NUMBER_ATTRIBUTES,
);
export const flowEmailAddressVerificationResourceSchema = flowPhase5ResourceSchema(
  'verification/email-address',
  FLOW_EMAIL_ADDRESS_ATTRIBUTES,
);
export const flowGovernmentIdNfcVerificationResourceSchema = flowPhase5ResourceSchema(
  'verification/government-id-nfc',
  FLOW_GOVERNMENT_ID_NFC_ATTRIBUTES,
);
export const flowCryptoWalletVerificationResourceSchema = flowPhase5ResourceSchema(
  'verification/crypto-wallet',
  FLOW_CRYPTO_WALLET_ATTRIBUTES,
);
export const flowDatabaseBusinessVerificationResourceSchema = flowPhase5ResourceSchema(
  'verification/database-business',
  FLOW_DATABASE_BUSINESS_ATTRIBUTES,
);
export const flowBusinessWebsiteVerificationResourceSchema = flowPhase5ResourceSchema(
  'verification/business-website',
  FLOW_BUSINESS_WEBSITE_ATTRIBUTES,
);

/** Every flow verification resource schema, in {@link VERIFICATION_RESOURCE_TYPES} order. */
export const FLOW_VERIFICATION_RESOURCE_SCHEMAS = [
  flowGovernmentIdVerificationResourceSchema,
  flowSelfieVerificationResourceSchema,
  flowDocumentVerificationResourceSchema,
  flowDatabaseVerificationResourceSchema,
  flowAamvaVerificationResourceSchema,
  flowPhoneNumberVerificationResourceSchema,
  flowEmailAddressVerificationResourceSchema,
  flowGovernmentIdNfcVerificationResourceSchema,
  flowCryptoWalletVerificationResourceSchema,
  flowDatabaseBusinessVerificationResourceSchema,
  flowBusinessWebsiteVerificationResourceSchema,
] as const;

/**
 * The flow's view of a verification (C3): status and retry hints, and for a Phase 5 type its
 * guidance (C52.2); never checks or fraud details.
 */
export const flowVerificationResourceSchema = z.discriminatedUnion(
  'type',
  FLOW_VERIFICATION_RESOURCE_SCHEMAS,
);
export type FlowVerificationResource = z.infer<typeof flowVerificationResourceSchema>;

/** `POST /flow/verifications`, `GET /flow/verifications/:id` and `.../submit` responses. */
export const flowVerificationDocumentSchema = singleDocumentSchema(flowVerificationResourceSchema);
export type FlowVerificationDocument = z.infer<typeof flowVerificationDocumentSchema>;

/** A stored check outcome; `required` comes from the template's verification config. */
export interface VerificationCheckRecord {
  name: string;
  status: CheckStatus;
  reasons: readonly string[];
  required: boolean;
  metadata: Record<string, unknown>;
  /** C29.2. Absent or `null` for a row stored before Phase 3: the registry's stage is served. */
  stage?: CheckStage | null | undefined;
  confidence?: number | null | undefined;
  provenance?: CheckProvenance | null | undefined;
}

export interface VerificationRecord {
  /** C105.7 (Workflow 7B): left out, the relationship is not sent. */
  transactionId?: string | null;
  id: string;
  type: SupportedVerificationType;
  status: VerificationStatus;
  inquiryId: string;
  fileIds: readonly string[];
  checks: readonly VerificationCheckRecord[];
  /** Government ID only. */
  country?: string | null;
  /** Government ID only. */
  idClass?: IdClass | null;
  /**
   * Government ID only (C31.5): the stored extraction, `null` or absent when there is none.
   * Pass it already masked for the principal (C31.6).
   */
  extraction?: GovernmentIdExtractionRecord | null | undefined;
  /**
   * Selfie only (C40.1, C40.10, Workflow 4A Stage 3): the verification's captures, newest first,
   * and the one submit consumed (`null` before that). Left out, neither the `selfies`
   * relationship nor the C40.10 attributes are sent.
   */
  selfie?: SelfieVerificationDetails | undefined;
  /**
   * A Phase 5 type only (C52.8): its type attributes as `services/attributes/<api-type>.ts`
   * loaded them, already masked for the principal (C53.7). Left out, none are sent.
   */
  attributes?: Readonly<Record<string, unknown>> | undefined;
  /** C96.3: the verification came from a rejected handoff. Left out, the attribute is not sent. */
  fromRejectedHandoff?: boolean | undefined;
  createdAt: Date;
  updatedAt: Date;
}

/** A selfie verification's captures, as its resource shows them (C40.1, C40.10). */
export interface SelfieVerificationDetails {
  /** Newest first. */
  captureIds: readonly string[];
  /** The capture submit consumed (`submitted` or `processed`), or `null`. */
  capture: SelfieVerificationCapture | null;
}

/** A government ID's extraction as the resource builder takes it. */
export interface GovernmentIdExtractionRecord {
  /** `null` after redaction (C31.7). */
  fields: ExtractedFields | null;
  sources: ExtractionFieldSources;
}

/** The extraction attributes of a record: every field (`null` when not read) and the sources. */
function extractionAttributesOf(extraction: GovernmentIdExtractionRecord | null | undefined) {
  return {
    ...Object.fromEntries(
      EXTRACTION_FIELDS.map((field) => [field, extraction?.fields?.[field] ?? null]),
    ),
    'extraction-sources': extraction?.sources ?? null,
  };
}

function toCheck(record: VerificationCheckRecord) {
  const definition = getCheckDefinition(record.name);
  return {
    name: record.name,
    status: record.status,
    reasons: [...record.reasons],
    requirement: checkRequirementFor(record.required),
    metadata: record.metadata,
    stage: record.stage ?? definition?.stage,
    confidence: record.confidence ?? null,
    provenance: record.provenance ?? null,
    // C50.8: derived from the registry at read time, so stored rows need no migration.
    category: definition?.category,
  };
}

/** The type attributes of a record, after the status, checks and timestamps every type has. */
function attributesOf(
  record: VerificationRecord,
  common: Record<string, unknown>,
  selfie: SelfieVerificationDetails | undefined,
): Record<string, unknown> {
  switch (record.type) {
    case 'government_id':
      return {
        ...common,
        country: record.country ?? null,
        'id-class': record.idClass ?? null,
        ...extractionAttributesOf(record.extraction),
      };
    case 'selfie':
      return {
        ...common,
        ...(selfie === undefined
          ? {}
          : selfieVerificationAttributes(record.checks, selfie.capture)),
      };
    default:
      // C52.8: the type's attributes as its attribute hook loaded and masked them.
      return { ...common, ...(record.attributes ?? {}) };
  }
}

/**
 * Builds the full verification resource (server API, dashboard, webhooks).
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildVerificationResource(record: VerificationRecord): VerificationResource {
  const common = {
    status: record.status,
    checks: record.checks.map(toCheck),
    ...(record.fromRejectedHandoff === undefined
      ? {}
      : { 'from-rejected-handoff': record.fromRejectedHandoff }),
    'created-at': toTimestamp(record.createdAt),
    'updated-at': toTimestamp(record.updatedAt),
  };
  const selfie = record.type === 'selfie' ? record.selfie : undefined;
  return verificationResourceSchema.parse({
    type: toVerificationResourceType(record.type),
    id: record.id,
    attributes: attributesOf(record, common, selfie),
    relationships: {
      inquiry: { data: { type: 'inquiry', id: record.inquiryId } },
      files: { data: record.fileIds.map((id) => ({ type: 'file', id })) },
      ...(selfie === undefined
        ? {}
        : { selfies: { data: selfie.captureIds.map((id) => ({ type: 'selfie', id })) } }),
      ...(record.transactionId === undefined
        ? {}
        : {
            transaction: {
              data:
                record.transactionId === null
                  ? null
                  : { type: 'transaction', id: record.transactionId },
            },
          }),
    },
  });
}

export type FlowVerificationRecord = Pick<
  VerificationRecord,
  'id' | 'type' | 'status' | 'checks' | 'createdAt' | 'updatedAt'
> & {
  /**
   * A Phase 5 type only (C52.2): its flow attributes, `guidance` and, for the form types,
   * `inputs-received`, as `services/guidance/<api-type>.ts` built them. Left out, none are sent.
   */
  flowAttributes?: Readonly<Record<string, unknown>> | undefined;
};

/**
 * Builds the flow's view of a verification: status and retry hints, nothing else.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildFlowVerificationResource(
  record: FlowVerificationRecord,
): FlowVerificationResource {
  return flowVerificationResourceSchema.parse({
    type: toVerificationResourceType(record.type),
    id: record.id,
    attributes: {
      status: record.status,
      'retry-hints': retryHintsFromChecks(record.checks.map(toCheck)),
      ...(record.type === 'government_id' || record.type === 'selfie'
        ? {}
        : (record.flowAttributes ?? {})),
      'created-at': toTimestamp(record.createdAt),
      'updated-at': toTimestamp(record.updatedAt),
    },
  });
}

/**
 * C53.7: every attribute a verification resource marks as PII (`.meta({ pii: true })`), in the
 * order the resources first name them: the government ID extraction, then the Phase 5 types. The
 * API's masking lists (`auth/pii.ts`, `services/api-logs.ts`) consume it; a name is never a
 * non-PII attribute of another resource type, so masking by name is safe.
 */
export const PII_VERIFICATION_ATTRIBUTES: readonly string[] = Object.freeze([
  ...new Set(
    VERIFICATION_RESOURCE_SCHEMAS.flatMap((schema) =>
      Object.entries(
        (schema.shape.attributes as unknown as { shape: Record<string, z.ZodType> }).shape,
      )
        .filter(([, member]) => (member.meta() as { pii?: unknown } | undefined)?.pii === true)
        .map(([name]) => name),
    ),
  ),
]);
