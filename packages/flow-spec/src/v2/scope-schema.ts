/**
 * C150.2, C150.10 (owner `flow-spec-logic`): the scope's JSON Schema (draft 2020-12) for the
 * builder's picker. Each path nests into `properties` (a template segment such as `<step id>`
 * into `additionalProperties`); a nullable path also takes `null`; and every path carries its
 * `x-openverify` annotation: its source (`verification`, `server`, `person`, `client`, `operator`),
 * tier, stage, PII mark, whether it is a verification outcome, and whether a flow can read it.
 */
import type { ScopeDescription, ScopePathDescription } from './schemas/scope.js';

type Schema = Record<string, unknown>;

function leaf(path: ScopePathDescription): Schema {
  const annotation = {
    'x-openverify': {
      source: path.source,
      tier: path.tier,
      stage: path.stage,
      pii: path.pii,
      outcome: path.outcome,
      availableInFlow: path.availableInFlow,
    },
  };
  const orNull = (type: string): string | string[] => (path.nullable ? [type, 'null'] : type);
  switch (path.type) {
    case 'enum':
      return {
        enum: path.nullable ? [...(path.options ?? []), null] : [...(path.options ?? [])],
        ...annotation,
      };
    case 'string-array':
      return { type: orNull('array'), items: { type: 'string' }, ...annotation };
    case 'date':
      return { type: orNull('string'), format: 'date', ...annotation };
    case 'datetime':
      return { type: orNull('string'), format: 'date-time', ...annotation };
    default:
      return { type: orNull(path.type), ...annotation };
  }
}

const objectSchema = (): Schema => ({ type: 'object', properties: {} });

/** The object a template segment or a member opens below `parent`. */
function child(parent: Schema, segment: string): Schema {
  if (segment.startsWith('<')) {
    parent.additionalProperties ??= objectSchema();
    return parent.additionalProperties as Schema;
  }
  const properties = parent.properties as Record<string, Schema>;
  properties[segment] ??= objectSchema();
  return properties[segment];
}

export function scopeJsonSchema(scope: ScopeDescription): Record<string, unknown> {
  const root: Schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    ...objectSchema(),
  };
  for (const path of scope.paths) {
    const segments = path.path.split('.');
    const last = segments.pop() ?? '';
    const parent = segments.reduce(child, root);
    const value = leaf(path);
    if (last.startsWith('<')) {
      parent.additionalProperties = value;
    } else {
      (parent.properties as Record<string, Schema>)[last] = value;
    }
  }
  return root;
}
