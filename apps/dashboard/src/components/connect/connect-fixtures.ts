/**
 * Synthetic Connect resources for the console's tests, built from contracts-11a's golden fixtures
 * (`contracts/fixtures/api/connect/`) and parsed with the contract schemas, so a test never holds a
 * shape the API cannot send. Every name, id and reference is synthetic.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  connectionDocumentSchema,
  consentRecordDocumentSchema,
  shareTokenDocumentSchema,
  type ConnectionResource,
  type ConnectCloneProvenance,
  type ConnectHydrateProvenance,
  type ConnectionStatus,
  type ConsentRecordResource,
  type ShareTokenResource,
} from '@openverify/contracts';

/** The repository's `contracts/fixtures/`, as a path (jsdom's `URL` is not one `fs` takes). */
export const CONTRACT_FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  '..',
  'contracts',
  'fixtures',
);
const GOLDENS = join(CONTRACT_FIXTURES, 'api', 'connect');

/** One golden document, as JSON. */
export function goldenConnectDocument(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(GOLDENS, `${name}.json`), 'utf8')) as Record<string, unknown>;
}

const GOLDEN_OF = {
  inbound: 'connection-destination',
  outbound: 'connection-source',
  self: 'connection-self',
} as const;

export const CONNECTION_IDS = {
  inbound: 'cxn_01M5CN0000000000000011A100',
  outbound: 'cxn_01M5CN0000000000000011A102',
  self: 'cxn_01M5CN0000000000000011A101',
} as const;

/** The agreement reference of the golden destination view (synthetic). */
export const AGREEMENT_REFERENCE = 'Synthetic data-sharing agreement DSA-TEST-A';

export interface ConnectionOptions {
  readonly status?: ConnectionStatus;
  /** The current policy version (1 in the goldens). */
  readonly version?: number;
  readonly acceptedVersion?: number | null;
  /** Null: the source is not told the destination's name before the first activation. */
  readonly destinationName?: string | null;
  readonly deactivatedBy?: 'source' | 'destination';
}

/** A connection as the caller on `direction`'s side sees it, from the goldens. */
export function connection(
  direction: keyof typeof GOLDEN_OF,
  options: ConnectionOptions = {},
): ConnectionResource {
  const document = goldenConnectDocument(GOLDEN_OF[direction]) as {
    data: { id: string; attributes: Record<string, unknown> };
  };
  const attributes = document.data.attributes;
  const policy = attributes['share-policy'] as Record<string, unknown>;
  const status = options.status ?? (attributes.status as ConnectionStatus);
  const inactive = status === 'inactive';
  const data = {
    ...document.data,
    id: CONNECTION_IDS[direction],
    attributes: {
      ...attributes,
      status,
      'share-policy': { ...policy, version: options.version ?? policy.version },
      'accepted-policy-version':
        options.acceptedVersion === undefined
          ? status === 'pending'
            ? null
            : attributes['accepted-policy-version']
          : options.acceptedVersion,
      'activated-at': status === 'pending' ? null : attributes['activated-at'],
      'deactivated-at': inactive ? '2026-10-21T09:00:00.000Z' : null,
      'deactivated-by': inactive ? (options.deactivatedBy ?? 'source') : null,
      ...(options.destinationName === undefined
        ? {}
        : { 'destination-organization-name': options.destinationName }),
    },
  };
  return connectionDocumentSchema.parse({ data }).data;
}

/** A list document of `connections`, as `GET /connect/connections` answers it. */
export function connectionList(
  connections: readonly ConnectionResource[],
  next: string | null = null,
): Record<string, unknown> {
  return {
    data: connections,
    links: {
      next:
        next === null
          ? null
          : `/api/v1/connect/connections?page%5Bafter%5D=${encodeURIComponent(next)}`,
    },
  };
}

