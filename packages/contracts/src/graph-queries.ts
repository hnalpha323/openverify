/**
 * Graph queries and their templates (plan C102, C103). Values are bound, never interpreted: no SQL,
 * Cypher or expression text comes from a caller. Results are profiling, so `graph:read` stays away
 * from viewers, and a parameter that identifies a person needs `pii:view` (P11).
 *
 * A property node's `value` is a random id local to one result, never the value and never derived
 * from its key (P17, ours): the plaintext is reached only through the audited unmask route, under
 * `pii:view` and the `graph-unmask` policy. `index-complete` and `kinds-not-indexed` say what the
 * index could not answer (H10), and `node-limit-reached` and `skipped-hub-values` what the caps cut.
 *
 * Routes (frozen by `foundation-7b`, built by `api-graph`): C102.1, C102.4, C102.6 and C103.1.
 * Scopes `graph:read` for every GET, `graph:write` for every write and for running, re-running and
 * cancelling. An event of a graph query carries neither parameters nor nodes (C107.5).
 */
import {
  GRAPH_BULK_ACTIONS,
  GRAPH_KINDS,
  GRAPH_KIND_REGISTRY,
  GRAPH_LIMITS,
  GRAPH_MAX_HOPS,
  graphBulkOutcomeSchema,
  graphKindSchema,
  graphQueryStatusSchema,
  graphTemplateStatusSchema,
  graphTemplateVersionStatusSchema,
  type GraphKind,
  type GraphQueryStatus,
  type GraphTemplateStatus,
  type GraphTemplateVersionStatus,
} from '@openverify/core';
import { z } from 'zod';
import { emptyActionBodySchema } from './actions.js';
import { idSchema } from './ids.js';
import { accountIdentifierSchema } from './identifiers.js';
import {
  hasDistinctValues,
  listDocumentSchema,
  requestDocumentSchema,
  resourceSchema,
  resourceWithRelationshipsSchema,
  singleDocumentSchema,
  timestampSchema,
  toNullableTimestamp,
  toTimestamp,
} from './json-api.js';
import { filterListSchema, listQuerySchema } from './list-filters.js';
import { tagInputSchema } from './tags.js';

export {
  GRAPH_BULK_ACTIONS,
  GRAPH_BULK_OUTCOMES,
  GRAPH_KINDS,
  GRAPH_KIND_REGISTRY,
  GRAPH_LIMITS,
  GRAPH_MAX_HOPS,
  GRAPH_PERSON_KINDS,
  GRAPH_QUERY_STATUSES,
  GRAPH_STRONG_KINDS,
  GRAPH_TEMPLATE_STATUSES,
  GRAPH_TEMPLATE_VERSION_STATUSES,
  GRAPH_WEAK_KINDS,
  graphKindSchema,
  type GraphKind,
} from '@openverify/core';

/** Marks a member PII (C107.5): nullable, so a masked or redacted copy still parses. */
function pii<Schema extends z.ZodType>(schema: Schema) {
  return schema.nullable().meta({ pii: true });
}

const nameSchema = z.string().min(1).max(255);

/** C102.2: the public `{{param}}` rules: case-sensitive letters, digits and underscores. */
export const graphParameterNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9_]+$/, 'must be letters, digits and underscores')
  .max(64);

/** C102.2: the kinds a parameter binds: a graph kind, the account in context, or a time. */
export const GRAPH_PARAMETER_KINDS = [...GRAPH_KINDS, 'account_id', 'created_at'] as const;
export const graphParameterKindSchema = z.enum(GRAPH_PARAMETER_KINDS);
export type GraphParameterKind = z.infer<typeof graphParameterKindSchema>;

const placeholder = z
  .string()
  .regex(/^\{\{[A-Za-z0-9_]+\}\}$/, 'must be a parameter, such as {{email}}')
  .max(68);

/** The parameter a `{{name}}` names. */
function placeholderName(value: string): string {
  return value.slice(2, -2);
}

/** C102.2: `start` and `filters` hold only `{{param}}` values, bound and never interpreted. */
const startClause = z.strictObject({
  kind: z.union([graphKindSchema, z.literal('account_id')]),
  value: placeholder,
});

const accountStatuses = z.array(z.enum(['active', 'archived'])).max(2);

