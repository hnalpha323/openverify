/**
 * C12 API logs: what a server API request leaves behind, and how it is served back.
 *
 * Before storage, the value of every secret-bearing key (`API_LOG_REDACTED_KEYS`) is replaced
 * with `[REDACTED]` at any depth, multipart bodies keep part metadata only, and each of the
 * query, request body and response body is truncated at 64 KiB. A value over 64 KiB is stored
 * as `{ truncated: true, byte-length, preview }`: the size of its JSON and the start of its
 * PII-masked JSON, cut so the whole stored value fits in 64 KiB. The repository encrypts the address,
 * user agent, query and bodies.
 *
 * Users without `pii:view` (C15) get the entries with `ip-address` and `user-agent` nulled, and
 * every `fields` value, `note`, `ip-address`, `user-agent` and searched transaction value inside the
 * query and bodies nulled too, with the C31.5 extraction attributes of every resource (C31.6) and every C53.7 PII
 * attribute of a verification, since the bodies carry the same resources the masked routes serve.
 */
import { createHash } from 'node:crypto';
import {
  API_LOG_MAX_BODY_BYTES,
  GOVERNMENT_ID_EXTRACTION_ATTRIBUTES,
  PII_GRAPH_ATTRIBUTES,
  PII_IMPORTER_ATTRIBUTES,
  PII_LIST_ATTRIBUTES,
  PII_VERIFICATION_ATTRIBUTES,
  PII_REPORT_ATTRIBUTES,
  PII_SIGNAL_ATTRIBUTES,
  PII_TRANSACTION_ATTRIBUTES,
  PII_DECISION_ATTRIBUTES,
  PII_SANDBOX_MESSAGE_ATTRIBUTES,
  PII_WORKFLOW_RUN_ATTRIBUTES,
  PII_CASE_ATTRIBUTES,
  PII_CASE_COMMENT_ATTRIBUTES,
  PII_CASE_ATTACHMENT_ATTRIBUTES,
  CASE_ATTACHMENT_BODY_PII_MEMBERS,
  PII_FLOW_SCREEN_ATTRIBUTES,
  PII_SIMULATION_PRESET_ATTRIBUTES,
  PII_EXPORT_ATTRIBUTES,
  PII_REPORT_BULK_ATTRIBUTES,
  TRANSACTION_FIELD_FILTER_PATTERN,
  buildApiLogResource,
  filterValues,
  httpMethodSchema,
  idSchema,
  redactKeys,
  type ApiLogResource,
  type ListApiLogsQuery,
  NFC_PREFILL_MRZ_MEMBER,
} from '@openverify/contracts';
import { getApiLog as findApiLog, listApiLogs as findApiLogs, type ApiLog } from '@openverify/db';
import { z } from 'zod';
import { piiMaskFor } from '../auth/pii.js';
import { BadRequestError, NotFoundError } from '../errors.js';
import type { Principal } from '../ports.js';
import { caseIdsIn, filterCaseVisibility } from './cases/visibility.js';
import type { ApiDependencies } from './context.js';
import { nextLink, pageRequest, withCursor } from './pagination.js';

export const API_LOGS_PATH = '/api/v1/api-logs';

/** A stored value whose JSON was longer than 64 KiB. */
export interface TruncatedLogValue {
  truncated: true;
  /** The size of the whole value's JSON. */
  'byte-length': number;
  /** The start of that JSON. */
  preview: string;
}

/** Room left for the wrapper around the preview. */
const WRAPPER_BYTES = 128;

/** The first `bytes` of `text` in UTF-8, cut before a character, never inside one. */
function utf8Prefix(text: string, bytes: number): string {
  const encoded = Buffer.from(text, 'utf8');
  let end = Math.max(0, Math.min(bytes, encoded.byteLength));
  while (end > 0 && end < encoded.byteLength && ((encoded[end] ?? 0) & 0xc0) === 0x80) {
    end -= 1;
  }
  return encoded.subarray(0, end).toString('utf8');
}

const jsonBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));

/**
 * `value` itself when its JSON fits in 64 KiB, otherwise a {@link TruncatedLogValue}. The
 * preview is cut from the PII-masked JSON ({@link maskPersonalData}): a string cannot be masked
 * when it is read, so a preview with PII would reach readers without `pii:view` (Workflow 2B
 * F008). Readers with `pii:view` see the masked preview too; whole values stay unmasked.
 */
function truncated(value: unknown): unknown {
  const json = JSON.stringify(value);
  const length = Buffer.byteLength(json);
  if (length <= API_LOG_MAX_BODY_BYTES) {
    return value;
  }
  const masked = JSON.stringify(maskPersonalData(value));
  let budget = API_LOG_MAX_BODY_BYTES - WRAPPER_BYTES;
  for (;;) {
    const stored: TruncatedLogValue = {
      truncated: true,
      'byte-length': length,
      preview: utf8Prefix(masked, budget),
    };
    // Escaping quotes and backslashes in the preview can make it longer than its budget.
    const excess = jsonBytes(stored) - API_LOG_MAX_BODY_BYTES;
    if (excess <= 0) {
      return stored;
    }
    budget -= excess;
  }
}

/** A query or body as an API log stores it: redacted, then truncated; `null` when absent. */
export function apiLogValue(value: unknown): unknown {
  return value === undefined ? null : truncated(redactKeys(value));
}

// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const JSON_MEDIA_TYPE = /^application\/(?:[\w.-]+\+)?json(?:\s*;|$)/i;