/** The golden share tokens: each side's view, the destination's peek and its redeemed view. */
const TOKEN_GOLDENS = {
  outbound: 'share-token-outbound',
  inbound: 'share-token-inbound',
  peek: 'share-token-peek',
  redeemed: 'share-token-inbound-redeemed',
  pending: 'share-token-redeem-accepted',
} as const;

export const SHARE_TOKEN_ID = 'cnst_01M5CN0000000000000011A200';
/** The first name the golden peek shows in full (synthetic). */
export const PEEKED_NAME = 'Alex';
/** The golden outbound token's source inquiry and consent record. */
export const SHARED_INQUIRY_ID = 'inq_01M5CJXHG07XPHF3HRM6NREDH7';
export const SOURCE_CONSENT_RECORD_ID = 'cnsr_01M5CN0000000000000011A300';
/** The golden redeemed token's destination inquiry. */
export const CLONED_INQUIRY_ID = 'inq_01M5CN0000000000000011A400';

/** A golden share token, with attributes changed by `attributes` and parsed by the schema. */
export function shareToken(
  golden: keyof typeof TOKEN_GOLDENS,
  attributes: Readonly<Record<string, unknown>> = {},
  id: string = SHARE_TOKEN_ID,
): ShareTokenResource {
  const document = goldenConnectDocument(TOKEN_GOLDENS[golden]) as {
    data: { attributes: Record<string, unknown> };
  };
  return shareTokenDocumentSchema.parse({
    data: { ...document.data, id, attributes: { ...document.data.attributes, ...attributes } },
  }).data;
}

/** A list document of `tokens`, as `GET /connect/share-tokens` answers it. */
export function shareTokenList(
  tokens: readonly ShareTokenResource[],
  next: string | null = null,
): Record<string, unknown> {
  return {
    data: tokens,
    links: {
      next:
        next === null
          ? null
          : `/api/v1/connect/share-tokens?page%5Bafter%5D=${encodeURIComponent(next)}`,
    },
  };
}

const CONSENT_GOLDENS = {
  'source-flow': 'consent-record-source-flow',
  declined: 'consent-record-declined',
  'destination-attested': 'consent-record-destination-attested',
  withdrawn: 'consent-record-withdrawn',
} as const;

/** The evidence an operator with `pii:view` is served (synthetic: a documentation address). */
export const CONSENT_EVIDENCE = {
  'ip-address': '192.0.2.10',
  'user-agent': 'Synthetic Agent/1.0',
  'text-body': 'Synthetic consent text shown to the person.',
} as const;

/** A golden consent record, with attributes changed by `attributes` and parsed by the schema. */
export function consentRecord(
  golden: keyof typeof CONSENT_GOLDENS,
  attributes: Readonly<Record<string, unknown>> = {},
  id?: string,
): ConsentRecordResource {
  const document = goldenConnectDocument(CONSENT_GOLDENS[golden]) as {
    data: { id: string; attributes: Record<string, unknown> };
  };
  return consentRecordDocumentSchema.parse({
    data: {
      ...document.data,
      id: id ?? document.data.id,
      attributes: { ...document.data.attributes, ...attributes },
    },
  }).data;
}

/** The golden clone provenance of an inquiry (`event-inquiry-cloned.json`'s). */
export const CLONE_PROVENANCE: ConnectCloneProvenance = {
  kind: 'connect-clone',
  'share-token-id': SHARE_TOKEN_ID,
  'source-organization-name': 'Example Source',
  'source-environment-kind': 'sandbox',
  'source-created-at': '2026-10-20T12:00:00.000Z',
  'source-status': 'approved',
  'cloned-at': '2026-10-20T12:15:20.000Z',
};

/** A hydrate provenance naming two filled keys. */
export const HYDRATE_PROVENANCE: ConnectHydrateProvenance = {
  kind: 'connect-hydrate',
  'share-token-id': SHARE_TOKEN_ID,
  'source-organization-name': 'Example Source',
  'hydrated-at': '2026-10-20T12:15:20.000Z',
  fields: ['birthdate', 'name_first'],
};