export const graphQueryTemplateFiltersSchema = z.strictObject({
  'account-type-ids': z.array(idSchema('acctp')).max(50).optional(),
  'account-statuses': accountStatuses.optional(),
  tags: z.array(tagInputSchema).max(50).optional(),
  /** A created-at window, given by parameter. */
  'created-at-start': placeholder.optional(),
  'created-at-end': placeholder.optional(),
});

/** C102.2: the template config, strict. */
export const graphQueryTemplateConfigSchema = z.strictObject({
  parameters: z
    .array(z.strictObject({ name: graphParameterNameSchema, kind: graphParameterKindSchema }))
    .max(GRAPH_LIMITS.parameters),
  start: z.array(startClause).min(1).max(GRAPH_LIMITS.startClauses),
  'connect-kinds': z
    .array(graphKindSchema)
    .min(1)
    .max(GRAPH_KINDS.length)
    .refine(hasDistinctValues, 'must not contain duplicates'),
  'max-hops': z
    .union([
      z.literal(GRAPH_MAX_HOPS[0]),
      z.literal(GRAPH_MAX_HOPS[1]),
      z.literal(GRAPH_MAX_HOPS[2]),
    ])
    .optional(),
  'node-limit': z.int().min(1).max(GRAPH_LIMITS.nodeLimit).optional(),
  'include-weak-kinds': z.boolean().optional(),
  filters: graphQueryTemplateFiltersSchema.optional(),
});
export type GraphQueryTemplateConfig = z.infer<typeof graphQueryTemplateConfigSchema>;

/** The config a version serves, every default applied. */
export function resolveGraphQueryTemplateConfig(
  config: GraphQueryTemplateConfig,
): GraphQueryTemplateConfig {
  return {
    ...config,
    'max-hops': config['max-hops'] ?? GRAPH_LIMITS.defaultMaxHops,
    'node-limit': config['node-limit'] ?? GRAPH_LIMITS.defaultNodeLimit,
    'include-weak-kinds': config['include-weak-kinds'] ?? false,
  };
}

export type GraphTemplateProblemCode = 'weak_kind_not_allowed' | 'graph_parameter_unbound';

/** One publish refusal, with a JSON Pointer into the config. */
export interface GraphTemplateProblem {
  readonly code: GraphTemplateProblemCode;
  readonly pointer: string;
}

/**
 * C102.2: what publish refuses beyond the schema: a weak kind without the flag, the flag above
 * `max-hops` 4 (decision 34), and a `{{param}}` no parameter declares.
 */
export function graphTemplateConfigProblems(
  config: GraphQueryTemplateConfig,
): GraphTemplateProblem[] {
  const problems: GraphTemplateProblem[] = [];
  const weakAllowed = config['include-weak-kinds'] === true;
  config['connect-kinds'].forEach((kind, index) => {
    if (GRAPH_KIND_REGISTRY[kind].strength === 'weak' && !weakAllowed) {
      problems.push({ code: 'weak_kind_not_allowed', pointer: `/connect-kinds/${String(index)}` });
    }
  });
  if (
    weakAllowed &&
    (config['max-hops'] ?? GRAPH_LIMITS.defaultMaxHops) > GRAPH_LIMITS.weakMaxHops
  ) {
    problems.push({ code: 'weak_kind_not_allowed', pointer: '/max-hops' });
  }
  const declared = new Set(config.parameters.map(({ name }) => name));
  const bound = (value: string, pointer: string) => {
    if (!declared.has(placeholderName(value))) {
      problems.push({ code: 'graph_parameter_unbound', pointer });
    }
  };
  config.start.forEach(({ value }, index) => {
    bound(value, `/start/${String(index)}/value`);
  });
  const start = config.filters?.['created-at-start'];
  if (start !== undefined) {
    bound(start, '/filters/created-at-start');
  }
  const end = config.filters?.['created-at-end'];
  if (end !== undefined) {
    bound(end, '/filters/created-at-end');
  }
  return problems;
}

const templateIdentifier = z.strictObject({
  type: z.literal('graph-query-template'),
  id: idSchema('grqt'),
});
const versionIdentifier = z.strictObject({
  type: z.literal('graph-query-template-version'),
  id: idSchema('grqtv'),
});

