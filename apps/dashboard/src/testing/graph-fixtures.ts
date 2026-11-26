/**
 * Synthetic API documents for the graph pages (C108, `dashboard-graph`): query templates and
 * their versions, graph queries with their results, an unmasked node value and bulk-action
 * answers. Every id is a made-up ULID; every property node id is `gn_` plus 22 base64url
 * characters of a seeded digest, never a value or a key; the only plaintext values are synthetic
 * ones at `example.test`, and they appear only in the unmask answer and in the parameters served
 * to a principal with `pii:view`. Each builder parses its result with the contract schema, so a
 * fixture that drifts from the contract fails where it is built.
 */
import { createHash } from 'node:crypto';
import {
  buildListResource,
  buildGraphQueryResource,
  buildGraphQueryTemplateResource,
  buildGraphQueryTemplateVersionResource,
  accountGraphComponentDocumentSchema,
  graphNodeValueDocumentSchema,
  graphQueryActionResultDocumentSchema,
  type AccountGraphComponentDocument,
  type AccountGraphComponentResource,
  type GraphKind,
  type GraphLink,
  type GraphNode,
  type GraphQueryResource,
  type GraphQueryTemplateConfig,
  type GraphQueryTemplateResource,
  type GraphQueryTemplateVersionResource,
  type ListResource,
} from '@openverify/contracts';
import type {
  GraphBulkAction,
  GraphBulkOutcome,
  GraphQueryStatus,
  GraphTemplateVersionStatus,
} from '@openverify/core';

/** A made-up ULID body of 26 characters ending in `n`. */
const ulid = (n: number) => `01JC${String(n).padStart(22, '0')}`;

export const GRAPH_IDS = {
  template: `grqt_${ulid(1)}`,
  otherTemplate: `grqt_${ulid(2)}`,
  version: `grqtv_${ulid(1)}`,
  draft: `grqtv_${ulid(2)}`,
  superseded: `grqtv_${ulid(3)}`,
  query: `grphq_${ulid(1)}`,
  otherQuery: `grphq_${ulid(2)}`,
  expansion: `grphq_${ulid(3)}`,
  accountA: `acc_${ulid(101)}`,
  accountB: `acc_${ulid(102)}`,
  accountC: `acc_${ulid(103)}`,
  accountD: `acc_${ulid(104)}`,
  list: `lst_${ulid(1)}`,
} as const;

export const G0 = '2026-10-31T09:00:00.000Z';
export const G1 = '2026-10-31T09:00:02.000Z';

/** The synthetic email address behind the shared email node; only the unmask answers it. */
export const SHARED_EMAIL = 'shared-person@example.test';
/** A synthetic phone number behind the phone node (the fictional UK drama range). */
export const SHARED_PHONE = '+447700900123';

/** A property node id of `seed`: `gn_` plus 22 base64url characters of a seeded digest. */
export function graphNodeId(seed: string): string {
  const digest = createHash('sha256').update(`openverify/dashboard-graph/${seed}`).digest();
  return `gn_${digest.toString('base64url').slice(0, 22)}`;
}

export const NODE_IDS = {
  email: graphNodeId('email'),
  phone: graphNodeId('phone'),
  expandedEmail: graphNodeId('expanded-email'),
} as const;

export const TEMPLATE_NAME = 'Shared contact details';

/** A template from the account in context over the strong contact kinds. */
export const ACCOUNT_CONFIG: GraphQueryTemplateConfig = Object.freeze({
  parameters: [{ name: 'account_id', kind: 'account_id' }],
  start: [{ kind: 'account_id', value: '{{account_id}}' }],
  'connect-kinds': ['email_address', 'phone_number', 'phone_number_unconfirmed'],
  'max-hops': 4,
  'node-limit': 100,
}) as GraphQueryTemplateConfig;

/** A template that starts from an email address (a person-identifying parameter, P11). */
export const EMAIL_CONFIG: GraphQueryTemplateConfig = Object.freeze({
  parameters: [{ name: 'email', kind: 'email_address' }],
  start: [{ kind: 'email_address', value: '{{email}}' }],
  'connect-kinds': ['email_address'],
}) as GraphQueryTemplateConfig;

