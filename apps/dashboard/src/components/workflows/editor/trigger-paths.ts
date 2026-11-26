/**
 * The trigger's paths for the picker and the trigger panel (C114.4, C115.3): `trigger` is a
 * flattened view of the event's resource, its attributes at the top, `id`, each to-one relationship
 * as `<name>.id` and a to-many one as a list, and an inquiry's signals one member each, every one
 * nullable because a signal is never false (Phase 7). The types and marks come from the contracts'
 * own schemas through `z.toJSONSchema()`, PII by each member's mark and by the masked list
 * (`PII_MASKED_ATTRIBUTES`), so what the picker calls personal data is at least what the API masks.
 *
 * An aid computed in the browser: the API's typing of the view, with its alias table, stays the
 * authority (C113.5). The API and schedule triggers have no view; their scope is the inputs.
 */
import {
  PII_MASKED_ATTRIBUTES,
  eventPayloadSchema,
  eventResourceType,
  isEventName,
} from '@openverify/contracts';
import { SIGNAL_NAMES } from '@openverify/core';
import { z } from 'zod';
import type { DraftTrigger } from './document-model';
import { pathsOfSchema, type ScopePath } from './variable-scope';

type Schema = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Schema =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const MASKED: ReadonlySet<string> = new Set(PII_MASKED_ATTRIBUTES);
const SOURCE = 'Trigger';

const toJson = (schema: z.ZodType): Schema | null => {
  try {
    const json: unknown = z.toJSONSchema(schema, { unrepresentable: 'any', io: 'output' });
    return isRecord(json) ? json : null;
  } catch {
    return null;
  }
};

let resources: ReadonlyMap<string, z.ZodType> | undefined;

/** Every resource an event carries, by its type name. */
function resourceSchemas(): ReadonlyMap<string, z.ZodType> {
  if (resources === undefined) {
    const map = new Map<string, z.ZodType>();
    for (const option of eventPayloadSchema.shape.data.options) {
      const type = toJson(option.shape.type);
      const names = Array.isArray(type?.enum) ? type.enum : [type?.const];
      for (const name of names) {
        if (typeof name === 'string') {
          map.set(name, option);
        }
      }
    }
    resources = map;
  }
  return resources;
}

const signal = (name: string): ScopePath => ({
  path: `trigger.signals.${name.slice(name.indexOf('/') + 1)}`,
  type: 'any',
  options: [],
  nullable: true,
  pii: false,
  source: SOURCE,
});

const views = new Map<string, readonly ScopePath[]>();

function viewOf(resourceType: string): readonly ScopePath[] {
  const cached = views.get(resourceType);
  if (cached !== undefined) {
    return cached;
  }
  const schema = resourceSchemas().get(resourceType);
  const json = schema === undefined ? null : toJson(schema);
  const properties = isRecord(json?.properties) ? json.properties : {};
  const attributes = isRecord(properties.attributes) ? properties.attributes : {};
  const members = isRecord(attributes.properties) ? attributes.properties : {};
  const relationships = isRecord(properties.relationships) ? properties.relationships : {};
  const relations = isRecord(relationships.properties) ? relationships.properties : {};
  const paths: ScopePath[] =
    json === null
      ? []
      : [
          {
            path: 'trigger.id',
            type: 'id',
            options: [],
            nullable: false,
            pii: false,
            source: SOURCE,
          },
          ...Object.entries(members).flatMap(([name, member]) =>
            name === 'signals'
              ? SIGNAL_NAMES.filter((signalName) => signalName.startsWith('inquiry/')).map(signal)
              : pathsOfSchema({ properties: { [name]: member } }, 'trigger', SOURCE, {
                  pii: MASKED.has(name),
                }),
          ),
          ...Object.entries(relations).flatMap(([name, relation]): ScopePath[] => {
            const data =
              isRecord(relation) && isRecord(relation.properties)
                ? relation.properties.data
                : undefined;
            if (!isRecord(data)) {
              return [];
            }
            const many = data.type === 'array';
            const nullable =
              Array.isArray(data.anyOf) &&
              data.anyOf.some((option) => isRecord(option) && option.type === 'null');
            return [
              {
                path: many ? `trigger.${name}` : `trigger.${name}.id`,
                type: many ? 'list' : 'id',
                options: [],
                nullable,
                pii: false,
                source: SOURCE,
              },
            ];
          }),
        ];
  views.set(resourceType, paths);
  return paths;
}

/** Each resource a subject's events carry: `report` covers every `report/*`. */
function subjectViews(resourceType: string): readonly (readonly ScopePath[])[] {
  const exact = viewOf(resourceType);
  if (exact.length > 0) {
    return [exact];
  }
  return [...resourceSchemas().keys()]
    .filter((name) => name.startsWith(`${resourceType}/`))
    .map(viewOf)
    .filter((view) => view.length > 0);
}

/** The union of several views; a path one of them lacks may be missing, so it is nullable. */
function unionOf(list: readonly (readonly ScopePath[])[]): ScopePath[] {
  const merged = new Map<string, ScopePath>();
  for (const view of list) {
    for (const path of view) {
      const held = merged.get(path.path);
      merged.set(
        path.path,
        held === undefined
          ? path
          : { ...held, nullable: held.nullable || path.nullable, pii: held.pii || path.pii },
      );
    }
  }
  return [...merged.values()].map((path) =>
    list.every((view) => view.some((candidate) => candidate.path === path.path))
      ? path
      : { ...path, nullable: true },
  );
}

const OBJECT_TRIGGERS: Readonly<Record<string, string>> = {
  'trigger-account': 'account',
  'trigger-case': 'case',
};

/** C114.4: the trigger view's paths, or none for a trigger without a view. */
export function triggerPathsOf(trigger: DraftTrigger | null): ScopePath[] {
  if (trigger === null) {
    return [];
  }
  const { config } = trigger;
  if (trigger.type === 'trigger-event' || trigger.type === 'trigger-verification') {
    const events = Array.isArray(config.events) ? config.events : [];
    const types = [
      ...new Set(
        events.flatMap((event) =>
          typeof event === 'string' && isEventName(event) ? [eventResourceType(event)] : [],
        ),
      ),
    ];
    return unionOf(types.flatMap(subjectViews));
  }
  const objectType =
    typeof config['object-type'] === 'string'
      ? config['object-type']
      : OBJECT_TRIGGERS[trigger.type];
  return objectType === undefined ? [] : unionOf(subjectViews(objectType));
}
