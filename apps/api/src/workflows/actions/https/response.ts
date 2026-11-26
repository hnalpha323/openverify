/**
 * C124.1, C124.5: what a response becomes in a step's output. A 2xx is `application/json`, parsed with
 * a depth limit, or `text/plain`, as a string; anything else never reaches here (the client refuses
 * it). The response feeds conditions only through its declared schema: with one, the body holds the
 * declared members alone, each of its type, or the step errors. An error body is kept only when the
 * step asked, and is no declared answer, so it is read as it came.
 */
import { checkValue, parseTypeDsl, type JsonValue } from '@openverify/workflow-engine';
import {
  HTTPS_ACTION_LIMITS,
  type MakeHttpsRequestConfig,
} from '@openverify/workflow-engine/actions';
import { ActionStepError } from '../../engine/action-port.js';

const unsupported = (): ActionStepError => new ActionStepError('response_unsupported');

function depthWithin(value: JsonValue, limit: number): boolean {
  const stack: { value: JsonValue; depth: number }[] = [{ value, depth: 1 }];
  for (let entry = stack.pop(); entry !== undefined; entry = stack.pop()) {
    if (entry.depth > limit) {
      return false;
    }
    if (typeof entry.value === 'object' && entry.value !== null) {
      for (const member of Object.values(entry.value)) {
        stack.push({ value: member, depth: entry.depth + 1 });
      }
    }
  }
  return true;
}

function parseJson(text: string): JsonValue {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(text) as JsonValue;
  } catch {
    throw unsupported();
  }
  if (!depthWithin(parsed, HTTPS_ACTION_LIMITS['response-depth'].value)) {
    throw unsupported();
  }
  return parsed;
}

function declaredMembers(
  body: JsonValue,
  schema: NonNullable<MakeHttpsRequestConfig['response-schema']>,
): JsonValue {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw unsupported();
  }
  const kept: Record<string, JsonValue> = {};
  for (const { name, type } of schema) {
    const parsed = parseTypeDsl(type);
    const value = Object.hasOwn(body, name) ? body[name] : undefined;
    if (!parsed.ok || checkValue(parsed.type, value).length > 0 || value === undefined) {
      throw unsupported();
    }
    kept[name] = value;
  }
  return kept;
}

/** A 2xx body as the step's output holds it. */
export function successBody(
  bytes: Uint8Array,
  contentType: string | null,
  schema: MakeHttpsRequestConfig['response-schema'],
): JsonValue {
  const text = new TextDecoder().decode(bytes);
  if (text === '') {
    return null;
  }
  const body = contentType === 'application/json' ? parseJson(text) : text;
  return schema === undefined ? body : declaredMembers(body, schema);
}

/** A kept error body: JSON when it reads as JSON, text otherwise. */
export function errorBody(bytes: Uint8Array): JsonValue {
  const text = new TextDecoder().decode(bytes);
  if (text === '') {
    return null;
  }
  try {
    return parseJson(text);
  } catch {
    return text;
  }
}
