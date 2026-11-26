/**
 * C169.3 (S4; the public `api-attributes-blocklist`; Workflow 9B): the attributes named by an API key's
 * `attribute-blocklist` are removed from every document served to that key (ids, types and
 * relationships kept), recursively through embedded documents, at every exit (review P22).
 *
 * The hook site (contracts B3) is an `onSend` hook of `plugins/api-version.ts`, which `foundation-9b`
 * (W) placed: it calls this only for an API-key principal whose blocklist is not empty, on the
 * serialized payload, and sends what this answers. A strip before serialization would fail the strict
 * response schemas whenever a required attribute is blocked, so this parses the JSON payload, strips it
 * and serializes it again. The plugin runs before `idempotency` and `api-logs`, so a replayed answer
 * and a stored API log hold the stripped body.
 *
 * The rule, the webhooks' (C14, `applyAttributeBlocklist` in core) extended to every exit:
 * - a resource object (a string `type` with `attributes` or a string `id`) keeps `type`, `id`,
 *   `relationships` and `links`; its `attributes` and `meta` lose every blocked name at any depth
 *   (`fields` drops the whole fields object, `metadata` each check's metadata);
 * - an embedded document (an event's `payload`, a job's result) keeps `data`, `included`, `links`
 *   and `jsonapi` as structure, and each resource in them follows the resource rule;
 * - a document's `meta` (the `meta` of asynchronous jobs) loses the blocked names at any depth;
 * - a problem keeps RFC 9457's members (`type`, `title`, `status`, `detail`, `instance`), `code` and
 *   `errors` (pointers, never values); an extension member named by the list goes.
 *
 * Exits that are not an HTTP answer call the pure functions below: export files take their columns
 * through `blockExportColumns` (`api-exports`), and any stored JSON document a key later receives
 * through `blockDocumentAttributes`. Bodies that are not JSON (a file's bytes, a CSV) pass as they are;
 * a JSON body that does not parse is not sent (fail closed).
 *
 * Owner: `api-keys-webhooks`.
 */
import type { ApiKeyPrincipal, Principal } from '../../ports.js';

export interface KeyAttributeBlocklistContext {
  /** The key the response is served to; its `attributeBlocklist` is not empty. */
  principal: ApiKeyPrincipal;
  /** The key's blocklist (kebab-case attribute names, C14's grammar). */
  blocklist: readonly string[];
  /** The response's `Content-Type`, when it has one. */
  contentType: string | undefined;
}

/** The payload to send instead of `payload` (the serialized body Fastify is about to send). */
export type ApplyKeyAttributeBlocklist = (
  payload: unknown,
  context: KeyAttributeBlocklistContext,
) => unknown;

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A resource object or identifier: a string `type` with `attributes` or a string `id`. */
const isResource = (value: JsonObject): boolean =>
  typeof value.type === 'string' && (isObject(value.attributes) || typeof value.id === 'string');

/** A primary member a document can hold: `null`, a resource, or a list of objects. */
const isPrimaryData = (value: unknown): boolean =>
  value === null ||
  (isObject(value) && isResource(value)) ||
  (Array.isArray(value) && value.every(isObject));

/** An embedded document, such as an event's `payload`: a `data` member holding resources. */
const isDocument = (value: JsonObject): boolean => 'data' in value && isPrimaryData(value.data);

/** RFC 9457's members, the problem `code` and the field `errors`: never attribute values. */
const PROBLEM_MEMBERS = new Set([
  'type',
  'title',
  'status',
  'detail',
  'instance',
  'code',
  'errors',
]);
/** A resource's identity and links: kept whatever the list names. */
const RESOURCE_KEPT = new Set(['type', 'id', 'relationships', 'links']);
/** A resource's members whose contents the list applies to, never removed whole. */
const RESOURCE_WALKED = new Set(['attributes', 'meta']);
const NONE: ReadonlySet<string> = new Set();
/** A document's structure: kept whatever the list names. */
const DOCUMENT_KEPT = new Set(['links', 'jsonapi', 'errors']);

class Blocker {
  constructor(private readonly blocked: ReadonlySet<string>) {}