export interface TemplateOptions {
  readonly id?: string;
  readonly name?: string;
  readonly status?: 'active' | 'archived';
  readonly latestVersion?: number;
  readonly publishedVersion?: number | null;
  readonly publishedVersionId?: string | null;
  /** K7B-3: the `latest-version` relationship; left out, none is sent. */
  readonly latestVersionId?: string;
}

export function graphTemplate(options: TemplateOptions = {}): GraphQueryTemplateResource {
  const publishedVersion = options.publishedVersion === undefined ? 1 : options.publishedVersion;
  return buildGraphQueryTemplateResource({
    id: options.id ?? GRAPH_IDS.template,
    name: options.name ?? TEMPLATE_NAME,
    status: options.status ?? 'active',
    latestVersion: options.latestVersion ?? Math.max(publishedVersion ?? 1, 1),
    publishedVersion,
    publishedVersionId:
      options.publishedVersionId === undefined
        ? publishedVersion === null
          ? null
          : GRAPH_IDS.version
        : options.publishedVersionId,
    ...(options.latestVersionId === undefined ? {} : { latestVersionId: options.latestVersionId }),
    createdAt: new Date(G0),
    updatedAt: new Date(G1),
  });
}

export interface VersionOptions {
  readonly id?: string;
  readonly templateId?: string;
  readonly versionNumber?: number;
  readonly status?: GraphTemplateVersionStatus;
  readonly config?: GraphQueryTemplateConfig;
}

export function graphTemplateVersion(
  options: VersionOptions = {},
): GraphQueryTemplateVersionResource {
  const status = options.status ?? 'published';
  return buildGraphQueryTemplateVersionResource({
    id: options.id ?? GRAPH_IDS.version,
    templateId: options.templateId ?? GRAPH_IDS.template,
    versionNumber: options.versionNumber ?? 1,
    status,
    config: options.config ?? ACCOUNT_CONFIG,
    createdAt: new Date(G0),
    publishedAt: status === 'draft' ? null : new Date(G1),
  });
}

/** A draft, version 2 of the template. */
export function graphTemplateDraft(options: VersionOptions = {}) {
  return graphTemplateVersion({
    id: GRAPH_IDS.draft,
    versionNumber: 2,
    status: 'draft',
    ...options,
  });
}

/**
 * The default result: accounts A and B share a confirmed email, B and C an unconfirmed phone, all
 * from A, two hops each way.
 */
export const DEFAULT_NODES: readonly GraphNode[] = Object.freeze([
  { type: 'account', value: GRAPH_IDS.accountA },
  { type: 'email_address', value: NODE_IDS.email },
  { type: 'account', value: GRAPH_IDS.accountB },
  { type: 'phone_number_unconfirmed', value: NODE_IDS.phone },
  { type: 'account', value: GRAPH_IDS.accountC },
]);

export const DEFAULT_LINKS: readonly GraphLink[] = Object.freeze([
  { from: GRAPH_IDS.accountA, to: NODE_IDS.email, kind: 'email_address' },
  { from: GRAPH_IDS.accountB, to: NODE_IDS.email, kind: 'email_address' },
  { from: GRAPH_IDS.accountB, to: NODE_IDS.phone, kind: 'phone_number_unconfirmed' },
  { from: GRAPH_IDS.accountC, to: NODE_IDS.phone, kind: 'phone_number_unconfirmed' },
]);

export interface QueryOptions {
  readonly id?: string;
  readonly status?: GraphQueryStatus;
  /** As served: values `null` when masked (no `pii:view`). */
  readonly params?: Readonly<Record<string, string | null>> | null;
  readonly nodes?: readonly GraphNode[];
  readonly links?: readonly GraphLink[];
  readonly kindsNotIndexed?: readonly GraphKind[];
  readonly nodeLimitReached?: boolean;
  readonly skippedHubValues?: number;
  readonly redacted?: boolean;
  readonly templateVersionId?: string;
  /** `null` without a configured console URL (K7B-11). */
  readonly explorerUrl?: string | null;
}

const accountsOf = (nodes: readonly GraphNode[]) =>
  nodes.filter((node) => node.type === 'account').map((node) => node.value);

