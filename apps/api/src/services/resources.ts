/**
 * Maps database rows to the contract resources (`@openverify/contracts` builders). Every
 * builder validates its output, so a row that no longer satisfies the contract fails loudly
 * (500) instead of reaching a client.
 */
import {
  acceptedUploadMimeTypeSchema,
  buildCreatedWebhookResource,
  buildEventResource,
  buildFileResource,
  buildFlowVerificationResource,
  buildInquiryResource,
  buildInquiryTemplateResource,
  buildVerificationResource,
  buildWebhookResource,
  eventPayloadSchema,
  inquiryFieldsSchema,
  isEventName,
  verificationConfigSchema,
  type CreatedWebhookResource,
  type EventResource,
  type FileResource,
  type FlowVerificationResource,
  type InquiryResource,
  type InquiryTemplateResource,
  type SelfieVerificationDetails,
  type VerificationResource,
  type WebhookResource,
} from '@openverify/contracts';
import type { VerificationTemplateConfig } from '@openverify/core';
import type {
  Db,
  EventRecord as EventRow,
  GovernmentIdExtraction,
  Inquiry,
  InquiryTemplateWithVersion,
  StoredFile,
  VerificationType,
  VerificationWithChecks,
  Webhook,
} from '@openverify/db';
import type { FlowStep } from '@openverify/flow-spec';
import type { PiiMask } from '../auth/pii.js';
import { storedAnyFlow } from './stored-flow.js';
import { checkRecordOf } from '../jobs/records.js';
import { attributeHookFor } from './attributes/index.js';
import type { ApiDependencies } from './context.js';
import { guidanceHookFor } from './guidance/index.js';

/** `{ id, type }` of a verification, enough for relationship linkage. */
export interface VerificationRef {
  id: string;
  type: VerificationType;
}

