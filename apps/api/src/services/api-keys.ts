/**
 * API keys (C12). A key's token is generated here, returned once (`meta.token` of the create and
 * clone answers) and stored only as a peppered hash; afterwards the key is known by its
 * `token-prefix`. A principal can only grant scopes it holds (403 `forbidden`), and a key minted
 * or cloned by a principal that cannot see PII sees it masked (C15, Workflow 2B F001), so
 * neither an API key nor a user can mint a key more powerful than itself. Every change writes a C15 audit
 * entry in the same transaction, and no entry carries the token.
 */
import {
  buildApiKeyResource,
  LATEST_API_VERSION,
  resolvePlatformSettings,
  type ApiKeyResource,
  type ApiVersion,
  type CreatedApiKeyDocument,
  type EnvironmentKind,
} from '@openverify/contracts';
import { isApiScope, missingPermissions, type ApiScope } from '@openverify/core';
import {
  createApiKey as insertApiKey,
  expireApiKey as setApiKeyExpiry,
  getApiKey as findApiKey,
  getEnvironment,
  listApiKeys as findApiKeys,
  updateApiKey as changeApiKey,
  type ApiKey,
  type Db,
  type GeneratedApiKey,
} from '@openverify/db';
import {
  BadRequestError,
  NotFoundError,
  PermissionDeniedError,
  UnprocessableContentError,
  type ProblemFieldError,
} from '../errors.js';
import { canViewPii } from '../auth/pii.js';
import { actorOf, type Principal, type ServiceContext } from '../ports.js';
import { auditEntryOf, type ApiDependencies, type AuditedAction } from './context.js';
import { nextLink, pageRequest, withCursor, type PageQuery } from './pagination.js';
import { assertKeyTemplateRestrictionInTx } from './cases/key-restriction.js';
import { mintablePermissions } from './access/permissions.js';

export const API_KEYS_PATH = '/api/v1/api-keys';

/** Generates a token for an environment kind: `generateApiKey` with the server pepper. */
export type ApiKeyTokenIssuer = (kind: EnvironmentKind) => GeneratedApiKey;

/**
 * Shown in place of the 4 secret characters of keys created before schema v2, whose tokens were
 * never kept, so their prefix cannot be known. `-` is a token character, so the value fits the
 * contract; a real token starting with `----` is as likely as guessing 24 random bits.
 */
export const UNKNOWN_TOKEN_CHARACTERS = '----';

/** The earlier of two optional times. */
export function earliest(first: Date | null, second: Date | null): Date | null {
  if (first === null || second === null) {
    return first ?? second;
  }
  return first.getTime() <= second.getTime() ? first : second;
}

/** C169.2: what a key's age is read against, at one time: now and the environment's setting. */
export interface ApiKeyAge {
  now: Date;
  /** `api-key-age-warning-days` of the key's environment. */
  warningDays: number;
}

const DAY_MS = 86_400_000;

/**
 * The api-key resource. A key revoked in Phase 1 reports its revocation as `expires-at`, the
 * time it stopped working; scopes outside the vocabulary grant nothing and are left out, as
 * authentication does. `pii-masked` (C25.6) says whether the key sees PII masked (2B F001).
 * C169.1-C169.3 (Workflow 9B): `note`, `attribute-blocklist` and, with `age`, `age-warning`: the key
 * is older than its environment's `api-key-age-warning-days`.
 */
export function apiKeyResource(key: ApiKey, age?: ApiKeyAge): ApiKeyResource {
  return buildApiKeyResource({
    id: key.id,
    name: key.name,
    scopes: key.scopes.filter(isApiScope),
    allowedIps: key.allowedIps ?? [],
    apiVersion: key.apiVersion as ApiVersion,
    tokenPrefix: key.tokenPrefix ?? `${key.prefix}${UNKNOWN_TOKEN_CHARACTERS}`,
    expiresAt: earliest(key.expiresAt, key.revokedAt),
    lastUsedAt: key.lastUsedAt,
    createdAt: key.createdAt,
    piiMasked: key.piiMasked,
    // C129.4 (Workflow 8B; Stage 1a amendment 12): served only when the key carries a list.
    ...(key.caseTemplateIds === null ? {} : { caseTemplateIds: key.caseTemplateIds }),
    note: key.note,
    attributeBlocklist: key.attributeBlocklist,
    ...(age === undefined
      ? {}
      : {
          ageWarning: age.now.getTime() - key.createdAt.getTime() > age.warningDays * DAY_MS,
        }),
  });
}