/** C102.1: `graph-query-template` (`grqt_`). */
export const graphQueryTemplateResourceSchema = resourceWithRelationshipsSchema(
  'graph-query-template',
  'grqt',
  z.strictObject({
    name: nameSchema,
    status: graphTemplateStatusSchema,
    'latest-version': z.int().min(1),
    'published-version': z.int().min(1).nullable(),
    'created-at': timestampSchema,
    'updated-at': timestampSchema,
  }),
  z.strictObject({
    /** Owner decision 7 after 7B: optional so earlier answers parse; servers send it. */
    'latest-version': z.strictObject({ data: versionIdentifier }).optional(),
    'published-version': z.strictObject({ data: versionIdentifier.nullable() }),
  }),
);
export type GraphQueryTemplateResource = z.infer<typeof graphQueryTemplateResourceSchema>;
export const graphQueryTemplateDocumentSchema = singleDocumentSchema(
  graphQueryTemplateResourceSchema,
);
export type GraphQueryTemplateDocument = z.infer<typeof graphQueryTemplateDocumentSchema>;
export const graphQueryTemplateListDocumentSchema = listDocumentSchema(
  graphQueryTemplateResourceSchema,
);

export const listGraphQueryTemplatesQuerySchema = listQuerySchema('grqt', {
  'filter[status]': filterListSchema(graphTemplateStatusSchema).optional(),
});

/** `POST /api/v1/graph-query-templates` (`graph:write`): a draft version comes with it. */
export const createGraphQueryTemplateBodySchema = requestDocumentSchema(
  'graph-query-template',
  z.strictObject({ name: nameSchema, config: graphQueryTemplateConfigSchema.optional() }),
);
export type CreateGraphQueryTemplateBody = z.infer<typeof createGraphQueryTemplateBodySchema>;

/** `PATCH /api/v1/graph-query-templates/:id`: the name only. */
export const updateGraphQueryTemplateBodySchema = requestDocumentSchema(
  'graph-query-template',
  z.strictObject({ name: nameSchema }),
);
export type UpdateGraphQueryTemplateBody = z.infer<typeof updateGraphQueryTemplateBodySchema>;

/** C102.1: `graph-query-template-version` (`grqtv_`), as C71. */
export const graphQueryTemplateVersionResourceSchema = resourceWithRelationshipsSchema(
  'graph-query-template-version',
  'grqtv',
  z
    .strictObject({
      'version-number': z.int().min(1),
      status: graphTemplateVersionStatusSchema,
      config: graphQueryTemplateConfigSchema,
      'created-at': timestampSchema,
      'published-at': timestampSchema.nullable(),
    })
    .refine(
      (attributes) => (attributes.status === 'draft') === (attributes['published-at'] === null),
      { message: 'a version is published exactly when it is no longer a draft', path: ['status'] },
    ),
  z.strictObject({ 'graph-query-template': z.strictObject({ data: templateIdentifier }) }),
);
export type GraphQueryTemplateVersionResource = z.infer<
  typeof graphQueryTemplateVersionResourceSchema
>;
export const graphQueryTemplateVersionDocumentSchema = singleDocumentSchema(
  graphQueryTemplateVersionResourceSchema,
);
export type GraphQueryTemplateVersionDocument = z.infer<
  typeof graphQueryTemplateVersionDocumentSchema
>;

export const graphQueryTemplateVersionListDocumentSchema = listDocumentSchema(
  graphQueryTemplateVersionResourceSchema,
);
export type GraphQueryTemplateVersionListDocument = z.infer<
  typeof graphQueryTemplateVersionListDocumentSchema
>;

/** Owner decision 7 after Workflow 7B: `GET /api/v1/graph-query-template-versions`, newest first. */
export const listGraphQueryTemplateVersionsQuerySchema = listQuerySchema('grqtv', {
  'filter[graph-query-template-id]': filterListSchema(idSchema('grqt')).optional(),
});
export type ListGraphQueryTemplateVersionsQuery = z.infer<
  typeof listGraphQueryTemplateVersionsQuerySchema
>;

/** `POST /api/v1/graph-query-template-versions`: a draft. */
export const createGraphQueryTemplateVersionBodySchema = requestDocumentSchema(
  'graph-query-template-version',
  z.strictObject({
    'graph-query-template-id': idSchema('grqt'),
    config: graphQueryTemplateConfigSchema,
  }),
);
export type CreateGraphQueryTemplateVersionBody = z.infer<
  typeof createGraphQueryTemplateVersionBodySchema
>;

/** `PATCH /api/v1/graph-query-template-versions/:id` (drafts only). */
export const updateGraphQueryTemplateVersionBodySchema = requestDocumentSchema(
  'graph-query-template-version',
  z.strictObject({ config: graphQueryTemplateConfigSchema }),
);
export type UpdateGraphQueryTemplateVersionBody = z.infer<
  typeof updateGraphQueryTemplateVersionBodySchema