export function inquiryResource(
  row: Inquiry,
  verifications: readonly VerificationRef[],
): InquiryResource {
  return buildInquiryResource({
    id: row.id,
    status: row.status,
    referenceId: row.referenceId,
    fields: inquiryFieldsSchema.parse(row.fields),
    inquiryTemplateId: row.inquiryTemplateId,
    inquiryTemplateVersionId: row.inquiryTemplateVersionId,
    verifications: verifications.map(({ id, type }) => ({ id, type })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function inquiryTemplateResource(row: InquiryTemplateWithVersion): InquiryTemplateResource {
  const version = row.latestVersion;
  return buildInquiryTemplateResource({
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    currentVersion: {
      id: version.id,
      versionNumber: version.version,
      flow: storedAnyFlow(version.flow),
      verificationConfig: verificationConfigSchema.parse(version.verificationConfig),
      createdAt: version.createdAt,
    },
  });
}

export interface VerificationResourceOptions {
  /** C105.7: the latest transaction the verification was attached to. */
  transactionId?: string | null | undefined;
  /** A government ID's stored extraction (C31.5); its attributes are `null` without one. */
  extraction?: GovernmentIdExtraction | null | undefined;
  /** The PII visibility of the principal it is served to (C31.6); unmasked when omitted. */
  mask?: PiiMask | undefined;
  /**
   * A selfie's captures (C40.1) and the consumed one (C40.10): the `selfies` relationship and the
   * C40.10 attributes. Left out, neither is sent.
   */
  selfie?: SelfieVerificationDetails | undefined;
  /**
   * C52.8: a Phase 5 type's attributes as its hook loaded them (`loadVerificationAttributes`),
   * unmasked; the hook masks them for `mask` (C53.7). Left out, none are sent.
   */
  attributes?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * A Phase 5 type's loaded attributes, masked by its hook for `mask` (C53.7); `undefined` when
 * none were loaded.
 */
export function maskedTypeAttributes(
  type: VerificationType,
  attributes: Readonly<Record<string, unknown>> | undefined,
  mask: PiiMask | undefined,
): Readonly<Record<string, unknown>> | undefined {
  const hook = attributeHookFor(type);
  return attributes === undefined || hook === undefined || mask === undefined
    ? attributes
    : hook.mask(attributes, mask);
}

/**
 * The full verification (server API, webhooks): status, checks, file linkage and, for a
 * government ID, its C31.5 extraction attributes, for a Phase 5 type its C52.8 attributes, masked
 * as `mask` says (C31.6, C53.7).
 */
export function verificationResource(
  row: VerificationWithChecks,
  fileIds: readonly string[],
  options: VerificationResourceOptions = {},
): VerificationResource {
  const resource = buildVerificationResource({
    // C105.7 (Workflow 7B): left out until `resolveTransactionRelationships` answers.
    ...(options.transactionId === undefined ? {} : { transactionId: options.transactionId }),
    id: row.id,
    type: row.type,
    status: row.status,
    inquiryId: row.inquiryId,
    fileIds,
    checks: row.checks.map(checkRecordOf),
    country: row.country,
    idClass: row.idClass,
    extraction:
      options.extraction == null
        ? null
        : { fields: options.extraction.fields, sources: options.extraction.fieldSources },
    ...(options.selfie === undefined ? {} : { selfie: options.selfie }),
    ...(options.attributes === undefined
      ? {}
      : { attributes: maskedTypeAttributes(row.type, options.attributes, options.mask) }),
    fromRejectedHandoff: row.fromRejectedHandoff,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  return options.mask === undefined ? resource : maskVerificationResource(resource, options.mask);
}

/** `resource` with its PII attributes masked as `mask` says (C15, C31.6). */
export function maskVerificationResource(
  resource: VerificationResource,
  mask: PiiMask,
): VerificationResource {
  return mask.visible
    ? resource
    : ({ ...resource, attributes: mask.attributes(resource.attributes) } as VerificationResource);
}

/**
 * The flow's view of a verification (C3, C52.2): status and user-fixable retry hints, and for a
 * Phase 5 type what its guidance hook builds from the inquiry's pinned `step` and `config`
 * (`guidance`, and `inputs-received` for the form types); never checks or an entered value.
 */
export async function flowVerificationResource(
  deps: ApiDependencies,
  db: Db,
  row: VerificationWithChecks,
  step: FlowStep | undefined,
  config: VerificationTemplateConfig | undefined,
): Promise<FlowVerificationResource> {
  const flowAttributes = await guidanceHookFor(row.type)?.flowAttributes({
    deps,
    db,
    verification: row,
    step,
    config,
  });
  return buildFlowVerificationResource({
    id: row.id,
    type: row.type,
    status: row.status,
    checks: row.checks.map(checkRecordOf),
    ...(flowAttributes === undefined ? {} : { flowAttributes }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function fileResource(
  row: StoredFile,
  verification: VerificationRef,
  { clientReported = true }: { clientReported?: boolean } = {},
): FileResource {
  return buildFileResource({
    id: row.id,
    kind: row.kind,
    mimeType: acceptedUploadMimeTypeSchema.parse(row.mimeType),
    byteSize: row.byteSize,
    createdAt: row.createdAt,
    // C153.2, C206.1, C206.2: client-reported (C206.3), on the API's own resources; the flow's upload
    // answer echoes no capture fact (C40.10).
    ...(clientReported
      ? { captureMethod: row.captureMethod, captureTrigger: row.captureTrigger }
      : {}),
    verification: { id: verification.id, type: verification.type },
  });
}

function webhookRecord(row: Webhook) {
  return {
    id: row.id,
    url: row.url,
    enabledEvents: row.enabledEvents,
    status: row.status,
    secretLast4: row.secretLast4,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function webhookResource(row: Webhook): WebhookResource {
  return buildWebhookResource(webhookRecord(row));
}

/** The creation response: the only one that carries the signing secret. */
export function createdWebhookResource(row: Webhook, secret: string): CreatedWebhookResource {
  return buildCreatedWebhookResource(webhookRecord(row), secret);
}

/**
 * The event resource (C5).
 * @throws {Error} for a stored name outside the Phase 1 event list.
 */
export function eventResource(row: EventRow): EventResource {
  if (!isEventName(row.name)) {
    throw new Error(`Event ${row.id} has a name outside the event contract`);
  }
  return buildEventResource({
    id: row.id,
    name: row.name,
    payload: eventPayloadSchema.parse(row.payload),
    createdAt: row.createdAt,
  });
}
