/**
 * Where each action's config members go (plan C115.2, C115.6, C125.3): which encoder a rendered value
 * gets, which members are plain sinks that refuse PII taint, and where a secret may be placed. It is
 * data, so Workflow 8B adds its case actions by passing rows (F33), and `api-egress` renders each
 * member with the sink this table names.
 */
import { pointerOf, type DefinitionIssue, type JsonRecord } from '../expressions/json.js';
import {
  parseTemplate,
  type ParsedTemplate,
  type TemplateReference,
  type TemplateSink,
} from './render.js';

export interface ConfigSink {
  readonly sink: TemplateSink;
  /** C115.6: taint here is `pii_into_plain_sink`. */
  readonly plain: boolean;
  /** C125.3: a secret reference may stand here. */
  readonly secret: boolean;
  /** C122.1: what decides a gate is a literal, so no value chooses it. */
  readonly literal: boolean;
}

/** A member by JSON Pointer from the config, with `*` for any one token and `**` for the rest. */
export interface ActionSinkRow {
  readonly key: string;
  readonly member: string;
  readonly sink: TemplateSink;
  readonly plain?: boolean;
  readonly secret?: boolean;
  readonly literal?: boolean;
}

/** C115.2, C125.3, C126: 8A's rows. Everything else is a JSON value, and takes PII and no secret. */
export const ACTION_SINK_ROWS: readonly ActionSinkRow[] = Object.freeze([
  { key: 'make_https_request', member: '/url', sink: 'url' },
  { key: 'make_https_request', member: '/headers/*/value', sink: 'header', secret: true },
  { key: 'make_https_request', member: '/body/**', sink: 'json', secret: true },
  { key: 'make_https_request', member: '/signing/secret', sink: 'header', secret: true },
  { key: 'send_email', member: '/recipient', sink: 'text' },
  { key: 'send_email', member: '/subject', sink: 'text' },
  { key: 'send_email', member: '/text', sink: 'text' },
  { key: 'send_email', member: '/html', sink: 'email-html' },
  { key: 'send_sms', member: '/recipient', sink: 'text' },
  { key: 'send_sms', member: '/text', sink: 'text' },
  { key: 'send_slack_message', member: '/webhook-secret', sink: 'header', secret: true },
  { key: 'send_slack_message', member: '/text', sink: 'slack-text' },
  // C115.6, C127.8: a tag name is plain, and so is a status.
  { key: 'tag_object', member: '/tag', sink: 'text', plain: true },
  { key: 'remove_tag', member: '/tag', sink: 'text', plain: true },
  { key: 'update_transaction_status', member: '/status', sink: 'text', literal: true },
]);

const JSON_VALUE: ConfigSink = Object.freeze({
  sink: 'json',
  plain: false,
  secret: false,
  literal: false,
});

function matches(pattern: readonly string[], tokens: readonly string[]): boolean {
  for (const [index, part] of pattern.entries()) {
    if (part === '**') {
      return true;
    }
    if (part !== '*' && part !== tokens[index]) {
      return false;
    }
  }
  return pattern.length === tokens.length;
}

export interface ActionSinkTable {
  /** What a config member of `key` is, by its JSON Pointer from the config. */
  sinkOf(key: string, pointer: string): ConfigSink;
}

/** 8B passes its rows beside {@link ACTION_SINK_ROWS}. */
export function createActionSinkTable(rows: readonly ActionSinkRow[]): ActionSinkTable {
  const byKey = new Map<string, (readonly [readonly string[], ConfigSink])[]>();
  for (const { key, member, sink, plain = false, secret = false, literal = false } of rows) {
    const list = byKey.get(key) ?? [];
    list.push([member.split('/').slice(1), { sink, plain, secret, literal }]);
    byKey.set(key, list);
  }
  return Object.freeze({
    sinkOf(key: string, pointer: string): ConfigSink {
      const tokens = pointer.split('/').slice(1);
      const found = byKey.get(key)?.find(([pattern]) => matches(pattern, tokens));
      return found?.[1] ?? JSON_VALUE;
    },
  });
}

export const ACTION_SINKS = createActionSinkTable(ACTION_SINK_ROWS);

const KIB = 1024;

/** C123.2: code, read by the sandbox and never as a template (C113.8). */
const NOT_A_TEMPLATE: ReadonlySet<string> = new Set(['source']);

/** C124.1, C126.1, Stage 1a amendment 21: members with caps of their own, which their schemas hold. */
const MEMBER_CAPS: Readonly<Record<string, number>> = { body: 256 * KIB, html: 64 * KIB };

export interface ConfigTemplates {
  /** Each member's parsed template, by its name, for the action that renders it for its sink. */
  readonly members: ReadonlyMap<string, ParsedTemplate>;
  /** Every reference, its pointer relative to the config. */
  readonly references: readonly TemplateReference[];
  readonly issues: readonly DefinitionIssue[];
}

/** C115.1: an action's config, member by member, each under its own cap. */
export function parseConfigTemplates(config: JsonRecord): ConfigTemplates {
  const members = new Map<string, ParsedTemplate>();
  const references: TemplateReference[] = [];
  const issues: DefinitionIssue[] = [];
  for (const [name, raw] of Object.entries(config)) {
    if (!NOT_A_TEMPLATE.has(name)) {
      const base = pointerOf('', name);
      const cap = Object.hasOwn(MEMBER_CAPS, name) ? MEMBER_CAPS[name] : undefined;
      const parsed = parseTemplate(raw, cap === undefined ? {} : { maxBytes: cap });
      if (parsed.ok) {
        members.set(name, parsed.template);
        references.push(
          ...parsed.template.references.map((reference) => ({
            ...reference,
            pointer: `${base}${reference.pointer}`,
          })),
        );
      } else {
        issues.push(
          ...parsed.issues.map((issue) => ({ ...issue, pointer: `${base}${issue.pointer}` })),
        );
      }
    }
  }
  return { members, references, issues };
}