/** A response payload parsed as JSON, or `undefined` when it is not a JSON document. */
export function responseJson(payload: unknown, contentType: string | undefined): unknown {
  if (contentType === undefined || !JSON_MEDIA_TYPE.test(contentType)) {
    return undefined;
  }
  const text =
    typeof payload === 'string'
      ? payload
      : Buffer.isBuffer(payload)
        ? payload.toString('utf8')
        : undefined;
  if (text === undefined || text === '') {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * C253.1 (Workflow 11B Stage 1a amendment 48; `dsar-export`): the routes whose answer is export
 * content, the access export's manifest and a listed file. Their response bodies are never kept in
 * the API log (a 4xx or 5xx problem of theirs neither), as an importer's file is never kept.
 */
export const UNLOGGED_RESPONSE_ROUTES: ReadonlySet<string> = new Set([
  '/api/v1/account-exports/:id/manifest',
  '/api/v1/account-exports/:id/files/:fileId',
]);

/** {@link responseJson}, except for a route of {@link UNLOGGED_RESPONSE_ROUTES}: nothing. */
export function loggedResponseJson(
  route: string | null,
  payload: unknown,
  contentType: string | undefined,
): unknown {
  return route !== null && UNLOGGED_RESPONSE_ROUTES.has(route)
    ? undefined
    : responseJson(payload, contentType);
}

/** The response body as an API log stores it; `null` for anything but a JSON document. */
export function apiLogResponseBody(payload: unknown, contentType: string | undefined): unknown {
  return apiLogValue(responseJson(payload, contentType));
}

/**
 * C100.1 (F23): a JSON importer body as an API log stores it: `data.attributes.file` becomes the
 * decoded length and SHA-256, as a multipart body keeps part metadata only, whoever reads it. Any
 * other body is returned as it is.
 */
export function withoutImporterFile(body: unknown): unknown {
  if (!isRecord(body)) {
    return body;
  }
  const { data } = body;
  const attributes = isRecord(data) ? data.attributes : undefined;
  if (!isRecord(data) || !isRecord(attributes) || typeof attributes.file !== 'string') {
    return body;
  }
  const bytes = Buffer.from(attributes.file, 'base64');
  return {
    ...body,
    data: {
      ...data,
      attributes: { ...attributes, file: { length: bytes.byteLength, sha256: sha256(bytes) } },
    },
  };
}

/** One part of a `multipart/form-data` body. */
export interface MultipartPart {
  name: string;
  /** The file name of a file part; `null` for a plain field. */
  filename: string | null;
  'content-type': string | null;
  size: number;
  /** SHA-256 of the part's bytes, hex. */
  sha256: string;
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** The parts of a buffered multipart body in order, or `null` when it cannot be parsed. */
export async function describeMultipartBody(
  body: Uint8Array,
  contentType: string,
): Promise<MultipartPart[] | null> {
  try {
    const response = new Response(new Uint8Array(body), {
      headers: { 'content-type': contentType },
    });
    // The body is already buffered and bounded by the route's body limit, so the platform
    // parser's buffering, the reason it is deprecated for servers, costs nothing here.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const form = await response.formData();
    const parts: MultipartPart[] = [];
    for (const [name, value] of form.entries()) {
      if (typeof value === 'string') {
        const bytes = Buffer.from(value, 'utf8');
        parts.push({
          name,
          filename: null,
          'content-type': null,
          size: bytes.byteLength,
          sha256: sha256(bytes),
        });
      } else {
        const bytes = new Uint8Array(await value.arrayBuffer());
        parts.push({
          name,
          filename: value.name,
          'content-type': value.type === '' ? null : value.type,
          size: bytes.byteLength,
          sha256: sha256(bytes),
        });
      }
    }
    return parts;
  } catch {
    return null;
  }
}

/** A multipart body as an API log stores it: part metadata, never the bytes or digests. */
export function multipartLogValue(parts: readonly MultipartPart[] | null): unknown {
  return parts === null
    ? null
    : apiLogValue({
        parts: parts.map(({ name, filename, size, ...part }) => ({
          name,
          filename,
          'content-type': part['content-type'],
          size,
        })),
      });
}

/** A header value as one string: repeated headers joined as Node joins unknown ones. */
export const headerText = (value: string | string[] | number | undefined): string | undefined =>
  Array.isArray(value) ? value.join(', ') : value === undefined ? undefined : String(value);

/** A plain JSON object (not an array). */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Members nulled for a user without `pii:view`, wherever they appear: C15's, and (C53.7, C55.11)
 * a phone number or email address, which request bodies carry outside any resource (the sandbox
 * SMS search).
 */
const MASKED_MEMBERS = new Set([
  'note',
  'ip-address',
  'user-agent',
  'phone-number',
  'email-address',
  // C105.2: the stored query of a search over a transaction's fields; the key stays.
  'filter[identifier][value]',
  // C100.2, C105.2 (rule 11): an uploaded part's file name (a CSV import, a transaction file).
  'filename',
  // C143.5 (P21): `meta.comment` of a decision or a reopen, sealed in its record.
  'comment',
  // C207.2, C221.1 (Workflow 10C): the nfc client view's MRZ key fields, wherever a logged body
  // carries a flow session's `step`.
  NFC_PREFILL_MRZ_MEMBER,
  // C126.4, C143.5: a sandbox search answers these outside any `attributes`.
  ...PII_SANDBOX_MESSAGE_ATTRIBUTES,
  // C143.5 (P21): `data.parameters` of a run-action, and a form's prefilled values inside an array.
  'parameters',
  'prefilled-value',
  // C143.5 (Workflow 8B; P21, Stage 1a amendment 29): a comment's `meta.message`, a review request's
  // `meta.statement` and a search's `query`, which stand outside any `attributes`. A report's
  // `query` attribute is masked whole here too, which fails closed.
  'message',
  'statement',
  'query',
  // C132.3, C143.5 (Workflow 8B (Q); Stage 1a amendment 38): an assignment's
  // `meta.user-email-address`, which stands outside any `attributes`.
  'user-email-address',
  // C148.5, C174.5 (Workflow 9A Stage 1b (T)): a screen submission's `values`, and the simulated
  // `scope` of a simulate body or a preset (review P12), whole.
  ...PII_FLOW_SCREEN_ATTRIBUTES,
  ...PII_SIMULATION_PRESET_ATTRIBUTES,
  // C165.3, C174.5 (Workflow 9B Stage 1b (X); review P15): the step an inquiry reached, as a stored
  // query's filter (it can reveal a masked value); a transaction's `filter[fields.<key>]` is masked
  // by its pattern below (a string field's value is personal data; every one is masked, failing
  // closed).
  'filter[next-step-name]',
]);

/**
 * C105.2: a list's `links.next` repeats the query, so the value `filter[identifier][value]` searched
 * for is in a stored answer too (`nextLink` writes the key as it is, and escapes the value); C165.3
 * (Workflow 9B Stage 1b (X)): so are `filter[next-step-name]` and every `filter[fields.<key>]`.
 */
const SEARCHED_VALUE =
  /(filter\[(?:identifier\]\[value|next-step-name|fields\.[a-z0-9][a-z0-9_-]{0,63})\]=)[^&]*/gu;

/**
 * Members nulled in a resource's `attributes`: C31.6 the extraction of a government ID (its
 * `extraction-sources` names fields only and stays, as the API serves it), and C53.7 every
 * attribute a verification resource marks PII. A `fields` object is masked member-wise above, any
 * other PII member whole.
 */
const MASKED_ATTRIBUTES: ReadonlySet<string> = new Set([
  ...GOVERNMENT_ID_EXTRACTION_ATTRIBUTES,
  ...PII_VERIFICATION_ATTRIBUTES,
  // C70.3 (P04): a report's PII, and the reason, comment and entity id of a dismissal or review,
  // whose bodies carry them under `data.attributes`.
  ...PII_REPORT_ATTRIBUTES,
  // C107.5 (Workflow 7A): the session, network and device PII, and the handoff `destination`.
  ...PII_SIGNAL_ATTRIBUTES,
  // C107.5 (Workflow 7B): list item create attributes, probes, match values and dismissal reasons
  // under `data.attributes`, and the importer's `file` (already reduced to its digest).
  ...PII_LIST_ATTRIBUTES,
  ...PII_IMPORTER_ATTRIBUTES,
  // C105.8, C107.5 (Workflow 7B): `fields` is masked member-wise above; `content` of a body.
  ...PII_TRANSACTION_ATTRIBUTES,
  // C102.4, C102.6, C107.5 (Workflow 7B): `params` member-wise below; a body's `parameter-map` and
  // `variable-map`, and the unmasked node `value`, whole. A node's own `value` is not under
  // `attributes` (it is in `nodes[]`), so it stays.
  ...PII_GRAPH_ATTRIBUTES,
  // C120.6, C143.5 (Workflow 8A; P21): a run's and a step's values whole, and what a body carries.
  ...PII_WORKFLOW_RUN_ATTRIBUTES,
  // C128.1, C143.5 (P19): a decision's sealed comment.
  ...PII_DECISION_ATTRIBUTES,
  // C136.4, C134.1, C143.5 (Workflow 8B): `fields` member-wise above; the creator's address, the
  // statement and a comment's message whole.
  ...PII_CASE_ATTRIBUTES,
  ...PII_CASE_COMMENT_ATTRIBUTES,
  // C135.2, C143.5 (Workflow 8B (F)): an attachment's filename, wherever a resource serves it.
  ...PII_CASE_ATTACHMENT_ATTRIBUTES,
  // C166.1, C166.5, C174.5 (Workflow 9B Stage 1b (X); B19; review P24): an export body's `filter`
  // (the list's filter with its values) and a bulk upload's CSV part. A multipart body is stored as
  // part metadata only, so the CSV never reaches a log; the name fails closed should one carry it.
  ...PII_EXPORT_ATTRIBUTES,
  ...PII_REPORT_BULK_ATTRIBUTES,
]);

/** An `attachments` item with each of `CASE_ATTACHMENT_BODY_PII_MEMBERS` nulled, the rest masked. */
function maskAttachmentUpload(item: unknown): unknown {
  const masked = maskMembers(item, false);
  if (!isRecord(masked)) {
    return masked;
  }
  return Object.fromEntries(
    Object.entries(masked).map(([name, member]) => [
      name,
      CASE_ATTACHMENT_BODY_PII_MEMBERS.includes(name) ? null : member,
    ]),
  );
}

/** A `files` item with its `content` nulled when it has one, the rest masked as any member. */
function maskChipFileContent(item: unknown): unknown {
  const masked = maskMembers(item, false);
  return isRecord(masked) && Object.hasOwn(masked, 'content')
    ? { ...masked, content: null }
    : masked;
}

/** A field schema with its `default` nulled, when it has one (C174.5). */
function maskFieldDefault(item: unknown): unknown {
  return isRecord(item) && 'default' in item ? { ...item, default: null } : item;
}

function maskMembers(value: unknown, inAttributes: boolean): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => maskMembers(item, false));
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, member]) => {
      if (key === 'fields' && isRecord(member)) {
        return [key, Object.fromEntries(Object.keys(member).map((field) => [field, null]))];
      }
      // C70.3: a report's `query` keeps its keys, as `fields` does (P17: an API log's own query
      // parameters are never inside `attributes`).
      // C102.4: a graph query's `params` keeps each parameter's name.
      if (inAttributes && (key === 'query' || key === 'params') && isRecord(member)) {
        return [key, Object.fromEntries(Object.keys(member).map((field) => [field, null]))];
      }
      if (MASKED_MEMBERS.has(key) || (inAttributes && MASKED_ATTRIBUTES.has(key))) {
        return [key, null];
      }
      // C165.3 (Workflow 9B Stage 1b (X)): a transaction field filter of a stored query.
      if (TRANSACTION_FIELD_FILTER_PATTERN.test(key)) {
        return [key, null];
      }
      // C149.1, C174.5 (Workflow 9A Stage 1b (T); review P12): each field schema's `default`, which a
      // version or preview body may carry; the rest of the schema is configuration and stays.
      if (key === 'field-schemas' && Array.isArray(member)) {
        return [key, member.map(maskFieldDefault)];
      }
      // C135.1, C143.5 (Workflow 8B (F); Stage 1a amendment 40): a PATCH item's base64 `data` and
      // `filename`, inside `attachments` alone, because `data` names every JSON:API body.
      if (key === 'attachments' && Array.isArray(member)) {
        return [key, member.map(maskAttachmentUpload)];
      }
      // C208.1 (Workflow 10C, api-nfc): a sandbox test chip's files (`files[].content`): DG1 is the
      // MRZ. No session-token request is stored today; the mask holds if one ever is.
      if (key === 'files' && Array.isArray(member)) {
        return [key, member.map(maskChipFileContent)];
      }
      if (key === 'next' && typeof member === 'string') {
        return [key, member.replace(SEARCHED_VALUE, '$1')];
      }
      return [key, maskMembers(member, key === 'attributes')];
    }),
  );
}