>;

/** `POST /api/v1/graph-query-template-versions/:id/publish` takes no parameters. */
export const publishGraphQueryTemplateVersionBodySchema = emptyActionBodySchema;

// ---------------------------------------------------------------------------------------------
// Graph queries (C102.4)

/** C102.4 (P17, ours): a property node's value: random, local to one result, never its key. */
export const graphNodeIdSchema = z
  .string()
  .regex(/^gn_[A-Za-z0-9_-]{22}$/, 'must be a node id local to this result');

/** C102.4: `nodes[]`, whose `type` is the public snake-case name. */
export const graphNodeSchema = z.union([
  z.strictObject({ type: z.literal('account'), value: idSchema('acc') }),
  z.strictObject({ type: graphKindSchema, value: graphNodeIdSchema }),
]);
export type GraphNode = z.infer<typeof graphNodeSchema>;

const nodeReference = z.union([idSchema('acc'), graphNodeIdSchema]);

/** C102.4 (ours): how two nodes are joined. */
export const graphLinkSchema = z.strictObject({
  from: nodeReference,
  to: nodeReference,
  kind: graphKindSchema,
});
export type GraphLink = z.infer<typeof graphLinkSchema>;

interface GraphQueryAttributesShape {
  readonly status: GraphQueryStatus;
  readonly params: unknown;
  readonly nodes: readonly unknown[];
  readonly links: readonly unknown[];
  readonly 'index-complete': boolean;
  readonly 'kinds-not-indexed': readonly unknown[];
  readonly 'redacted-at': string | null;
  readonly 'completed-at': string | null;
  readonly 'errored-at': string | null;
}

export const graphQueryAttributesSchema = z
  .strictObject({
    status: graphQueryStatusSchema,
    /** Masked member-wise without `pii:view`; `null` once redacted, and in every event. */
    params: pii(z.record(z.string(), z.string().nullable())),
    'created-at': timestampSchema,
    'updated-at': timestampSchema,
    'errored-at': timestampSchema.nullable(),
    'completed-at': timestampSchema.nullable(),
    /** Once set, `nodes`, `links` and `params` are empty. */
    'redacted-at': timestampSchema.nullable(),
    /** `{}` in Phase 7. */
    stats: z.strictObject({}),
    /** `null` without a configured console URL, never a guess (owner decision 13 after 7B). */
    'explorer-url': z.url().max(2048).nullable(),
    'node-limit-reached': z.boolean(),
    nodes: z.array(graphNodeSchema),
    /** Ours (H10): the kinds the template connects that the index lacks for the window. */
    'index-complete': z.boolean(),
    'kinds-not-indexed': z.array(graphKindSchema),
    /** Ours (C102.3): values skipped by the capped count. */
    'skipped-hub-values': z.int().min(0),
    'template-version-id': idSchema('grqtv'),
    links: z.array(graphLinkSchema),
  })
  .refine(
    (value) => {
      const attributes = value as GraphQueryAttributesShape;
      return attributes['index-complete'] === (attributes['kinds-not-indexed'].length === 0);
    },
    {
      message: 'index-complete is false exactly when a kind is listed (H10)',
      path: ['index-complete'],
    },
  )
  .refine(
    (value) => {
      const attributes = value as GraphQueryAttributesShape;
      return (
        attributes['redacted-at'] === null ||
        (attributes.nodes.length === 0 &&
          attributes.links.length === 0 &&
          attributes.params === null)
      );
    },
    { message: 'a redacted result holds no nodes, links or params (C102.7)', path: ['nodes'] },
  )
  .refine(
    (value) => {
      const attributes = value as GraphQueryAttributesShape;
      return (
        (attributes.status === 'completed') === (attributes['completed-at'] !== null) &&
        (attributes.status === 'errored') === (attributes['errored-at'] !== null)
      );
    },
    { message: 'a query says when it completed or errored', path: ['status'] },
  );

/**
 * C101.6 (owner decision 6 after Workflow 7B): the states of an account's component. `disabled`
 * while the environment's `graph-components` is off; `not-computed` when it is on and the account is
 * newer than the last run; `computed` otherwise.
 */