export function graphQuery(options: QueryOptions = {}): GraphQueryResource {
  const status = options.status ?? 'completed';
  const redacted = options.redacted === true;
  const nodes = redacted ? [] : (options.nodes ?? (status === 'submitted' ? [] : DEFAULT_NODES));
  const links = redacted ? [] : (options.links ?? (status === 'submitted' ? [] : DEFAULT_LINKS));
  const id = options.id ?? GRAPH_IDS.query;
  return buildGraphQueryResource({
    id,
    status,
    params: redacted
      ? null
      : options.params === undefined
        ? { account_id: GRAPH_IDS.accountA }
        : options.params,
    createdAt: new Date(G0),
    updatedAt: new Date(G1),
    erroredAt: status === 'errored' ? new Date(G1) : null,
    completedAt: status === 'completed' ? new Date(G1) : null,
    redactedAt: redacted ? new Date(G1) : null,
    explorerUrl:
      options.explorerUrl === undefined ? `http://localhost:3001/graph/${id}` : options.explorerUrl,
    nodeLimitReached: options.nodeLimitReached ?? false,
    nodes,
    links,
    kindsNotIndexed: options.kindsNotIndexed ?? [],
    skippedHubValues: options.skippedHubValues ?? 0,
    templateVersionId: options.templateVersionId ?? GRAPH_IDS.version,
    accountIds: accountsOf(nodes),
  });
}

/**
 * A result of `accounts` accounts, each pair of neighbours sharing an email node: `2n - 1` nodes,
 * for the size and keyboard tests.
 */
export function chainQuery(accounts: number, options: QueryOptions = {}): GraphQueryResource {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  let previous: string | undefined;
  for (let index = 0; index < accounts; index += 1) {
    const account = `acc_01JD${String(index).padStart(22, '0')}`;
    if (previous !== undefined) {
      const node = graphNodeId(`chain-${String(index)}`);
      nodes.push({ type: 'email_address_unconfirmed', value: node });
      links.push({ from: previous, to: node, kind: 'email_address_unconfirmed' });
      links.push({ from: account, to: node, kind: 'email_address_unconfirmed' });
    }
    nodes.push({ type: 'account', value: account });
    previous = account;
  }
  return graphQuery({ nodes, links, ...options });
}

export const single = <Resource>(data: Resource) => ({ data });

/** K7B-2 (C101.6): an account's component, computed unless `attributes` say otherwise. */
export function accountGraphComponent(
  attributes: Partial<AccountGraphComponentResource['attributes']> = {},
): AccountGraphComponentDocument {
  return accountGraphComponentDocumentSchema.parse({
    data: {
      type: 'account-graph-component',
      id: GRAPH_IDS.accountB,
      attributes: {
        state: 'computed',
        size: 4,
        'computed-at': '2026-10-20T03:00:00.000Z',
        ...attributes,
      },
    },
  });
}

export function page<Resource>(data: readonly Resource[], next: string | null = null) {
  return { data, links: { next } };
}

export function nodeValueDocument(
  nodeId: string = NODE_IDS.email,
  kind: GraphKind = 'email_address',
  value: string | null = SHARED_EMAIL,
) {
  return graphNodeValueDocumentSchema.parse({
    data: { type: 'graph-node-value', id: nodeId, attributes: { kind, value } },
  });
}

export function actionResultDocument(
  action: GraphBulkAction,
  options: {
    readonly preview?: boolean;
    readonly selectedCount?: number;
    readonly outcomes?: readonly { accountId: string; outcome: GraphBulkOutcome }[];
  } = {},
) {
  const outcomes = options.preview === true ? [] : (options.outcomes ?? []);
  return graphQueryActionResultDocumentSchema.parse({
    data: {
      type: 'graph-query-action',
      attributes: {
        action,
        preview: options.preview ?? false,
        'selected-count': options.selectedCount ?? outcomes.length,
        outcomes: outcomes.map(({ accountId, outcome }) => ({ 'account-id': accountId, outcome })),
      },
    },
  });
}

/** An active email list, for `add-to-list`. */
export function graphList(): ListResource {
  return buildListResource({
    id: GRAPH_IDS.list,
    kind: 'email-address',
    name: 'Watched emails',
    status: 'active',
    archivedAt: null,
    createdAt: new Date(G0),
    updatedAt: new Date(G1),
    itemCount: 0,
    version: 1,
    itemRetentionDays: null,
    screenAtCompletion: true,
    attributes: {},
  });
}