/**
 * A copy of `value` with every value of each `fields` object, and every `note`, `ip-address`
 * and `user-agent`, replaced with `null`, at any depth; and, in every resource's `attributes`
 * (an answer's `data` and `included`, an event's payload), each C31.5 extraction attribute of a
 * government ID (Workflow 3B review, G001).
 */
export function maskPersonalData(value: unknown): unknown {
  return maskMembers(value, false);
}

/**
 * The resource a request was about, so C16 redaction can find its log entries: the id of a
 * single-resource answer, else the `:id` of the path, else none.
 */
export function resourceIdOf(response: unknown, params: unknown): string | null {
  const data = isRecord(response) ? response.data : undefined;
  if (isRecord(data) && typeof data.id === 'string') {
    return data.id;
  }
  if (isRecord(params) && typeof params.id === 'string') {
    return params.id;
  }
  return null;
}

/** The api-log resource as `principal` may see it. */
export function apiLogResource(row: ApiLog, principal: Principal): ApiLogResource {
  const mask = piiMaskFor(principal);
  const shown = (value: unknown): unknown => (mask.visible ? value : maskPersonalData(value));
  const query = shown(row.query);
  return buildApiLogResource({
    id: row.id,
    method: row.method,
    path: row.path,
    route: row.route,
    status: row.status,
    durationMs: row.durationMs,
    requestId: row.requestId ?? '',
    idempotencyKey: row.idempotencyKey,
    apiKeyId: row.apiKeyId,
    userId: row.userId,
    ipAddress: mask.ipAddress(row.ip),
    userAgent: mask.userAgent(row.userAgent),
    query: isRecord(query) ? query : null,
    requestBody: shown(row.requestBody),
    responseBody: shown(row.responseBody),
    createdAt: row.createdAt,
  });
}

