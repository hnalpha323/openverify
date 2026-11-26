/**
 * Value templates (plan C115.1, C115.2). A template is a JSON value, not text: a string leaf may hold
 * `{{ path }}` references in the path grammar of C114.4, a leaf that is exactly one reference takes
 * the value with its JSON type, and other leaves interpolate strings. The sink serialises the built
 * value once, so a value can never break out of a JSON string. There is no logic, no filter and no
 * helper here, and no template library: nothing an operator writes is compiled (C113.8).
 *
 * The sink picks the encoding, never the author. A missing value is a step error, never an empty
 * string. An answer holds a code, never a value, because a rendered value can be anything a run read.
 */
import {
  isJsonRecord,
  pointerOf,
  type DefinitionIssue,
  type JsonValue,
} from '../expressions/json.js';
import {
  isPathRoot,
  isSecretPath,
  parsePath,
  readRootPath,
  type ParsedPath,
} from '../expressions/paths.js';
import { TEMPLATE_LIMITS, type EngineErrorCode } from '../limits/index.js';

/** C115.2: every place a rendered value can go. `url` is one string with a literal origin. */
export const TEMPLATE_SINKS = [
  'json',
  'text',
  'header',
  'email-html',
  'slack-text',
  'url',
] as const;
export type TemplateSink = (typeof TEMPLATE_SINKS)[number];

/** C125.3: the only sinks a secret may reach; each action narrows them further. */
const SECRET_SINKS: ReadonlySet<TemplateSink> = new Set(['json', 'header']);

export interface TemplateReference {
  readonly path: ParsedPath;
  /** Where the leaf is, relative to the template. */
  readonly pointer: string;
  /** The secret's key when this is `{{ secrets.<key> }}`, in either spelling. */
  readonly secret: string | null;
}

type Part = string | TemplateReference;

type TemplateNode =
  | { readonly kind: 'literal'; readonly value: JsonValue }
  | { readonly kind: 'reference'; readonly reference: TemplateReference }
  | { readonly kind: 'text'; readonly parts: readonly Part[] }
  | { readonly kind: 'list'; readonly items: readonly TemplateNode[] }
  | { readonly kind: 'object'; readonly members: readonly (readonly [string, TemplateNode])[] };

export interface ParsedTemplate {
  readonly raw: JsonValue;
  readonly references: readonly TemplateReference[];
  /** The walked form; only this file reads it. */
  readonly node: TemplateNode;
}

export type TemplateParse =
  | { readonly ok: true; readonly template: ParsedTemplate }
  | { readonly ok: false; readonly issues: readonly DefinitionIssue[] };

const OPEN = '{{';
const CLOSE = '}}';
const MAX_DEPTH = 64;

interface Reading {
  readonly issues: DefinitionIssue[];
  readonly references: TemplateReference[];
}

function secretKey(path: ParsedPath): string | null | undefined {
  if (!isSecretPath(path)) {
    return null;
  }
  const key = path.segments[0] === 'secrets' ? path.segments.slice(1) : path.segments.slice(3);
  const [name] = key;
  return key.length === 1 && typeof name === 'string' ? name : undefined;
}

function readReference(text: string, pointer: string, reading: Reading): TemplateReference | null {
  const path = parsePath(text);
  const secret = path === null ? undefined : secretKey(path);
  if (path === null || text === '' || secret === undefined) {
    reading.issues.push({
      pointer,
      code: 'template_invalid',
      detail: 'A reference is one path, with no logic',
    });
    return null;
  }
  if (secret === null && !isPathRoot(path.segments[0])) {
    reading.issues.push({
      pointer,
      code: 'path_unknown',
      detail: 'A path starts at one of the stated roots',
    });
    return null;
  }
  const reference = { path, pointer, secret };
  reading.references.push(reference);
  return reference;
}

function readLeaf(text: string, pointer: string, reading: Reading): TemplateNode {
  const parts: Part[] = [];
  let position = 0;
  for (;;) {
    const open = text.indexOf(OPEN, position);
    if (open === -1) {
      break;
    }
    const close = text.indexOf(CLOSE, open + OPEN.length);
    if (close === -1) {
      reading.issues.push({
        pointer,
        code: 'template_invalid',
        detail: 'A reference is not closed',
      });
      return { kind: 'literal', value: text };
    }
    if (open > position) {
      parts.push(text.slice(position, open));
    }
    const reference = readReference(text.slice(open + OPEN.length, close).trim(), pointer, reading);
    if (reference !== null) {
      parts.push(reference);
    }
    position = close + CLOSE.length;
  }
  if (parts.length === 0) {
    return { kind: 'literal', value: text };
  }
  if (position < text.length) {
    parts.push(text.slice(position));
  }
  const [only] = parts;
  return parts.length === 1 && typeof only === 'object'
    ? { kind: 'reference', reference: only }
    : { kind: 'text', parts };
}

