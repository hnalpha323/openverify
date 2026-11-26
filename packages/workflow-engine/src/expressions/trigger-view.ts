/**
 * The trigger view (plan C114.4, H27). Event payloads are JSON:API documents, so `trigger` is a
 * flattened view of one: the primary resource's attributes at the top (`trigger.status`,
 * `trigger.fields.<key>`), each to-one relationship with its attributes (`trigger.template.id`,
 * `trigger.account.reference-id`), to-many relationships as lists of `{ id, type }`, and the closed
 * alias table's public names. The view's type and its value are built here, side by side, from the
 * same rules, so what publish typed is what a run reads.
 *
 * `signals` flattens to one member per name in the registry, each `null` when the array does not hold
 * it, so an empty array never reads as a false signal (Stage 1a amendment 10). A run reads the server
 * API's view, never the console's.
 */
import { SIGNAL_NAMES, getSignalDefinition, type SignalValueType } from '@openverify/core';
import {
  PII_MASKED_ATTRIBUTES,
  WORKFLOW_TRIGGER_ALIASES,
  eventPayloadSchema,
  eventResourceType,
  inquiryTemplateResourceSchema,
  isEventName,
  workflowTriggerAliasOf,
  workflowTriggerMemberOf,
} from '@openverify/contracts';
import type { z } from 'zod';
import {
  ANY_TYPE,
  commonType,
  listType,
  objectType,
  scalarType,
  typeFromZod,
  withMarks,
  type ScopeType,
} from '../variables/types.js';
import { isJsonRecord, type JsonRecord, type JsonValue } from './json.js';
import type { PathSegment } from './paths.js';

export interface JsonApiResource {
  readonly type: string;
  readonly id: string;
  readonly attributes?: unknown;
  readonly relationships?: unknown;
}

/** What an event's stored payload holds, as far as the view reads it. */
export interface TriggerDocument {
  readonly data: JsonApiResource;
  readonly included?: readonly JsonApiResource[];
}

/**
 * C15, C115.6: the attributes every exit masks by name. A contract marks some with `.meta`, and this
 * list holds the rest, so taint is at least as wide as masking.
 */
export const MASKED_ATTRIBUTE_NAMES: ReadonlySet<string> = new Set<string>(PII_MASKED_ATTRIBUTES);

const MEMBER_ID = 'id';
const MEMBER_TYPE = 'type';
const MEMBER_SIGNALS = 'signals';
const SIGNAL_PREFIX = 'inquiry/';
const VERIFICATIONS = 'verifications';
const VERIFICATION_PREFIX = 'verification/';

const ALIASES = Object.entries(WORKFLOW_TRIGGER_ALIASES);

const signalMember = (name: string): string => name.slice(SIGNAL_PREFIX.length);

/** `reference-id` and the public `reference_id` read the same member. */
const publicName = (name: string): string => name.replaceAll('-', '_');

// ---------------------------------------------------------------------------------------------
// Types

interface UnionLike {
  readonly options: readonly ResourceLike[];
}

interface ResourceLike {
  readonly shape: { readonly type: z.ZodType };
}

const typeNames = (schema: ResourceLike): readonly string[] => {
  const type = typeFromZod(schema.shape.type);
  return type.kind === 'enum' ? type.values : [];
};

function collectResources(): ReadonlyMap<string, z.ZodType> {
  const { data, included } = eventPayloadSchema.shape;
  const list = included.unwrap() as unknown as { readonly element: UnionLike };
  const resources = [
    ...(data as unknown as UnionLike).options,
    ...list.element.options,
    inquiryTemplateResourceSchema as unknown as ResourceLike,
  ];
  return new Map(
    resources.flatMap((resource) =>
      typeNames(resource).map((name) => [name, resource as unknown as z.ZodType] as const),
    ),
  );
}

const RESOURCES = collectResources();

const SIGNAL_TYPES: Readonly<Record<SignalValueType, ScopeType>> = {
  boolean: scalarType('boolean', { nullable: true }),
  integer: scalarType('integer', { nullable: true }),
  number: scalarType('number', { nullable: true }),
  enum: scalarType('string', { nullable: true }),
  string: scalarType('string', { nullable: true }),
};

