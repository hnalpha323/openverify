/**
 * The place a JSON Pointer inside a template's verification config points at, in words (C37).
 * The API validates each check's `config` with the check's registry schema (C29.5) and the
 * allowlists (C11), and answers each problem by pointer, such as
 * `/data/attributes/verification-config/government-id/checks/id_blur_detection/config/min-blur-score`.
 * The template editor shows the pointer inside the document and these words, so the operator
 * sees which check and key are wrong; the console validates nothing itself.
 */
import {
  API_VERIFICATION_TYPES,
  fromApiVerificationType,
  toVerificationResourceType,
} from '@openverify/contracts';
import { VERIFICATION_TYPE_LABELS } from '../../lib/labels';

/** The verification types of a verification config, by their key (C11, C50.4): every API type. */
const TYPE_LABELS: ReadonlyMap<string, string> = new Map(
  API_VERIFICATION_TYPES.map((type) => [
    type,
    VERIFICATION_TYPE_LABELS[toVerificationResourceType(fromApiVerificationType(type))],
  ]),
);

/** The allowlists of a verification type (C11, C50.4). */
const LIST_LABELS: ReadonlyMap<string, string> = new Map([
  ['allowed-countries', 'allowed countries'],
  ['allowed-id-classes', 'allowed ID classes'],
  ['allowed-chains', 'allowed chains'],
]);

/** The switches of a verification type (C50.4). */
const OPTION_LABELS: ReadonlyMap<string, string> = new Map([
  ['accept-review-without-provider', 'accept review without a provider'],
]);

/** The switches of one check (C11). */
const CHECK_MEMBERS: ReadonlySet<string> = new Set(['enabled', 'required']);

/** `pointer`'s reference tokens, unescaped (RFC 6901). */
function tokensOf(pointer: string): string[] {
  return pointer
    .split('/')
    .slice(1)
    .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'));
}

/** "entry 3" for the index token `2`; `undefined` for anything else. */
function entry(token: string | undefined): string | undefined {
  return token !== undefined && /^\d+$/.test(token)
    ? `entry ${String(Number(token) + 1)}`
    : undefined;
}

/** The words for what comes after `/<type>/checks/<check>`. */
function checkPart(rest: readonly string[]): string | undefined {
  const [member, key, index, ...deeper] = rest;
  if (member === undefined) {
    return '';
  }
  if (CHECK_MEMBERS.has(member)) {
    return key === undefined ? member : undefined;
  }
  if (member !== 'config' || deeper.length > 0) {
    return undefined;
  }
  if (key === undefined) {
    return 'settings';
  }
  if (index === undefined) {
    return `setting ${key}`;
  }
  const item = entry(index);
  return item === undefined ? undefined : `setting ${key}, ${item}`;
}

/** Where `pointer` (inside the verification config) points, in words, or `undefined`. */
export function describeConfigPointer(pointer: string): string | undefined {
  const [type, member, name, ...rest] = tokensOf(pointer);
  const typeLabel = type === undefined ? undefined : TYPE_LABELS.get(type);
  if (typeLabel === undefined) {
    return undefined;
  }
  if (member === undefined) {
    return typeLabel;
  }
  const option = OPTION_LABELS.get(member);
  if (option !== undefined) {
    return name === undefined ? `${typeLabel}, ${option}` : undefined;
  }
  const list = LIST_LABELS.get(member);
  if (list !== undefined) {
    if (name === undefined) {
      return `${typeLabel}, ${list}`;
    }
    const item = entry(name);
    return item === undefined || rest.length > 0 ? undefined : `${typeLabel}, ${list}, ${item}`;
  }
  if (member !== 'checks') {
    return undefined;
  }
  if (name === undefined) {
    return `${typeLabel}, checks`;
  }
  const part = checkPart(rest);
  if (part === undefined) {
    return undefined;
  }
  return part === '' ? `${typeLabel}, check ${name}` : `${typeLabel}, check ${name}, ${part}`;
}