export const ACCOUNT_GRAPH_COMPONENT_STATES = ['computed', 'not-computed', 'disabled'] as const;
export const accountGraphComponentStateSchema = z.enum(ACCOUNT_GRAPH_COMPONENT_STATES);
export type AccountGraphComponentState = z.infer<typeof accountGraphComponentStateSchema>;

/**
 * C101.6: `GET /accounts/:id/graph-component` (`graph:read`), whose id is the account's. A separate
 * route, so a viewer never receives graph data on the account read. The run-local `component-id` is
 * not served, and nothing here is PII. A size and a time come together, only when `computed`.
 */
export const accountGraphComponentResourceSchema = resourceSchema(
  'account-graph-component',
  'acc',
  z
    .strictObject({
      state: accountGraphComponentStateSchema,
      size: z.int().min(1).nullable(),
      'computed-at': timestampSchema.nullable(),
    })
    .refine(
      ({ state, size, 'computed-at': computedAt }) =>
        (state === 'computed') === (size !== null) && (size === null) === (computedAt === null),
      { message: 'only a computed component has a size and a time', path: ['state'] },
    ),
);
export type AccountGraphComponentResource = z.infer<typeof accountGraphComponentResourceSchema>;
export const accountGraphComponentDocumentSchema = singleDocumentSchema(
  accountGraphComponentResourceSchema,
);
export type AccountGraphComponentDocument = z.infer<typeof accountGraphComponentDocumentSchema>;

export const graphQueryRelationshipsSchema = z.strictObject({
  accounts: z.strictObject({ data: z.array(accountIdentifierSchema) }),
});

export const graphQueryResourceSchema = resourceWithRelationshipsSchema(
  'graph-query',
  'grphq',
  graphQueryAttributesSchema,
  graphQueryRelationshipsSchema,
);
export type GraphQueryResource = z.infer<typeof graphQueryResourceSchema>;
export const graphQueryDocumentSchema = singleDocumentSchema(graphQueryResourceSchema);
export type GraphQueryDocument = z.infer<typeof graphQueryDocumentSchema>;
export const graphQueryListDocumentSchema = listDocumentSchema(graphQueryResourceSchema);

export const listGraphQueriesQuerySchema = listQuerySchema('grphq', {
  'filter[status]': filterListSchema(graphQueryStatusSchema).optional(),
  'filter[graph-query-template-id]': filterListSchema(idSchema('grqt')).optional(),
});

const parameterMap = z
  .record(graphParameterNameSchema, z.string().min(1).max(1024))
  .optional()
  .meta({ pii: true });

/**
 * `POST /api/v1/graph-queries` (`graph:write`; `pii:view` too for a person-identifying parameter,
 * P11). `parameter-map` is required; `variable-map` is its deprecated name, so exactly one is sent.
 * Both are PII, so a stored API log masks them. `meta.run-sync` answers the result, or what was
 * gathered at the deadline (at most 2 per environment, 10 s; 429 beyond).
 */
export const createGraphQueryBodySchema = z.strictObject({
  data: z.strictObject({
    type: z.literal('graph-query').optional(),
    attributes: z
      .strictObject({
        'graph-query-template-id': idSchema('grqt'),
        'parameter-map': parameterMap,
        'variable-map': parameterMap,
        'timeout-in-seconds': z.int().min(1).max(GRAPH_LIMITS.timeoutSeconds).optional(),
      })
      .refine(
        (attributes) =>
          (attributes['parameter-map'] === undefined) !==
          (attributes['variable-map'] === undefined),
        {
          message: 'takes parameter-map, or its deprecated name, not both',
          path: ['parameter-map'],
        },
      ),
  }),
  meta: z.strictObject({ 'run-sync': z.boolean().optional() }).optional(),
});
export type CreateGraphQueryBody = z.infer<typeof createGraphQueryBodySchema>;

/**
 * `POST /api/v1/graph-queries/:id/nodes/:node-id/expand` (owner decision 20 after Workflow 7B; placed
 * in Workflow 9B (C)): a server route that starts a new query from a stored property node of a
 * query's result (its key in `node_map`, never sent). `graph:write` as running a query (C102.1), plus
 * `pii:view` when the node's kind is in `GRAPH_PERSON_KINDS` (C102.4's rule for parameters), policy
 * `graph-queries`; it answers 201 with the new graph query (submitted, or its result with
 * `meta.run-sync`). 404 for an unknown node, 410 for a redacted source query, 422 for an account node
 * (an account is expanded by running a template with `account_id` bound).
 */
