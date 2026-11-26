/**
 * C114.4, C118.5: what a run reads of an object. A run reads the server API's view, unmasked, because
 * it acts on its grant and its values are sealed and masked at every exit (C120.6); a viewer's mask
 * is applied where a viewer reads (P38). A trigger snapshot holds the related resources the version's
 * paths read past an identifier, and nothing else, so a run never needs the event row later.
 *
 * An object that cannot be read leaves its identifier in the view, so a path past it reads as `null`,
 * never as a value.
 */
import { getInquiryDocument } from '../../services/inquiries.js';
import type { WorkflowDefinition } from '@openverify/contracts';
import type { WorkflowObjectType } from '@openverify/core';
import { getInquiry, getInquiryTemplate, getReport, getTransaction, type Db } from '@openverify/db';
import {
  WORKFLOW_RUN_LIMITS,
  buildTriggerView,
  parsePath,
  relatedNeededBy,
  type JsonApiResource,
  type JsonRecord,
  type PathSegment,
  type TriggerDocument,
} from '@openverify/workflow-engine';
import { UNMASKED } from '../../auth/pii.js';
import { NotFoundError } from '../../errors.js';
import { accountResource, getAccountView } from '../../services/accounts.js';
import { inquiryTemplateResource } from '../../services/resources.js';
import { reportViewOf } from '../../services/reports/reports.js';
import { reportResource } from '../../services/reports/resources.js';
import { transactionResource } from '../../services/transactions/resources.js';
import { caseTriggerDocumentOf } from '../actions/cases/trigger.js';

const REDACTED_AT = 'redacted-at';
const TRIGGER_ROOT = 'trigger';
const REFERENCE = /\{\{\s*([^{}\s]+)\s*\}\}/g;
const REPORT_TYPE_PREFIX = 'report/';

async function inquiryDocument(
  db: Db,
  environmentId: string,
  id: string,
): Promise<TriggerDocument | null> {
  if ((await getInquiry(db, environmentId, id)) === null) {
    return null;
  }
  const document = await getInquiryDocument(
    { db } as Parameters<typeof getInquiryDocument>[0],
    { ctx: { environmentId, organizationId: '' }, mask: UNMASKED },
    id,
    ['verifications'],
  );
  return document as TriggerDocument;
}

async function accountDocument(
  db: Db,
  environmentId: string,
  id: string,
): Promise<TriggerDocument | null> {
  try {
    const view = await getAccountView(
      { db } as Parameters<typeof getAccountView>[0],
      environmentId,
      id,
    );
    return { data: accountResource(view, UNMASKED) };
  } catch (error) {
    if (error instanceof NotFoundError) {
      return null;
    }
    throw error;
  }
}

async function reportDocument(
  db: Db,
  environmentId: string,
  id: string,
): Promise<TriggerDocument | null> {
  const report = await getReport(db, environmentId, id);
  return report === null
    ? null
    : { data: reportResource(await reportViewOf(db, report), UNMASKED) };
}

async function transactionDocument(
  db: Db,
  environmentId: string,
  id: string,
): Promise<TriggerDocument | null> {
  const transaction = await getTransaction(db, environmentId, id);
  return transaction === null
    ? null
    : { data: await transactionResource(db, environmentId, transaction, { mask: UNMASKED }) };
}

/**
 * The object as a run reads it; `null` for an object this environment does not hold (C121.6). A case
 * is Workflow 8B's.
 */
export async function triggerDocumentOf(
  db: Db,
  environmentId: string,
  objectType: WorkflowObjectType,
  id: string,
): Promise<TriggerDocument | null> {
  switch (objectType) {
    case 'inquiry':
      return inquiryDocument(db, environmentId, id);
    case 'account':
      return accountDocument(db, environmentId, id);
    case 'report':
      return reportDocument(db, environmentId, id);
    case 'transaction':
      return transactionDocument(db, environmentId, id);
    case 'case':
      // Workflow 8B (C140.2): a case is `api-case-workflows`' to read.
      return caseTriggerDocumentOf(db, environmentId, id);
  }
}