const SIGNALS_TYPE: ScopeType = {
  ...objectType(
    Object.fromEntries(
      SIGNAL_NAMES.map((name) => [
        signalMember(name),
        SIGNAL_TYPES[getSignalDefinition(name)?.valueType ?? 'string'],
      ]),
    ),
  ),
};

/** C114.4: the closed table's public names for a member, in every object of a view. */
function withMemberAliases<Value>(members: Map<string, Value>): Map<string, Value> {
  for (const [name, alias] of ALIASES) {
    if (alias.kind === 'member' && members.has(alias.member)) {
      members.set(name, members.get(alias.member) as Value);
    }
  }
  return members;
}

const identifierOf = (id: ScopeType, type: ScopeType): Readonly<Record<string, ScopeType>> =>
  Object.fromEntries(
    withMemberAliases(
      new Map([
        [MEMBER_ID, id],
        [MEMBER_TYPE, type],
      ]),
    ),
  );

const memberOf = (type: ScopeType | undefined, name: string): ScopeType | undefined =>
  type?.kind === 'object' ? type.members[name] : undefined;

const viewObject = (members: Readonly<Record<string, ScopeType>>): ScopeType => ({
  kind: 'object',
  members,
  rest: null,
  inflect: true,
  nullable: false,
  pii: false,
});

/** What one relationship reads as in a view. */
function relationshipView(relationship: ScopeType, depth: number): ScopeType | null {
  const data = memberOf(relationship, 'data');
  if (data === undefined) {
    return null;
  }
  const nullable = relationship.nullable || data.nullable;
  if (data.kind === 'list') {
    const id = memberOf(data.of, MEMBER_ID) ?? ANY_TYPE;
    const type = memberOf(data.of, MEMBER_TYPE) ?? ANY_TYPE;
    return listType(viewObject(identifierOf(id, type)), { nullable });
  }
  const id = memberOf(data, MEMBER_ID) ?? ANY_TYPE;
  const type = memberOf(data, MEMBER_TYPE) ?? ANY_TYPE;
  const [only, ...others] = type.kind === 'enum' ? type.values : [];
  const related = only !== undefined && others.length === 0 && depth === 0 ? viewOf(only, 1) : null;
  return withMarks(related ?? viewObject(identifierOf(id, type)), { nullable });
}

function aliasMembers(
  resourceType: string,
  members: Readonly<Record<string, ScopeType>>,
): Readonly<Record<string, ScopeType>> {
  const added: Record<string, ScopeType> = {};
  const hasVerifications =
    Object.hasOwn(members, VERIFICATIONS) || resourceType.startsWith(VERIFICATION_PREFIX);
  for (const [name, alias] of ALIASES) {
    const target = alias.kind === 'relationship' ? members[alias.relationship] : undefined;
    if (target !== undefined) {
      added[name] = target;
    } else if (alias.kind === 'verification' && hasVerifications) {
      const view = viewOf(alias['resource-type'], 1);
      if (view !== null) {
        added[name] = withMarks(view, { nullable: true });
      }
    }
  }
  return added;
}

const VIEWS = new Map<string, ScopeType | null>();

function buildView(resourceType: string, depth: number): ScopeType | null {
  const schema = RESOURCES.get(resourceType);
  if (schema === undefined) {
    return null;
  }
  const resource = typeFromZod(schema, { piiNames: MASKED_ATTRIBUTE_NAMES });
  const attributes = memberOf(resource, 'attributes');
  const relationships = memberOf(resource, 'relationships');
  const members: Record<string, ScopeType> = {
    ...(attributes?.kind === 'object' ? attributes.members : {}),
    ...identifierOf(
      memberOf(resource, MEMBER_ID) ?? ANY_TYPE,
      memberOf(resource, MEMBER_TYPE) ?? ANY_TYPE,
    ),
  };
  if (Object.hasOwn(members, MEMBER_SIGNALS)) {
    members[MEMBER_SIGNALS] = SIGNALS_TYPE;
  }
  if (relationships?.kind === 'object') {
    for (const [name, relationship] of Object.entries(relationships.members)) {
      const view = relationshipView(relationship, depth);
      if (view !== null) {
        members[name] = view;
      }
    }
  }
  const held = Object.fromEntries(withMemberAliases(new Map(Object.entries(members))));
  return viewObject(depth === 0 ? { ...held, ...aliasMembers(resourceType, members) } : held);
}