  /** Any value inside attributes or meta: blocked names go at any depth. */
  value(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.value(item));
    }
    if (!isObject(value)) {
      return value;
    }
    if (isResource(value)) {
      return this.resource(value);
    }
    if (isDocument(value)) {
      return this.document(value);
    }
    return this.members(value, new Set());
  }

  /**
   * `object` without its blocked names: `kept` stay untouched, `walked` stay with their values walked,
   * and every other member goes when the list names it and is walked otherwise.
   */
  private members(
    object: JsonObject,
    kept: ReadonlySet<string>,
    walked: ReadonlySet<string> = NONE,
  ): JsonObject {
    return Object.fromEntries(
      Object.entries(object)
        .filter(([name]) => kept.has(name) || walked.has(name) || !this.blocked.has(name))
        .map(([name, item]) => [name, kept.has(name) ? structuredClone(item) : this.value(item)]),
    );
  }

  resource(resource: JsonObject): JsonObject {
    return this.members(resource, RESOURCE_KEPT, RESOURCE_WALKED);
  }

  private primary(data: unknown): unknown {
    if (Array.isArray(data)) {
      return data.map((item) => this.primary(item));
    }
    return isObject(data) ? (isResource(data) ? this.resource(data) : this.value(data)) : data;
  }

  /** A document: `data` and `included` walked as resources, its `meta` and other members as values. */
  document(document: JsonObject): JsonObject {
    return Object.fromEntries(
      Object.entries(document)
        .filter(
          ([name]) =>
            name === 'data' ||
            name === 'included' ||
            name === 'meta' ||
            DOCUMENT_KEPT.has(name) ||
            !this.blocked.has(name),
        )
        .map(([name, item]) => {
          if (name === 'data' || name === 'included') {
            return [name, this.primary(item)];
          }
          return [name, DOCUMENT_KEPT.has(name) ? structuredClone(item) : this.value(item)];
        }),
    );
  }

  /** An RFC 9457 problem: its own members kept, an extension member named by the list gone. */
  problem(problem: JsonObject): JsonObject {
    return this.members(problem, PROBLEM_MEMBERS);
  }
}

/** A top-level problem: a numeric `status` and a `title`, as every problem of this API has. */
const isProblem = (value: JsonObject): boolean =>
  typeof value.status === 'number' && typeof value.title === 'string' && !isResource(value);

/**
 * The document without the blocked attributes (C169.3), for every JSON exit: an HTTP answer (through
 * the hook), and a stored document a key later receives. Returns a copy; `document` is not changed.
 */
export function blockDocumentAttributes(document: unknown, blocklist: readonly string[]): unknown {
  if (blocklist.length === 0) {
    return structuredClone(document);
  }
  const blocker = new Blocker(new Set(blocklist));
  if (Array.isArray(document)) {
    return blocker.value(document);
  }
  if (!isObject(document)) {
    return document;
  }
  return isProblem(document) ? blocker.problem(document) : blocker.document(document);
}

/**
 * C169.3: the export columns a key may receive (`api-exports` calls it when a key creates an export):
 * a column named by the list goes, and so does every column under it (`fields.<key>` under `fields`).
 * `id` is the resource's own and always stays.
 */
export function blockExportColumns(
  columns: readonly string[],
  blocklist: readonly string[],
): string[] {
  const blocked = new Set(blocklist);
  return columns.filter((column) => {
    const [head = column] = column.split('.', 1);
    return column === 'id' || !(blocked.has(column) || blocked.has(head));
  });
}

/** C169.3: a principal's attribute blocklist: a key's own, none for a user or a key without one. */
export function keyAttributeBlocklistOf(principal: Principal): readonly string[] {
  return principal.kind === 'api-key' ? (principal.attributeBlocklist ?? []) : [];
}

/** JSON media types: `application/json`, `application/vnd.api+json`, `application/problem+json`. */
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const JSON_MEDIA_TYPE = /^application\/(?:[\w.-]+\+)?json\b/i;

/** The body as text, when it is one Fastify can hold whole: a string or a Buffer. */
function textOf(payload: unknown): string | null {
  if (typeof payload === 'string') {
    return payload;
  }
  return Buffer.isBuffer(payload) ? payload.toString('utf8') : null;
}

export const applyKeyAttributeBlocklist: ApplyKeyAttributeBlocklist = (
  payload,
  { blocklist, contentType },
) => {
  const text = blocklist.length === 0 ? null : textOf(payload);
  if (text === null) {
    return payload;
  }
  const declaredJson = contentType !== undefined && JSON_MEDIA_TYPE.test(contentType.trim());
  if (contentType !== undefined && !declaredJson) {
    return payload;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A body declared JSON that does not parse could hold anything: it is not sent.
    return declaredJson ? '' : payload;
  }
  return JSON.stringify(blockDocumentAttributes(parsed, blocklist));
};
