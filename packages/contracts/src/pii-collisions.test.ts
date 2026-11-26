/**
 * C53.7, extended by C70.3 (P17): a PII attribute name is masked by name at every resource, so it
 * must never be a non-PII attribute of another resource. This walks every resource schema and
 * request body the package exports, not only the verifications, with one recorded exemption.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as contracts from './index.js';
import { PII_GRAPH_ATTRIBUTES } from './graph-queries.js';
import { PII_LIST_ATTRIBUTES } from './lists.js';
import { PII_REPORT_ATTRIBUTES } from './reports.js';
import { PII_SIGNAL_ATTRIBUTES } from './signal-pii.js';
import { PII_TRANSACTION_ATTRIBUTES } from './transactions.js';
import { PII_DECISION_ATTRIBUTES } from './decisions.js';
import { PII_CASE_ATTACHMENT_ATTRIBUTES } from './case-attachments.js';
import { PII_CASE_COMMENT_ATTRIBUTES } from './case-comments.js';
import { PII_CASE_ATTRIBUTES } from './cases.js';
import { PII_WORKFLOW_RUN_ATTRIBUTES } from './workflow-runs.js';
import { PII_VERIFICATION_ATTRIBUTES } from './verifications.js';

/**
 * The one exemption (P17): `api-log.query` is the logged query string. The API-log serializer
 * never passes it to `mask.attributes()`, and `maskPersonalData` masks its members by name, so
 * the report keeps the public name `query`.
 */
const EXEMPT = new Set([
  'api-log.query',
  // C112.4, C120.1: a version declares `inputs` and `outputs`, by the public names, and holds no
  // value. Its routes never pass them to `mask.attributes()`, and a stored API log masks them whole,
  // which fails closed on a list of names.
  'workflow-version.inputs',
  'workflow-version.outputs',
  // C122.5: the catalogue's `reason` is the plan's name, a closed code, and its route masks nothing.
  'workflow-action.reason',
]);

const isPii = (member: z.ZodType) => (member.meta() as { pii?: unknown } | undefined)?.pii === true;

interface SchemaLike {
  readonly options?: unknown;
  readonly def?: { readonly innerType?: unknown; readonly in?: unknown };
}

const asSchemaLike = (value: unknown): SchemaLike | null =>
  typeof value === 'object' && value !== null ? value : null;

/** A schema without its optional, nullable, refinement and pipe wrappers. */
function unwrap(schema: unknown): unknown {
  let current = schema;
  for (let depth = 0; depth < 8 && current !== undefined; depth += 1) {
    const like = asSchemaLike(current);
    if (current instanceof z.ZodObject || like?.options !== undefined) {
      return current;
    }
    current = like?.def?.innerType ?? like?.def?.in;
  }
  return current;
}

/** The objects a schema is: itself, or each variant of its union. */
function objectsOf(schema: unknown): z.ZodObject[] {
  const unwrapped = unwrap(schema);
  const options = asSchemaLike(unwrapped)?.options;
  if (Array.isArray(options)) {
    return options.flatMap((option) => objectsOf(option));
  }
  return unwrapped instanceof z.ZodObject ? [unwrapped] : [];
}

const literalOf = (schema: unknown): string | null =>
  schema instanceof z.ZodLiteral ? String(schema.value) : null;

/** Every `(resource or body, attribute name, member)` the package exports. */
function attributeMembers(): { owner: string; name: string; member: z.ZodType }[] {
  const found = new Map<string, { owner: string; name: string; member: z.ZodType }>();
  const record = (owner: string, attributes: unknown) => {
    for (const object of objectsOf(attributes)) {
      const members: Record<string, z.ZodType> = object.shape;
      for (const [name, member] of Object.entries(members)) {
        found.set(`${owner}.${name}.${String(isPii(member))}`, { owner, name, member });
      }
    }
  };
  for (const [exportName, value] of Object.entries(contracts)) {
    for (const object of objectsOf(value)) {
      const shape = object.shape as Record<string, unknown>;
      // A resource `{ type, id, attributes }`.
      if (shape.attributes !== undefined) {
        record(literalOf(shape.type) ?? exportName, shape.attributes);
      }
      // A document or request body `{ data: ... }` whose data carries attributes.
      for (const data of objectsOf(shape.data)) {
        const dataShape = data.shape as Record<string, unknown>;
        if (dataShape.attributes !== undefined) {
          record(literalOf(dataShape.type) ?? exportName, dataShape.attributes);
        }
      }
    }
  }
  return [...found.values()];
}

describe('PII attribute names (C53.7, C70.3)', () => {
  it('walks the resources and bodies of every phase, reports and verifications among them', () => {
    const owners = new Set(attributeMembers().map(({ owner }) => owner));
    for (const owner of [
      'inquiry',
      'account',
      'api-log',
      'verification/government-id',
      'report/watchlist',
      'report-action',
    ]) {
      expect(owners, owner).toContain(owner);
    }
  });

  it('never names an attribute another resource serves as not PII, but the recorded exemption', () => {
    const pii = new Set([
      ...PII_VERIFICATION_ATTRIBUTES,
      ...PII_REPORT_ATTRIBUTES,
      // C107.5 (Phase 7): sessions, networks, devices and the handoff bodies.
      ...PII_SIGNAL_ATTRIBUTES,
      // C107.5 (Workflow 7B): list items, probes, matches and dismissals.
      ...PII_LIST_ATTRIBUTES,
      ...PII_TRANSACTION_ATTRIBUTES,
      ...PII_GRAPH_ATTRIBUTES,
      // C143.5 (Workflow 8A): run values, trigger fields and their request bodies.
      ...PII_WORKFLOW_RUN_ATTRIBUTES,
      ...PII_DECISION_ATTRIBUTES,
      // C143.5 (Workflow 8B): a case's fields, a comment's message and what a body carries.
      ...PII_CASE_ATTRIBUTES,
      ...PII_CASE_COMMENT_ATTRIBUTES,
      ...PII_CASE_ATTACHMENT_ATTRIBUTES,
    ]);
    const clashes = attributeMembers()
      .filter(({ name, member }) => pii.has(name) && !isPii(member))
      .map(({ owner, name }) => `${owner}.${name}`)
      .filter((name) => !EXEMPT.has(name));
    expect([...new Set(clashes)].sort()).toEqual([]);
  });

  it('keeps the workflow exemptions needed: a version declares what a run holds (C112.4)', () => {
    const members = attributeMembers();
    for (const name of ['inputs', 'outputs']) {
      expect(
        members.some((member) => member.owner === 'workflow-version' && member.name === name),
      ).toBe(true);
      expect(PII_WORKFLOW_RUN_ATTRIBUTES).toContain(name);
    }
  });

  it('keeps the exemption needed: api-log.query is a non-PII attribute and query is PII on reports', () => {
    const members = attributeMembers();
    expect(
      members.some(
        ({ owner, name, member }) => owner === 'api-log' && name === 'query' && !isPii(member),
      ),
    ).toBe(true);
    expect(PII_REPORT_ATTRIBUTES).toContain('query');
  });
});