/** C169.2: the age the keys of `environmentId` are read against now. */
export async function apiKeyAgeOf(
  deps: ApiDependencies,
  environmentId: string,
): Promise<ApiKeyAge> {
  const environment = await getEnvironment(deps.db, environmentId);
  return {
    now: deps.clock.now(),
    warningDays: resolvePlatformSettings(environment?.settings ?? {})['api-key-age-warning-days'],
  };
}

/**
 * Refuses to grant a scope the principal does not hold (C12 no escalation).
 * @throws {PermissionDeniedError} 403 `forbidden` naming the scopes it lacks.
 */
export function ensureCanGrant(principal: Principal, scopes: readonly ApiScope[]): void {
  // C167.2 (Workflow 9B Stage 1b (U)): at most what the minter holds in the key's environment
  // (`api-access`'s hook).
  const missing = missingPermissions(mintablePermissions(principal), scopes);
  if (missing.length > 0) {
    const who = principal.kind === 'api-key' ? 'An API key' : 'A user';
    throw new PermissionDeniedError(
      `${who} can only grant scopes it holds. Missing: ${missing.join(', ')}.`,
      missing,
    );
  }
}

const IPV4_BITS = 32;
const IPV6_BITS = 128;

function ipv4Value(address: string): bigint {
  return address.split('.').reduce((value, octet) => (value << 8n) | BigInt(Number(octet)), 0n);
}

