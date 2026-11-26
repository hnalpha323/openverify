/** Plain JSON, the only values a condition or a template ever reads (plan C114.2). */
import type { z } from 'zod';

export type JsonValue = z.core.util.JSONType;
export type JsonScalar = Exclude<JsonValue, object> | null;
export type JsonRecord = Readonly<Record<string, JsonValue>>;

export const isJsonRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A JSON Pointer token (RFC 6901). */
export const pointerToken = (token: string | number): string =>
  String(token).replaceAll('~', '~0').replaceAll('/', '~1');

/** `base` followed by `tokens`, each escaped. */
export const pointerOf = (base: string, ...tokens: readonly (string | number)[]): string =>
  tokens.reduce<string>((pointer, token) => `${pointer}/${pointerToken(token)}`, base);

/** One finding in a definition (C113.6): never a received value, only names we declare. */
export interface DefinitionIssue {
  readonly pointer: string;
  readonly code: string;
  readonly detail: string;
}