function viewOf(resourceType: string, depth: number): ScopeType | null {
  const key = `${String(depth)}:${resourceType}`;
  if (!VIEWS.has(key)) {
    VIEWS.set(key, buildView(resourceType, depth));
  }
  return VIEWS.get(key) ?? null;
}

/** C114.4: the view's type of one resource type, or `null` for one no event carries. */
export function triggerViewType(resourceType: string): ScopeType | null {
  return viewOf(resourceType, 0);
}

/** What every resource of a subject holds: `verification` covers each `verification/*`. */
function subjectViewType(resourceType: string): ScopeType | null {
  const exact = viewOf(resourceType, 0);
  if (exact !== null) {
    return exact;
  }
  const views = [...RESOURCES.keys()]
    .filter((name) => name.startsWith(`${resourceType}/`))
    .flatMap((name) => viewOf(name, 0) ?? []);
  const [first, ...others] = views;
  return first === undefined ? null : others.reduce(commonType, first);
}

/** C114.5, C118.1: the view of an event's payload, or `null` for an unknown event. */
export function eventViewType(eventName: string): ScopeType | null {
  return isEventName(eventName) ? subjectViewType(eventResourceType(eventName)) : null;
}

// ---------------------------------------------------------------------------------------------
// Values

type Pool = ReadonlyMap<string, JsonApiResource>;

interface Identifier {
  readonly id: string;
  readonly type: string;
}

const poolKey = (type: string, id: string): string => `${type} ${id}`;

/** Own members only, each under its name and its public name. */
function withPublicNames(attributes: JsonRecord): readonly (readonly [string, JsonValue])[] {
  return Object.entries(attributes).flatMap(([name, value]) =>
    publicName(name) === name
      ? [[name, value] as const]
      : [[name, value] as const, [publicName(name), value] as const],
  );
}

function signalsView(signals: JsonValue): JsonValue {
  const held = new Map(
    (Array.isArray(signals) ? signals : []).flatMap((signal) =>
      isJsonRecord(signal) && typeof signal.name === 'string'
        ? [[signal.name, signal.value ?? null] as const]
        : [],
    ),
  );
  return Object.fromEntries(
    SIGNAL_NAMES.map((name) => [signalMember(name), held.get(name) ?? null]),
  );
}

const attributesOf = (resource: JsonApiResource): JsonRecord =>
  isJsonRecord(resource.attributes) ? resource.attributes : {};

const identifierValue = ({ id, type }: Identifier): JsonRecord =>
  Object.fromEntries(
    withMemberAliases(
      new Map([
        [MEMBER_ID, id],
        [MEMBER_TYPE, type],
      ]),
    ),
  );

const isIdentifier = (value: JsonValue | undefined): value is Identifier & JsonRecord =>
  isJsonRecord(value) && typeof value.id === 'string' && typeof value.type === 'string';

function relatedValue(identifier: Identifier, pool: Pool, depth: number): JsonValue {
  const related = pool.get(poolKey(identifier.type, identifier.id));
  return related === undefined || depth > 0
    ? identifierValue(identifier)
    : resourceView(related, pool, depth + 1);
}

function relationshipValue(data: JsonValue | undefined, pool: Pool, depth: number): JsonValue {
  if (Array.isArray(data)) {
    return data.filter(isIdentifier).map(identifierValue);
  }
  return isIdentifier(data) ? relatedValue(data, pool, depth) : null;
}

const newestFirst =
  (pool: Pool) =>
  (left: Identifier, right: Identifier): number => {
    const stamp = ({ id, type }: Identifier): string => {
      const resource = pool.get(poolKey(type, id));
      const created = resource === undefined ? undefined : attributesOf(resource)['created-at'];
      return typeof created === 'string' ? created : '';
    };
    const [one, other] = [stamp(left), stamp(right)];
    return other.localeCompare(one) || right.id.localeCompare(left.id);
  };

