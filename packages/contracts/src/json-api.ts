/**
 * JSON:API-style envelopes (contract C1). Attribute names are kebab-case. Every helper
 * builds strict objects, so a response that carries an undeclared member (for example a
 * write-once secret) fails validation instead of leaking.
 *
 * Response schemas contain no transforms: fastify-type-provider-zod serializes responses with
 * `z.encode`, which rejects unidirectional transforms.
 */
import { z } from 'zod';
import { idSchema, type IdPrefix } from './ids.js';

/** ISO-8601 timestamp in UTC (`Z` suffix), e.g. `2026-10-20T12:00:00.000Z`. */
export const timestampSchema = z.iso.datetime();

/**
 * Serializes a date as an ISO-8601 UTC timestamp.
 * @throws {RangeError} for an invalid date.
 */
export function toTimestamp(date: Date): string {
  return date.toISOString();
}

/**
 * `toTimestamp`, or `null` for a missing date.
 * @throws {RangeError} for an invalid date.
 */
export function toNullableTimestamp(date: Date | null): string | null {
  return date === null ? null : toTimestamp(date);
}

/** Whether no value occurs twice; list schemas refine with it. */
export function hasDistinctValues(values: readonly unknown[]): boolean {
  return new Set(values).size === values.length;
}

/** `{ type, id }` linkage to one resource type. */
export function resourceIdentifierSchema<const T extends string>(type: T, prefix: IdPrefix) {
  return z.strictObject({ type: z.literal(type), id: idSchema(prefix) });
}

export function toOneRelationshipSchema<Identifier extends z.ZodType>(identifier: Identifier) {
  return z.strictObject({ data: identifier });
}

export function toManyRelationshipSchema<Identifier extends z.ZodType>(identifier: Identifier) {
  return z.strictObject({ data: z.array(identifier) });
}

/** Resource object without relationships: `{ type, id, attributes }`. */
export function resourceSchema<const T extends string, Attributes extends z.ZodType>(
  type: T,
  prefix: IdPrefix,
  attributes: Attributes,
) {
  return z.strictObject({ type: z.literal(type), id: idSchema(prefix), attributes });
}

/** Resource object with relationships: `{ type, id, attributes, relationships }`. */
export function resourceWithRelationshipsSchema<
  const T extends string,
  Attributes extends z.ZodType,
  Relationships extends z.ZodType,
>(type: T, prefix: IdPrefix, attributes: Attributes, relationships: Relationships) {
  return z.strictObject({
    type: z.literal(type),
    id: idSchema(prefix),
    attributes,
    relationships,
  });
}

/** `{ data: <resource> }`. */
export function singleDocumentSchema<Resource extends z.ZodType>(resource: Resource) {
  return z.strictObject({ data: resource });
}

/** `{ data: [<resource>...], links: { next } }`; `next` is null on the last page. */
export function listDocumentSchema<Resource extends z.ZodType>(resource: Resource) {
  return z.strictObject({
    data: z.array(resource),
    links: z.strictObject({ next: z.string().nullable() }),
  });
}

/** Request body `{ data: { type?, attributes } }`; `type`, when sent, must match. */
export function requestDocumentSchema<const T extends string, Attributes extends z.ZodType>(
  type: T,
  attributes: Attributes,
) {
  return z.strictObject({
    data: z.strictObject({ type: z.literal(type).optional(), attributes }),
  });
}

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

/** `page[size]` query parameter, coerced from its string form. */
export const pageSizeSchema = z.coerce.number().int().min(1).max(MAX_PAGE_SIZE);