function readNode(raw: JsonValue, pointer: string, reading: Reading): TemplateNode {
  if (typeof raw === 'string') {
    return readLeaf(raw, pointer, reading);
  }
  if (Array.isArray(raw)) {
    return {
      kind: 'list',
      items: raw.map((item, index) => readNode(item, pointerOf(pointer, index), reading)),
    };
  }
  if (isJsonRecord(raw)) {
    return {
      kind: 'object',
      members: Object.entries(raw).map(
        ([name, member]) => [name, readNode(member, pointerOf(pointer, name), reading)] as const,
      ),
    };
  }
  return { kind: 'literal', value: raw };
}

/** An iterative walk, so a value deeper than the stack is measured, never recursed into. */
function isShallow(raw: JsonValue): boolean {
  const stack: { readonly value: JsonValue; readonly depth: number }[] = [{ value: raw, depth: 1 }];
  for (let entry = stack.pop(); entry !== undefined; entry = stack.pop()) {
    if (entry.depth > MAX_DEPTH) {
      return false;
    }
    if (typeof entry.value === 'object' && entry.value !== null) {
      for (const value of Object.values(entry.value)) {
        stack.push({ value, depth: entry.depth + 1 });
      }
    }
  }
  return true;
}

const utf8Bytes = (text: string): number => Buffer.byteLength(text, 'utf8');

export interface TemplateParseOptions {
  /** A member with a cap of its own (Stage 1a amendment 21); 32 KiB otherwise (C115.2). */
  readonly maxBytes?: number;
}

const TOO_LARGE: DefinitionIssue = {
  pointer: '',
  code: 'template_too_large',
  detail: 'A template is at most 32 KiB serialised',
};

/** C115.1: a stored template as a tree, or every problem with it. It quotes nothing it was given. */
export function parseTemplate(raw: JsonValue, options: TemplateParseOptions = {}): TemplateParse {
  const limit = options.maxBytes ?? TEMPLATE_LIMITS['template-bytes'].value;
  if (!isShallow(raw) || utf8Bytes(JSON.stringify(raw)) > limit) {
    return { ok: false, issues: [TOO_LARGE] };
  }
  const reading: Reading = { issues: [], references: [] };
  const node = readNode(raw, '', reading);
  return reading.issues.length > 0
    ? { ok: false, issues: reading.issues }
    : { ok: true, template: { raw, references: reading.references, node } };
}

export interface RenderScope {
  /** The roots of C114.4. */
  readonly roots: Readonly<Record<string, JsonValue | undefined>>;
  /** C125.5: resolved last, only for the step that places them. */
  readonly secrets?: Readonly<Record<string, string>>;
}

export interface RenderOptions {
  /** C115.2: a sink's own cap, in bytes, when it is smaller than 1 MiB. */
  readonly maxBytes?: number;
}

export type Rendered =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly code: EngineErrorCode };

/** How a render stops early. Caught in this file alone. */
class RenderStop extends Error {
  override readonly name = 'RenderStop';

  constructor(readonly code: EngineErrorCode) {
    super('stop');
  }
}

const stop = (code: EngineErrorCode): never => {
  throw new RenderStop(code);
};

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const SLACK_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

const escapeWith = (
  text: string,
  characters: RegExp,
  escapes: Readonly<Record<string, string>>,
): string => text.replace(characters, (character) => escapes[character] ?? character);

const FORBIDDEN_HEADER_CHARACTERS = /[\r\n\0]/;