function verificationAliases(resource: JsonApiResource, pool: Pool): JsonRecord {
  const relationships = isJsonRecord(resource.relationships) ? resource.relationships : {};
  const listed = relationships[VERIFICATIONS];
  const data = isJsonRecord(listed) && Array.isArray(listed.data) ? listed.data : null;
  const primary = resource.type.startsWith(VERIFICATION_PREFIX);
  if (data === null && !primary) {
    return {};
  }
  const identifiers = (data ?? []).filter(isIdentifier);
  const aliases: Record<string, JsonValue> = {};
  for (const [name, alias] of ALIASES) {
    if (alias.kind === 'verification') {
      const type = alias['resource-type'];
      const [newest] = identifiers.filter((item) => item.type === type).sort(newestFirst(pool));
      if (primary && resource.type === type) {
        aliases[name] = resourceView(resource, pool, 1);
      } else {
        aliases[name] = newest === undefined ? null : relatedValue(newest, pool, 0);
      }
    }
  }
  return aliases;
}

function resourceView(resource: JsonApiResource, pool: Pool, depth: number): JsonRecord {
  const attributes = attributesOf(resource);
  const relationships = isJsonRecord(resource.relationships) ? resource.relationships : {};
  const members = new Map<string, JsonValue>(withPublicNames(attributes));
  for (const [name, value] of Object.entries(identifierValue(resource))) {
    members.set(name, value);
  }
  if (Object.hasOwn(attributes, MEMBER_SIGNALS)) {
    members.set(MEMBER_SIGNALS, signalsView(attributes[MEMBER_SIGNALS] ?? null));
  }
  for (const [name, relationship] of Object.entries(relationships)) {
    const view = relationshipValue(
      isJsonRecord(relationship) ? relationship.data : undefined,
      pool,
      depth,
    );
    members.set(name, view);
    members.set(publicName(name), view);
  }
  if (depth === 0) {
    for (const [name, alias] of ALIASES) {
      if (alias.kind === 'relationship' && members.has(alias.relationship)) {
        members.set(name, members.get(alias.relationship) ?? null);
      }
    }
    for (const [name, value] of Object.entries(verificationAliases(resource, pool))) {
      members.set(name, value);
    }
  }
  return Object.fromEntries(withMemberAliases(members));
}

/**
 * C114.4: the flattened view of a stored event's document. `related` holds what the run snapshotted
 * beyond the payload's `included` ({@link relatedNeededBy}).
 */
export function buildTriggerView(
  document: TriggerDocument,
  related: readonly JsonApiResource[] = [],
): JsonRecord {
  const pool = new Map(
    [...(document.included ?? []), ...related].map(
      (resource) => [poolKey(resource.type, resource.id), resource] as const,
    ),
  );
  return resourceView(document.data, pool, 0);
}

export interface TriggerRelated {
  /** The relationship names to load past their identifier. */
  readonly relationships: readonly string[];
  /** The verification resource types to load. */
  readonly verifications: readonly string[];
}

const IDENTIFIER_MEMBERS: ReadonlySet<PathSegment | undefined> = new Set([
  MEMBER_ID,
  MEMBER_TYPE,
  ...ALIASES.flatMap(([name, alias]) => (alias.kind === 'member' ? [name] : [])),
]);

/** C114.4: the related resources a version's paths need in a run's trigger snapshot. */
export function relatedNeededBy(paths: readonly (readonly PathSegment[])[]): TriggerRelated {
  const relationships = new Set<string>();
  const verifications = new Set<string>();
  for (const [root, name, member] of paths) {
    if (root === 'trigger' && typeof name === 'string') {
      const alias = workflowTriggerAliasOf(name);
      if (alias?.kind === 'verification') {
        verifications.add(alias['resource-type']);
      } else if (member !== undefined && !IDENTIFIER_MEMBERS.has(member)) {
        const relationship =
          alias?.kind === 'relationship' ? alias.relationship : workflowTriggerMemberOf(name);
        if (RELATIONSHIP_NAMES.has(relationship)) {
          relationships.add(relationship);
        }
      }
    }
  }
  return { relationships: [...relationships].sort(), verifications: [...verifications].sort() };
}

/** Every to-one relationship any view reads with attributes. */
const RELATIONSHIP_NAMES: ReadonlySet<string> = new Set(
  [...RESOURCES.keys()].flatMap((name) => {
    const schema = RESOURCES.get(name);
    const relationships =
      schema === undefined ? undefined : memberOf(typeFromZod(schema), 'relationships');
    return relationships?.kind === 'object' ? Object.keys(relationships.members) : [];
  }),
);