/** The cases an entry is about: its resource, and the subjects its stored bodies name. */
const apiLogCaseIds = (row: { resourceId: string | null; subjectIds: readonly string[] }) =>
  caseIdsIn(row.resourceId, ...row.subjectIds);

/** @throws {NotFoundError} when the entry is not in the principal's environment. */
export async function getApiLog(
  { db }: ApiDependencies,
  principal: Principal,
  id: string,
): Promise<ApiLogResource> {
  const row = await findApiLog(db, principal.environmentId, id);
  // C129.4 (V08; Workflow 8B): an entry about a case the reader may not see reads as missing.
  const [visible] =
    row === null
      ? []
      : await filterCaseVisibility(
          db,
          { environmentId: principal.environmentId, principal },
          [row],
          apiLogCaseIds,
        );
  if (visible === undefined) {
    throw new NotFoundError(`API log ${id} was not found.`);
  }
  return apiLogResource(visible, principal);
}

/** The C9 `created-at` range every list query takes (the inferred query type drops it). */
interface CreatedAtQuery {
  'filter[created-at-start]'?: string | undefined;
  'filter[created-at-end]'?: string | undefined;
}

const timestamp = (value: string | undefined): Date | undefined =>
  value === undefined ? undefined : new Date(value);

/** C12 `GET /api-logs`: newest first, by method, status, route, key, user (C25.9) and date. */
export async function listApiLogs(
  { db }: ApiDependencies,
  principal: Principal,
  query: ListApiLogsQuery & CreatedAtQuery,
): Promise<{ data: ApiLogResource[]; links: { next: string | null } }> {
  const page = await withCursor(async () => {
    try {
      return await findApiLogs(db, principal.environmentId, {
        ...pageRequest(query),
        method: filterValues(query['filter[method]'], httpMethodSchema),
        status: filterValues(query['filter[status]'], z.string()),
        route: query['filter[route]'],
        apiKeyId: filterValues(query['filter[api-key-id]'], idSchema('key')),
        userId: filterValues(query['filter[user-id]'], idSchema('usr')),
        createdAtStart: timestamp(query['filter[created-at-start]']),
        createdAtEnd: timestamp(query['filter[created-at-end]']),
      });
    } catch (error) {
      if (error instanceof RangeError) {
        throw new BadRequestError('filter[status] takes status codes or classes such as 4xx.');
      }
      throw error;
    }
  });
  const filters = {
    'filter[method]': query['filter[method]'],
    'filter[status]': query['filter[status]'],
    'filter[route]': query['filter[route]'],
    'filter[api-key-id]': query['filter[api-key-id]'],
    'filter[user-id]': query['filter[user-id]'],
    'filter[created-at-start]': query['filter[created-at-start]'],
    'filter[created-at-end]': query['filter[created-at-end]'],
  };
  // C129.4 (V08; Workflow 8B): a page can come back short, and `links.next` still moves on.
  const visible = await filterCaseVisibility(
    db,
    { environmentId: principal.environmentId, principal },
    page.items,
    apiLogCaseIds,
  );
  return {
    data: visible.map((row) => apiLogResource(row, principal)),
    links: { next: nextLink(API_LOGS_PATH, filters, query, page.next) },
  };
}