/** C115.2: what each sink does to an interpolated value. */
function encode(text: string, sink: Exclude<TemplateSink, 'url'>): string {
  switch (sink) {
    case 'email-html':
      return escapeWith(text, /[&<>"']/g, HTML_ESCAPES);
    case 'slack-text':
      return escapeWith(text, /[&<>]/g, SLACK_ESCAPES);
    case 'header':
      return FORBIDDEN_HEADER_CHARACTERS.test(text) ? stop('template_value_refused') : text;
    default:
      return text;
  }
}

function resolve(reference: TemplateReference, scope: RenderScope, sink: TemplateSink): JsonValue {
  const { secret, path } = reference;
  // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
  if (secret !== null) {
    if (!SECRET_SINKS.has(sink)) {
      return stop('secret_placement_refused');
    }
    const secrets = scope.secrets ?? {};
    const value = Object.hasOwn(secrets, secret) ? secrets[secret] : undefined;
    return value ?? stop('template_variable_missing');
  }
  const read = readRootPath(scope.roots, path);
  if (read.kind === 'unset') {
    return stop('variable_unset');
  }
  return read.value === undefined ? stop('template_variable_missing') : read.value;
}

function textOf(value: JsonValue): string {
  if (value === null) {
    return stop('template_variable_missing');
  }
  return typeof value === 'object' ? stop('template_type_mismatch') : String(value);
}

function renderText(
  parts: readonly Part[],
  scope: RenderScope,
  sink: Exclude<TemplateSink, 'url'>,
): string {
  return parts
    .map((part) =>
      typeof part === 'string' ? part : encode(textOf(resolve(part, scope, sink)), sink),
    )
    .join('');
}

function renderNode(
  node: TemplateNode,
  scope: RenderScope,
  sink: Exclude<TemplateSink, 'url'>,
): JsonValue {
  switch (node.kind) {
    case 'literal':
      return node.value;
    case 'text':
      return renderText(node.parts, scope, sink);
    case 'reference': {
      const value = resolve(node.reference, scope, sink);
      if (sink === 'json') {
        return value;
      }
      return encode(textOf(value), sink);
    }
    case 'list':
      return node.items.map((item) => renderNode(item, scope, sink));
    default: {
      const members: Record<string, JsonValue> = {};
      for (const [name, member] of node.members) {
        // A plain definition, so a member named `__proto__` is a member and nothing else.
        Object.defineProperty(members, name, {
          value: renderNode(member, scope, sink),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return members;
    }
  }
}

const QUERY = '?';
const FRAGMENT = '#';

type UrlPosition = 'path' | 'query-value' | 'other';

/** Where the end of `text` falls in a URL whose origin is already behind it. */
function positionAfter(text: string): UrlPosition {
  if (text.includes(FRAGMENT)) {
    return 'other';
  }
  const query = text.indexOf(QUERY);
  if (query === -1) {
    return 'path';
  }
  const pair = text.slice(text.lastIndexOf('&') + 1);
  return pair.includes('=') || text.lastIndexOf('=') > Math.max(query, text.lastIndexOf('&'))
    ? 'query-value'
    : 'other';
}

function renderUrl(node: TemplateNode, scope: RenderScope): string {
  const parts = node.kind === 'text' ? node.parts : [];
  if (node.kind === 'literal' && typeof node.value === 'string') {
    return node.value;
  }
  let url = '';
  let literal = '';
  parts.forEach((part, index) => {
    if (typeof part === 'string') {
      literal += part;
      url += part;
      return;
    }
    const text = textOf(resolve(part, scope, 'url'));
    const before = parts[index - 1];
    const after = parts[index + 1];
    const whole =
      typeof before === 'string' &&
      before.endsWith('/') &&
      (after === undefined || (typeof after === 'string' && /^[/?#]/.test(after)));
    if (positionAfter(literal) === 'path' && whole && (text === '.' || text === '..')) {
      stop('template_value_refused');
    }
    url += encodeURIComponent(text);
  });
  return url;
}

function within(value: JsonValue, limit: number): boolean {
  const bytes = utf8Bytes(typeof value === 'string' ? value : JSON.stringify(value));
  return bytes <= limit;
}

/**
 * C115.2: a template rendered for its sink, or a step error. A secret is placed here and nowhere
 * else, so the step's recorded input stays the unresolved template (C125.5).
 */
export function renderTemplate(
  template: ParsedTemplate,
  scope: RenderScope,
  sink: TemplateSink,
  options: RenderOptions = {},
): Rendered {
  const limit = Math.min(
    options.maxBytes ?? Number.MAX_SAFE_INTEGER,
    TEMPLATE_LIMITS['rendered-bytes'].value,
  );
  try {
    const value =
      sink === 'url' ? renderUrl(template.node, scope) : renderNode(template.node, scope, sink);
    return within(value, limit) ? { ok: true, value } : { ok: false, code: 'payload_too_large' };
  } catch (error) {
    if (error instanceof RenderStop) {
      return { ok: false, code: error.code };
    }
    throw error;
  }
}

const urlIssue = (code: string, detail: string): readonly DefinitionIssue[] => [
  { pointer: '', code, detail },
];

// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const ORIGIN = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([/?#].*)?$/is;

/**
 * C124.3: the scheme, host and port are literal in the published definition, and a reference fills
 * only a path segment or a query value, so end-user data never becomes a DNS label.
 */
export function checkUrlTemplate(template: ParsedTemplate): readonly DefinitionIssue[] {
  const { node } = template;
  const parts: readonly Part[] =
    node.kind === 'text'
      ? node.parts
      : node.kind === 'reference'
        ? [node.reference]
        : node.kind === 'literal' && typeof node.value === 'string'
          ? [node.value]
          : [];
  const [first] = parts;
  if (first === undefined) {
    return urlIssue('url_invalid', 'A URL is text');
  }
  if (typeof first !== 'string') {
    return urlIssue('url_host_not_literal', 'The scheme, host and port are literal');
  }
  const origin = ORIGIN.exec(first);
  if (origin === null) {
    return parts.length > 1
      ? urlIssue('url_host_not_literal', 'The scheme, host and port are literal')
      : urlIssue('url_invalid', 'This is not a URL');
  }
  const [, scheme = '', authority = '', rest] = origin;
  if (rest === undefined && parts.length > 1) {
    return urlIssue('url_host_not_literal', 'The scheme, host and port are literal');
  }
  if (scheme.toLowerCase() !== 'https') {
    return urlIssue('url_scheme_refused', 'A workflow request is HTTPS');
  }
  if (authority.includes('@')) {
    return urlIssue('url_credentials_refused', 'A URL holds no credentials');
  }
  let literal = rest ?? '';
  for (const part of parts.slice(1)) {
    if (typeof part === 'string') {
      literal += part;
    } else if (positionAfter(literal) === 'other') {
      return urlIssue('url_position_refused', 'A reference fills a path or a query value');
    }
  }
  return [];
}