export const expandGraphNodeParamsSchema = z.strictObject({
  id: idSchema('grphq'),
  nodeId: graphNodeIdSchema,
});
export const expandGraphNodeBodySchema = z.strictObject({
  meta: z.strictObject({ 'run-sync': z.boolean().optional() }).optional(),
});
export type ExpandGraphNodeBody = z.infer<typeof expandGraphNodeBodySchema>;

/** `POST /:id/rerun` and `POST /:id/cancel` take no parameters. */
export const rerunGraphQueryBodySchema = emptyActionBodySchema;
export const cancelGraphQueryBodySchema = emptyActionBodySchema;

/**
 * `GET /api/v1/graph-queries/:id/nodes/:node-id/value` (C102.6; `pii:view`; policy `graph-unmask`):
 * one audited plaintext value, a PII response member.
 */
export const graphNodeValueDocumentSchema = z.strictObject({
  data: z.strictObject({
    type: z.literal('graph-node-value'),
    id: graphNodeIdSchema,
    attributes: z.strictObject({
      kind: graphKindSchema,
      value: z.string().min(1).max(1024).nullable().meta({ pii: true }),
    }),
  }),
});
export type GraphNodeValueDocument = z.infer<typeof graphNodeValueDocumentSchema>;

const SELECTION = {
  /** The intersection with the stored result is what is acted on (C103.1). */
  'account-ids': z
    .array(idSchema('acc'))
    .min(1)
    .max(GRAPH_LIMITS.bulkAccounts)
    .refine(hasDistinctValues, 'must not contain duplicates')
    .optional(),
  /** Refused with 422 `selection_too_large` when the result holds more than 500 accounts. */
  all: z.literal(true).optional(),
  preview: z.literal(true).optional(),
};

interface Selection {
  readonly 'account-ids'?: readonly string[] | undefined;
  readonly all?: true | undefined;
}

const SELECTS_ONE_WAY = {
  message: 'takes account-ids or all: true',
  path: ['account-ids'],
};

const selectsOneWay = (attributes: Selection) =>
  (attributes['account-ids'] === undefined) !== (attributes.all === undefined);

function bulkAction<const Action extends string, const Shape extends z.ZodRawShape>(
  action: Action,
  shape: Shape,
) {
  return z
    .strictObject({ action: z.literal(action), ...SELECTION, ...shape })
    .refine((attributes) => selectsOneWay(attributes as Selection), SELECTS_ONE_WAY);
}

/** C103: `POST /api/v1/graph-queries/:id/actions`, under `data.attributes`. */
export const graphQueryActionAttributesSchema = z.union([
  bulkAction('add-tag', { tag: tagInputSchema }),
  bulkAction('remove-tag', { tag: tagInputSchema }),
  bulkAction('set-account-status', { status: z.enum(['active', 'archived']) }),
  bulkAction('add-to-list', { 'list-id': idSchema('lst'), kind: graphKindSchema }),
  bulkAction('export', {}),
  /** C140.6: one case holding the selected accounts, under `cases:write`; the query is its history's. */
  bulkAction('create-case', {
    'case-template-id': idSchema('ctmpl'),
    'case-queue-id': idSchema('cqueue').optional(),
  }),
]);

export const graphQueryActionBodySchema = z.strictObject({
  data: z.strictObject({ attributes: graphQueryActionAttributesSchema }),
});
export type GraphQueryActionBody = z.infer<typeof graphQueryActionBodySchema>;

/** C103.1: a preview's counts; a non-preview's per-account outcomes. */
export const graphQueryActionResultDocumentSchema = z.strictObject({
  data: z.strictObject({
    type: z.literal('graph-query-action'),
    attributes: z.strictObject({
      action: z.enum(GRAPH_BULK_ACTIONS),
      preview: z.boolean(),
      /** The accounts of the selection that are in the stored result. */
      'selected-count': z.int().min(0),
      /** `[]` for a preview. */
      outcomes: z
        .array(z.strictObject({ 'account-id': idSchema('acc'), outcome: graphBulkOutcomeSchema }))
        .max(GRAPH_LIMITS.bulkAccounts),
      /** C140.6: the case `create-case` made; `null` for its preview. Other actions leave it out. */
      'case-id': idSchema('case').nullable().optional(),
    }),
  }),
});
export type GraphQueryActionResultDocument = z.infer<typeof graphQueryActionResultDocumentSchema>;

// ---------------------------------------------------------------------------------------------
// PII (C107.5)