/** The paths under `trigger` a stored definition reads, in any position. */
function triggerPaths(value: unknown, found: (readonly PathSegment[])[] = []) {
  if (typeof value === 'string') {
    const texts = value.startsWith(`${TRIGGER_ROOT}.`)
      ? [value]
      : [...value.matchAll(REFERENCE)].flatMap(([, path]) => path ?? []);
    for (const text of texts) {
      const segments = parsePath(text)?.segments;
      if (segments?.[0] === TRIGGER_ROOT) {
        found.push(segments);
      }
    }
  } else if (Array.isArray(value)) {
    value.forEach((item) => triggerPaths(item, found));
  } else if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach((item) => triggerPaths(item, found));
  }
  return found;
}

const isResource = (value: unknown): value is { type: string; id: string } =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { type?: unknown }).type === 'string' &&
  typeof (value as { id?: unknown }).id === 'string';

function linkageOf(resource: JsonApiResource, name: string): { type: string; id: string } | null {
  const relationships = resource.relationships as
    Readonly<Record<string, { data?: unknown } | undefined>> | undefined;
  const data = relationships?.[name]?.data;
  return isResource(data) ? data : null;
}

/** One related resource, by what its identifier says. */
async function relatedResource(
  db: Db,
  environmentId: string,
  { type, id }: { type: string; id: string },
): Promise<JsonApiResource | null> {
  if (type === 'inquiry-template') {
    const template = await getInquiryTemplate(db, environmentId, id);
    return template === null ? null : inquiryTemplateResource(template);
  }
  const objectType: WorkflowObjectType | null = type.startsWith(REPORT_TYPE_PREFIX)
    ? 'report'
    : type === 'inquiry' || type === 'account' || type === 'transaction'
      ? type
      : null;
  const document =
    objectType === null ? null : await triggerDocumentOf(db, environmentId, objectType, id);
  return document?.data ?? null;
}

/** The verifications of the inquiry a document is about. */
async function relatedVerifications(
  db: Db,
  environmentId: string,
  document: TriggerDocument,
  wanted: readonly string[],
): Promise<readonly JsonApiResource[]> {
  const { data } = document;
  const inquiryId = data.type === 'inquiry' ? data.id : linkageOf(data, 'inquiry')?.id;
  if (inquiryId === undefined || wanted.length === 0) {
    return [];
  }
  const inquiry = await inquiryDocument(db, environmentId, inquiryId);
  return (inquiry?.included ?? []).filter(({ type }) => wanted.includes(type));
}

/**
 * C114.4: the flattened trigger view a run snapshots: `document` with the related resources the
 * version's paths read past their identifier.
 */
export async function triggerViewOf(
  db: Db,
  environmentId: string,
  definition: WorkflowDefinition,
  document: TriggerDocument,
): Promise<JsonRecord> {
  const { relationships, verifications } = relatedNeededBy(triggerPaths(definition));
  const related: JsonApiResource[] = [
    ...(await relatedVerifications(db, environmentId, document, verifications)),
  ];
  for (const name of relationships) {
    const linkage = linkageOf(document.data, name);
    const resource = linkage === null ? null : await relatedResource(db, environmentId, linkage);
    if (resource !== null) {
      related.push(resource);
    }
  }
  return buildTriggerView(document, related);
}

/** C117.7: `payload_too_large` past 256 KiB. */
export function snapshotFits(view: JsonRecord): boolean {
  return (
    Buffer.byteLength(JSON.stringify(view)) <= WORKFLOW_RUN_LIMITS['trigger-snapshot-bytes'].value
  );
}

/** Whether an event's payload was replaced by its redaction stub (C16, C120.9). */
export function isRedactedDocument({ data }: TriggerDocument): boolean {
  const attributes = data.attributes as Readonly<Record<string, unknown>> | undefined;
  const names = Object.keys(attributes ?? {});
  return names.length === 1 && names[0] === REDACTED_AT;
}

/** Whether an object as a run reads it was redacted (C120.9). */
export function isRedactedObject({ data }: TriggerDocument): boolean {
  const attributes = data.attributes as Readonly<Record<string, unknown>> | undefined;
  return attributes?.[REDACTED_AT] != null;
}
