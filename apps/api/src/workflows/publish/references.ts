/**
 * C112.2, C116.4: the objects a definition names. An id can stand anywhere: in a step's config, in a
 * module step, or inside a condition (`trigger.template.id` in a list), so the definition is walked
 * whole, with `layout` left out. A template (`{{ vars.list }}`) names nothing here: it resolves in
 * the run, inside the run's environment.
 */
import { workflowDefinitionSchema, type WorkflowDefinition } from '@openverify/contracts';
import type { WorkflowReferenceKind } from '@openverify/db';
import { CASE_KIND_OF_PREFIX, CASE_REFERENCE_MEMBERS } from '../actions/cases/references.js';

export interface DefinitionReference {
  pointer: string;
  id: string;
  kind: WorkflowReferenceKind;
}

const KIND_OF_PREFIX: Readonly<Record<string, WorkflowReferenceKind>> = {
  itmpl: 'inquiry-template',
  rptp: 'report-template',
  lst: 'list',
  txntp: 'transaction-type',
  acctp: 'account-type',
  grqt: 'graph-query-template',
  wfl: 'workflow',
  // Workflow 8B (C121.6): the case kinds, `api-case-workflows`' to name.
  ...CASE_KIND_OF_PREFIX,
};

const ID = /^([a-z]+)_[0-9A-HJKMNP-TV-Z]{26}$/;

/** C140.5: the config members that must name an object once a version is published. */
const REFERENCE_MEMBERS: ReadonlySet<string> = new Set([
  'report-template-id',
  'inquiry-template-id',
  'list-id',
  'transaction-type-id',
  'account-type-id',
  'graph-query-template-id',
  'workflow-id',
  ...CASE_REFERENCE_MEMBERS,
]);

type Visit = (pointer: string, value: string, member: string) => void;

const token = (key: string) => key.replaceAll('~', '~0').replaceAll('/', '~1');

function walk(value: unknown, pointer: string, member: string, visit: Visit): void {
  if (typeof value === 'string') {
    visit(pointer, value, member);
  } else if (Array.isArray(value)) {
    value.forEach((item: unknown, index) => {
      walk(item, `${pointer}/${String(index)}`, member, visit);
    });
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      walk(item, `${pointer}/${token(key)}`, key, visit);
    }
  }
}

function withoutLayout(definition: WorkflowDefinition): Partial<WorkflowDefinition> {
  const copy: Partial<WorkflowDefinition> = { ...definition };
  delete copy.layout;
  return copy;
}

export function referencesIn(definition: WorkflowDefinition): readonly DefinitionReference[] {
  const found: DefinitionReference[] = [];
  walk(withoutLayout(definition), '', '', (pointer, value) => {
    const kind = KIND_OF_PREFIX[ID.exec(value)?.[1] ?? ''];
    if (kind !== undefined) {
      found.push({ pointer, id: value, kind });
    }
  });
  return found;
}

/** C140.5: a reference member still holding a literal that names no object, by pointer. */
export function placeholderReferencesIn(definition: WorkflowDefinition): readonly string[] {
  const found: string[] = [];
  walk(withoutLayout(definition), '', '', (pointer, value, member) => {
    if (REFERENCE_MEMBERS.has(member) && !value.includes('{{') && !ID.test(value)) {
      found.push(pointer);
    }
  });
  return found;
}

function rewrite(value: unknown, replacements: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') {
    return replacements.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => rewrite(item, replacements));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, rewrite(item, replacements)]),
    );
  }
  return value;
}

/** C112.2: the same definition with each id replaced, wherever it stands. */
export function replaceReferences(
  definition: WorkflowDefinition,
  replacements: ReadonlyMap<string, string>,
): WorkflowDefinition {
  return workflowDefinitionSchema.parse({
    ...(rewrite(withoutLayout(definition), replacements) as object),
    layout: definition.layout,
  });
}