/** C107.5: the PII names of the graph resources and bodies, joined by `foundation-7b`. */
export const PII_GRAPH_ATTRIBUTES: readonly string[] = Object.freeze([
  'params',
  'parameter-map',
  'variable-map',
  'value',
]);

// ---------------------------------------------------------------------------------------------
// Builders

export interface GraphQueryTemplateRecord {
  id: string;
  name: string;
  status: GraphTemplateStatus;
  latestVersion: number;
  publishedVersion: number | null;
  publishedVersionId: string | null;
  /** Owner decision 7 after 7B. Left out, the relationship is not sent. */
  latestVersionId?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** @throws {z.ZodError} when the record does not satisfy the contract. */
export function buildGraphQueryTemplateResource(
  record: GraphQueryTemplateRecord,
): GraphQueryTemplateResource {
  return graphQueryTemplateResourceSchema.parse({
    type: 'graph-query-template',
    id: record.id,
    attributes: {
      name: record.name,
      status: record.status,
      'latest-version': record.latestVersion,
      'published-version': record.publishedVersion,
      'created-at': toTimestamp(record.createdAt),
      'updated-at': toTimestamp(record.updatedAt),
    },
    relationships: {
      ...(record.latestVersionId === undefined
        ? {}
        : {
            'latest-version': {
              data: { type: 'graph-query-template-version', id: record.latestVersionId },
            },
          }),
      'published-version': {
        data:
          record.publishedVersionId === null
            ? null
            : { type: 'graph-query-template-version', id: record.publishedVersionId },
      },
    },
  });
}

export interface GraphQueryTemplateVersionRecord {
  id: string;
  templateId: string;
  versionNumber: number;
  status: GraphTemplateVersionStatus;
  config: GraphQueryTemplateConfig;
  createdAt: Date;
  publishedAt: Date | null;
}

/** @throws {z.ZodError} when the record does not satisfy the contract. */
export function buildGraphQueryTemplateVersionResource(
  record: GraphQueryTemplateVersionRecord,
): GraphQueryTemplateVersionResource {
  return graphQueryTemplateVersionResourceSchema.parse({
    type: 'graph-query-template-version',
    id: record.id,
    attributes: {
      'version-number': record.versionNumber,
      status: record.status,
      config: resolveGraphQueryTemplateConfig(record.config),
      'created-at': toTimestamp(record.createdAt),
      'published-at': toNullableTimestamp(record.publishedAt),
    },
    relationships: {
      'graph-query-template': { data: { type: 'graph-query-template', id: record.templateId } },
    },
  });
}

export interface GraphQueryRecord {
  id: string;
  status: GraphQueryStatus;
  /** As the principal may see them; `null` when redacted, and in an event's payload. */
  params: Readonly<Record<string, string | null>> | null;
  createdAt: Date;
  updatedAt: Date;
  erroredAt: Date | null;
  completedAt: Date | null;
  redactedAt: Date | null;
  explorerUrl: string | null;
  nodeLimitReached: boolean;
  nodes: readonly GraphNode[];
  links: readonly GraphLink[];
  kindsNotIndexed: readonly GraphKind[];
  skippedHubValues: number;
  templateVersionId: string;
  accountIds: readonly string[];
}

/**
 * Builds a graph query resource. `index-complete` is derived, so it can never disagree with
 * `kinds-not-indexed`.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildGraphQueryResource(record: GraphQueryRecord): GraphQueryResource {
  return graphQueryResourceSchema.parse({
    type: 'graph-query',
    id: record.id,
    attributes: {
      status: record.status,
      params: record.params,
      'created-at': toTimestamp(record.createdAt),
      'updated-at': toTimestamp(record.updatedAt),
      'errored-at': toNullableTimestamp(record.erroredAt),
      'completed-at': toNullableTimestamp(record.completedAt),
      'redacted-at': toNullableTimestamp(record.redactedAt),
      stats: {},
      'explorer-url': record.explorerUrl,
      'node-limit-reached': record.nodeLimitReached,
      nodes: record.nodes,
      'index-complete': record.kindsNotIndexed.length === 0,
      'kinds-not-indexed': record.kindsNotIndexed,
      'skipped-hub-values': record.skippedHubValues,
      'template-version-id': record.templateVersionId,
      links: record.links,
    },
    relationships: {
      accounts: { data: record.accountIds.map((id) => ({ type: 'account', id })) },
    },
  });
}