/** An IPv6 address (validated by the body schema) as a 128-bit number. */
function ipv6Value(address: string): bigint {
  let text = address;
  const embedded = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (embedded?.[1] !== undefined) {
    const v4 = ipv4Value(embedded[1]);
    text = `${text.slice(0, -embedded[1].length)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const [head = '', tail] = text.split('::');
  const groups = (part: string) => (part === '' ? [] : part.split(':'));
  const all =
    tail === undefined
      ? groups(head)
      : [
          ...groups(head),
          ...Array<string>(8 - groups(head).length - groups(tail).length).fill('0'),
          ...groups(tail),
        ];
  return all.reduce((value, group) => (value << 16n) | BigInt(Number.parseInt(group, 16)), 0n);
}

/** Whether a CIDR range has address bits set beyond its prefix, as `203.0.113.5/24` does. */
export function hasHostBits(cidr: string): boolean {
  const [address = '', prefixText = ''] = cidr.split('/');
  const v4 = address.includes('.') && !address.includes(':');
  const width = v4 ? IPV4_BITS : IPV6_BITS;
  const hostBits = BigInt(width - Number(prefixText));
  const value = v4 ? ipv4Value(address) : ipv6Value(address);
  return (value & ((1n << hostBits) - 1n)) !== 0n;
}

/**
 * The allowed ranges as stored: `null` for none, which allows every address.
 * @throws {UnprocessableContentError} 422 pointing at each range with host bits set.
 */
function storedRanges(ranges: readonly string[]): string[] | null {
  const errors: ProblemFieldError[] = ranges.flatMap((range, index) =>
    hasHostBits(range)
      ? [
          {
            location: 'body',
            pointer: `/data/attributes/allowed-ips/${String(index)}`,
            detail:
              'has address bits set beyond its prefix; name the network, such as 203.0.113.0/24',
          },
        ]
      : [],
  );
  if (errors.length > 0) {
    throw new UnprocessableContentError('allowed-ips must name networks.', errors);
  }
  return ranges.length === 0 ? null : [...ranges];
}

export const notFound = (id: string) => new NotFoundError(`API key ${id} was not found.`);

export const principalId = (principal: Principal): string =>
  principal.kind === 'api-key' ? principal.apiKeyId : principal.userId;

/** Runs `change` and records its audit entry in one transaction. */
function audited<T extends { id: string }>(
  deps: ApiDependencies,
  ctx: ServiceContext,
  principal: Principal,
  change: (tx: Db) => Promise<T>,
  action: (row: T) => Omit<AuditedAction, 'resourceType' | 'resourceId'>,
): Promise<T> {
  return deps.db.transaction(async (tx) => {
    const row = await change(tx);
    await deps.audit.record(
      tx,
      auditEntryOf(ctx, actorOf(principal), {
        ...action(row),
        resourceType: 'api-key',
        resourceId: row.id,
      }),
    );
    return row;
  });
}

export interface NewApiKeyAttributes {
  name: string;
  scopes: readonly ApiScope[];
  'allowed-ips'?: readonly string[] | undefined;
  'api-version'?: ApiVersion | undefined;
  /** C25.5: the key expires this long after creation; without it, never. */
  'expires-in-seconds'?: number | undefined;
  /** C129.4 (Workflow 8B): the restricted case templates it may see, never wider than its creator. */
  'case-template-ids'?: readonly string[] | undefined;
  /** C169.1 (Workflow 9B): what the key is for; `null` or left out for none. */
  note?: string | null | undefined;
  /** C169.3: attribute names removed from every document served to the key. */
  'attribute-blocklist'?: readonly string[] | undefined;
}

/**
 * C12 `POST /api-keys`: the key and, once, its token. With `expires-in-seconds` (C25.5) the key
 * stops working that long after creation, as `POST /api-keys/:id/expire` would make it.
 */
export async function createApiKey(
  deps: ApiDependencies,
  ctx: ServiceContext,
  principal: Principal,
  attributes: NewApiKeyAttributes,
  issue: ApiKeyTokenIssuer,
): Promise<CreatedApiKeyDocument> {
  ensureCanGrant(principal, attributes.scopes);
  const allowedIps = storedRanges(attributes['allowed-ips'] ?? []);
  const seconds = attributes['expires-in-seconds'];
  const expiresAt =
    seconds === undefined ? null : new Date(deps.clock.now().getTime() + seconds * 1000);
  const generated = issue(principal.environmentKind);
  const key = await audited(
    deps,
    ctx,
    principal,
    async (tx) => {
      const caseTemplateIds = attributes['case-template-ids'] ?? null;
      // C129.4 (P14): `api-cases` holds the list to what the creator sees.
      await assertKeyTemplateRestrictionInTx(
        tx,
        principal.environmentId,
        principal,
        caseTemplateIds,
      );
      return insertApiKey(tx, principal.environmentId, {
        id: deps.ids.newId('key'),
        name: attributes.name,
        prefix: generated.prefix,
        tokenPrefix: generated.tokenPrefix,
        secretHash: generated.secretHash,
        scopes: attributes.scopes,
        allowedIps,
        apiVersion: attributes['api-version'] ?? LATEST_API_VERSION,
        createdById: principalId(principal),
        piiMasked: !canViewPii(principal),
        expiresAt,
        caseTemplateIds,
        note: attributes.note ?? null,
        attributeBlocklist: attributes['attribute-blocklist'] ?? [],
      });
    },
    () => ({
      action: 'api-key.created',
      metadata: {
        scopes: [...attributes.scopes],
        ...(expiresAt === null ? {} : { 'expires-at': expiresAt.toISOString() }),
      },
    }),
  );
  return {
    data: apiKeyResource(key, await apiKeyAgeOf(deps, principal.environmentId)),
    meta: { token: generated.token },
  };
}

/** @throws {NotFoundError} when the key is not in the principal's environment. */
export async function getApiKey(
  deps: ApiDependencies,
  principal: Principal,
  id: string,
): Promise<ApiKeyResource> {
  const key = await findApiKey(deps.db, principal.environmentId, id);
  if (key === null) {
    throw notFound(id);
  }
  return apiKeyResource(key, await apiKeyAgeOf(deps, principal.environmentId));
}

/** C12 `GET /api-keys`: newest first. */
export async function listApiKeys(
  deps: ApiDependencies,
  principal: Principal,
  query: PageQuery & { 'filter[created-at-start]'?: string; 'filter[created-at-end]'?: string },
): Promise<{ data: ApiKeyResource[]; links: { next: string | null } }> {
  if (
    query['filter[created-at-start]'] !== undefined ||
    query['filter[created-at-end]'] !== undefined
  ) {
    throw new BadRequestError('API keys cannot be filtered by creation time.');
  }
  const page = await withCursor(() =>
    findApiKeys(deps.db, principal.environmentId, pageRequest(query)),
  );
  const age = await apiKeyAgeOf(deps, principal.environmentId);
  return {
    data: page.items.map((key) => apiKeyResource(key, age)),
    links: { next: nextLink(API_KEYS_PATH, {}, query, page.next) },
  };
}

/**
 * C12 `PATCH /api-keys/:id`: the name and allowed ranges, and (C169.1, C169.3) the note (`null`
 * removes it) and the blocklist (replaces the stored one). Scopes and version never change. The audit
 * entry names what changed, never a value.
 * @throws {NotFoundError} when the key is not in the principal's environment.
 */
export async function updateApiKey(
  deps: ApiDependencies,
  ctx: ServiceContext,
  principal: Principal,
  id: string,
  changes: {
    name?: string | undefined;
    'allowed-ips'?: readonly string[] | undefined;
    note?: string | null | undefined;
    'attribute-blocklist'?: readonly string[] | undefined;
  },
): Promise<ApiKeyResource> {
  const allowedIps =
    changes['allowed-ips'] === undefined ? undefined : storedRanges(changes['allowed-ips']);
  const changed = [
    ...(changes.name === undefined ? [] : ['name']),
    ...(allowedIps === undefined ? [] : ['allowed-ips']),
    ...(changes.note === undefined ? [] : ['note']),
    ...(changes['attribute-blocklist'] === undefined ? [] : ['attribute-blocklist']),
  ];
  const key = await audited(
    deps,
    ctx,
    principal,
    async (tx) => {
      const row = await changeApiKey(tx, principal.environmentId, id, {
        ...(changes.name === undefined ? {} : { name: changes.name }),
        ...(allowedIps === undefined ? {} : { allowedIps }),
        ...(changes.note === undefined ? {} : { note: changes.note }),
        ...(changes['attribute-blocklist'] === undefined
          ? {}
          : { attributeBlocklist: changes['attribute-blocklist'] }),
      });
      if (row === null) {
        throw notFound(id);
      }
      return row;
    },
    () => ({ action: 'api-key.updated', metadata: { changed } }),
  );
  return apiKeyResource(key, await apiKeyAgeOf(deps, principal.environmentId));
}

/**
 * A new key from `source` in the caller's transaction: its scopes, ranges, version, restriction,
 * blocklist and note (C169.1, C169.3), a new token's hash, and `pii-masked` when either the source or
 * the caller cannot see PII. The checks are the clone's: the caller holds every scope (checked before,
 * `ensureCanGrant`) and every restricted template it copies. Shared by clone and rotation.
 */
export async function insertKeyCopyInTx(
  deps: ApiDependencies,
  tx: Db,
  principal: Principal,
  source: ApiKey,
  copy: { name: string; generated: GeneratedApiKey },
): Promise<ApiKey> {
  // C129.4 (Stage 1a amendment 12): a copy keeps the restriction, held to its new creator.
  await assertKeyTemplateRestrictionInTx(
    tx,
    principal.environmentId,
    principal,
    source.caseTemplateIds,
  );
  return insertApiKey(tx, principal.environmentId, {
    id: deps.ids.newId('key'),
    name: copy.name,
    prefix: copy.generated.prefix,
    tokenPrefix: copy.generated.tokenPrefix,
    secretHash: copy.generated.secretHash,
    scopes: source.scopes.filter(isApiScope),
    allowedIps: source.allowedIps,
    apiVersion: source.apiVersion,
    createdById: principalId(principal),
    piiMasked: source.piiMasked || !canViewPii(principal),
    caseTemplateIds: source.caseTemplateIds,
    note: source.note,
    attributeBlocklist: source.attributeBlocklist,
  });
}

/**
 * C12 `POST /api-keys/:id/clone`: a new key with the source's scopes, ranges and version (and, since
 * Workflow 9B, its blocklist and note), and a new token. The caller must hold every scope it copies.
 * @throws {NotFoundError} when the key is not in the principal's environment.
 */
export async function cloneApiKey(
  deps: ApiDependencies,
  ctx: ServiceContext,
  principal: Principal,
  id: string,
  name: string | undefined,
  issue: ApiKeyTokenIssuer,
): Promise<CreatedApiKeyDocument> {
  const source = await findApiKey(deps.db, principal.environmentId, id);
  if (source === null) {
    throw notFound(id);
  }
  ensureCanGrant(principal, source.scopes.filter(isApiScope));
  const generated = issue(principal.environmentKind);
  const key = await audited(
    deps,
    ctx,
    principal,
    (tx) =>
      insertKeyCopyInTx(deps, tx, principal, source, { name: name ?? source.name, generated }),
    () => ({ action: 'api-key.cloned', metadata: { 'source-api-key-id': source.id } }),
  );
  return {
    data: apiKeyResource(key, await apiKeyAgeOf(deps, principal.environmentId)),
    meta: { token: generated.token },
  };
}

/**
 * C12 `POST /api-keys/:id/expire`: the key stops working `seconds` from now (0: now). An
 * earlier expiry is kept, so expiring never extends a key's life.
 * @throws {NotFoundError} when the key is not in the principal's environment.
 */
export async function expireApiKey(
  deps: ApiDependencies,
  ctx: ServiceContext,
  principal: Principal,
  id: string,
  seconds: number,
): Promise<ApiKeyResource> {
  const requested = new Date(deps.clock.now().getTime() + seconds * 1000);
  const key = await audited(
    deps,
    ctx,
    principal,
    async (tx) => {
      const current = await findApiKey(tx, principal.environmentId, id);
      const at = earliest(current?.expiresAt ?? null, requested) ?? requested;
      const row =
        current === null ? null : await setApiKeyExpiry(tx, principal.environmentId, id, at);
      if (row === null) {
        throw notFound(id);
      }
      return row;
    },
    (row) => ({
      action: 'api-key.expired',
      metadata: { 'expires-at': (row.expiresAt ?? requested).toISOString() },
    }),
  );
  return apiKeyResource(key, await apiKeyAgeOf(deps, principal.environmentId));
}
