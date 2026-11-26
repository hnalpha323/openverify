import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { Db } from '../client.js';
import { apiKeys, environments, type ApiKey, type Environment } from '../schema.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import { firstOrNull, inserted } from './rows.js';

export interface NewApiKeyInput {
  id: string;
  name: string;
  prefix: string;
  /** `hashApiKeySecret(token, pepper)`; the token itself is never stored. */
  secretHash: string;
  scopes?: readonly string[];
  /** CIDR allowlist; omit or `null` for any address. */
  allowedIps?: readonly string[] | null;
  expiresAt?: Date | null;
  /** `generateApiKey(...).tokenPrefix` (C12 `token-prefix`). */
  tokenPrefix?: string | null;
  /** C12 `api-version`; defaults to the database default (the current version). */
  apiVersion?: string;
  /** The principal that created the key, `usr_...` or `key_...`. */
  createdById?: string | null;
  /** C15: the key sees PII masked (its creator could not see it). Defaults to `false`. */
  piiMasked?: boolean;
  /**
   * C129.4 (P14): the restricted case templates the key may see, checked against its creator by
   * `assertKeyTemplateRestrictionInTx`; omit or `null` for none.
   */
  caseTemplateIds?: readonly string[] | null;
  /** C169.1 (Workflow 9B): what the key is for; omit or `null` for none. */
  note?: string | null;
  /** C169.3: attribute names removed from every document served to the key; omit for none. */
  attributeBlocklist?: readonly string[];
}

/** C12 `PATCH /api-keys/:id`; C169.1 and C169.3 (Workflow 9B) add the note and the blocklist. */
export interface ApiKeyChanges {
  name?: string;
  /** CIDR allowlist; `null` allows any address. */
  allowedIps?: readonly string[] | null;
  /** `null` removes the note. */
  note?: string | null;
  /** Replaces the stored blocklist; `[]` removes it. */
  attributeBlocklist?: readonly string[];
}

export interface ApiKeyWithEnvironment {
  apiKey: ApiKey;
  environment: Environment;
}

export interface TouchApiKeyOptions {
  /** Defaults to now. */
  at?: Date;
  /** Skip the write when the key was already marked this recently. Defaults to 60 s. */
  minIntervalMs?: number;
}

const DEFAULT_TOUCH_INTERVAL_MS = 60_000;

export async function createApiKey(
  db: Db,
  environmentId: string,
  input: NewApiKeyInput,
): Promise<ApiKey> {
  const rows = await db
    .insert(apiKeys)
    .values({
      id: input.id,
      environmentId,
      name: input.name,
      prefix: input.prefix,
      secretHash: input.secretHash,
      scopes: [...(input.scopes ?? [])],
      allowedIps: input.allowedIps ? [...input.allowedIps] : null,
      expiresAt: input.expiresAt ?? null,
      tokenPrefix: input.tokenPrefix ?? null,
      createdById: input.createdById ?? null,
      piiMasked: input.piiMasked ?? false,
      caseTemplateIds: input.caseTemplateIds ? [...input.caseTemplateIds] : null,
      note: input.note ?? null,
      attributeBlocklist: [...(input.attributeBlocklist ?? [])],
      ...(input.apiVersion === undefined ? {} : { apiVersion: input.apiVersion }),
    })
    .returning();
  return inserted(rows, 'createApiKey');
}

const apiKeyCursor = environmentCursor(apiKeys);
const inEnvironment = (environmentId: string, id: string) =>
  and(eq(apiKeys.id, id), eq(apiKeys.environmentId, environmentId));

export async function getApiKey(db: Db, environmentId: string, id: string): Promise<ApiKey | null> {
  return firstOrNull(
    await db.select().from(apiKeys).where(inEnvironment(environmentId, id)).limit(1),
  );
}

/** C12 `GET /api-keys`: newest first. Rows hold only the secret's keyed hash. */
export async function listApiKeys(
  db: Db,
  environmentId: string,
  page: PageRequest = {},
): Promise<Page<ApiKey>> {
  return paginate(db, apiKeyCursor, environmentId, page, (after, limit) =>
    db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.environmentId, environmentId), after))
      .orderBy(...newestFirst(apiKeyCursor))
      .limit(limit),
  );
}

/**
 * C12 `PATCH /api-keys/:id`: name and allowed IPs, and (C169.1, C169.3) the note and the blocklist.
 * `null` when the key is not here.
 */
export async function updateApiKey(
  db: Db,
  environmentId: string,
  id: string,
  changes: ApiKeyChanges,
): Promise<ApiKey | null> {
  const set: Partial<typeof apiKeys.$inferInsert> = {};
  if (changes.name !== undefined) set.name = changes.name;
  if (changes.allowedIps !== undefined) {
    set.allowedIps = changes.allowedIps === null ? null : [...changes.allowedIps];
  }
  if (changes.note !== undefined) set.note = changes.note;
  if (changes.attributeBlocklist !== undefined) {
    set.attributeBlocklist = [...changes.attributeBlocklist];
  }
  if (Object.keys(set).length === 0) {
    return getApiKey(db, environmentId, id);
  }
  return firstOrNull(
    await db.update(apiKeys).set(set).where(inEnvironment(environmentId, id)).returning(),
  );
}

/** C12 `POST /api-keys/:id/expire`: the key stops working at `at` (now for 0 seconds). */
export async function expireApiKey(
  db: Db,
  environmentId: string,
  id: string,
  at: Date,
): Promise<ApiKey | null> {
  return firstOrNull(
    await db
      .update(apiKeys)
      .set({ expiresAt: at })
      .where(inEnvironment(environmentId, id))
      .returning(),
  );
}

/**
 * The API key auth lookup: finds a key by `hashApiKeySecret(token, pepper)` across all
 * environments, because the key is what tells us the environment. Revoked and expired
 * keys are returned too, so the caller can report why they are refused.
 */
export async function findApiKeyBySecretHash(
  db: Db,
  secretHash: string,
): Promise<ApiKeyWithEnvironment | null> {
  return firstOrNull(
    await db
      .select({ apiKey: apiKeys, environment: environments })
      .from(apiKeys)
      .innerJoin(environments, eq(apiKeys.environmentId, environments.id))
      .where(eq(apiKeys.secretHash, secretHash))
      .limit(1),
  );
}

/**
 * Records that a key was used. Writes at most once per `minIntervalMs`, so a busy key
 * does not turn every request into a row update. Returns whether it wrote.
 */
export async function touchApiKeyLastUsed(
  db: Db,
  environmentId: string,
  id: string,
  options: TouchApiKeyOptions = {},
): Promise<boolean> {
  const at = options.at ?? new Date();
  const threshold = new Date(at.getTime() - (options.minIntervalMs ?? DEFAULT_TOUCH_INTERVAL_MS));
  const rows = await db
    .update(apiKeys)
    .set({ lastUsedAt: at })
    .where(
      and(
        eq(apiKeys.id, id),
        eq(apiKeys.environmentId, environmentId),
        or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, threshold)),
      ),
    )
    .returning({ id: apiKeys.id });
  return rows.length > 0;
}

/** Revokes an active key; `null` when it does not exist here or is already revoked. */
export async function revokeApiKey(
  db: Db,
  environmentId: string,
  id: string,
  at: Date = new Date(),
): Promise<ApiKey | null> {
  return firstOrNull(
    await db
      .update(apiKeys)
      .set({ revokedAt: at })
      .where(
        and(
          eq(apiKeys.id, id),
          eq(apiKeys.environmentId, environmentId),
          isNull(apiKeys.revokedAt),
        ),
      )
      .returning(),
  );
}
