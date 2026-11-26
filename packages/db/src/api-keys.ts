import { createHmac, randomBytes } from 'node:crypto';
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import {
  apiKeys,
  environments,
  type ApiKey,
  type Environment,
  type EnvironmentKind,
} from './schema.js';

/** Token prefixes per environment kind. They make leaked keys easy to recognise and scan for. */
export const API_KEY_PREFIXES = {
  sandbox: 'ov_sbx_',
  production: 'ov_prod_',
} as const satisfies Record<EnvironmentKind, string>;

const SECRET_BYTES = 32;
const MIN_PEPPER_BYTES = 32;
const PEPPER_ID_HEX_CHARS = 16;

function assertPepper(pepper: Uint8Array): void {
  if (pepper.length < MIN_PEPPER_BYTES) {
    throw new RangeError(`API key pepper must be at least ${String(MIN_PEPPER_BYTES)} bytes`);
  }
}

export interface GeneratedApiKey {
  /** The full token. Show it to the user once; it is never stored. */
  token: string;
  /** Value for `api_keys.prefix`. */
  prefix: string;
  /** Value for `api_keys.token_prefix` (C12): the prefix plus the first 4 secret characters. */
  tokenPrefix: string;
  /** Value for `api_keys.secret_hash`. */
  secretHash: string;
  /** C247.1: value for `api_keys.pepper_key_id`, `apiKeyPepperId(pepper)`. */
  pepperKeyId: string;
}

/** C12 `token-prefix`: the environment prefix plus the first 4 secret characters. */
export const API_KEY_TOKEN_PREFIX_SECRET_CHARS = 4;

/**
 * HMAC-SHA256 of the full token, keyed by the server pepper, as lowercase hex. See the
 * `api_keys.secret_hash` column for why this is used instead of argon2id.
 */
export function hashApiKeySecret(token: string, pepper: Uint8Array): string {
  assertPepper(pepper);
  return createHmac('sha256', pepper).update(token, 'utf8').digest('hex');
}

/**
 * C247.1 (Phase 11, Workflow 11B; amendment 9): the label of a pepper's identifier, a non-secret
 * name for the pepper a stored hash was made under (`api_keys.pepper_key_id`).
 */
export const API_KEY_PEPPER_ID_LABEL = 'openverify/api-key-pepper-id/v1';

/** C247.1: `OPENVERIFY_API_KEY_PEPPER_PREVIOUS` holds at most this many earlier peppers. */
export const API_KEY_PREVIOUS_PEPPERS_MAX = 2;

/** One hash a token is looked up by: under the current pepper, or under an earlier one. */
export interface PepperedApiKeyHash {
  /** `hashApiKeySecret(token, pepper)`. */
  secretHash: string;
  /** `apiKeyPepperId(pepper)`. */
  pepperKeyId: string;
  /** The current pepper's hash, which a key found under an earlier one is moved to. */
  current: boolean;
}

/**
 * C247.1: the identifier of a pepper, the first 16 hex characters of
 * HMAC-SHA-256(pepper, `API_KEY_PEPPER_ID_LABEL`). It names the pepper without revealing it: a
 * 64-bit tag under a 256-bit key, so `api-keys:pepper-status` can count the keys left under an earlier
 * pepper without a token.
 * @throws {RangeError} when the pepper is shorter than 32 bytes.
 */
export function apiKeyPepperId(pepper: Uint8Array): string {
  assertPepper(pepper);
  return createHmac('sha256', pepper)
    .update(API_KEY_PEPPER_ID_LABEL, 'utf8')
    .digest('hex')
    .slice(0, PEPPER_ID_HEX_CHARS);
}

/**
 * C247.1: the hashes a token is looked up by, the current pepper's first, then each earlier pepper
 * in the order given (`OPENVERIFY_API_KEY_PEPPER_PREVIOUS`), leaving out one equal to a pepper
 * already listed.
 * @throws {RangeError} with more than `API_KEY_PREVIOUS_PEPPERS_MAX` earlier peppers, or a pepper
 * shorter than 32 bytes.
 */
export function apiKeyHashCandidates(
  token: string,
  current: Uint8Array,
  previous: readonly Uint8Array[],
): PepperedApiKeyHash[] {
  if (previous.length > API_KEY_PREVIOUS_PEPPERS_MAX) {
    throw new RangeError(
      `At most ${String(API_KEY_PREVIOUS_PEPPERS_MAX)} earlier API key peppers are kept`,
    );
  }
  const candidates: PepperedApiKeyHash[] = [];
  for (const [index, pepper] of [current, ...previous].entries()) {
    const pepperKeyId = apiKeyPepperId(pepper);
    if (candidates.some((candidate) => candidate.pepperKeyId === pepperKeyId)) {
      continue;
    }
    candidates.push({
      secretHash: hashApiKeySecret(token, pepper),
      pepperKeyId,
      current: index === 0,
    });
  }
  return candidates;
}

/** A key found by one of its candidate hashes, with the candidate that found it. */
export interface PepperedApiKeyMatch {
  readonly apiKey: ApiKey;
  readonly environment: Environment;
  readonly candidate: PepperedApiKeyHash;
}

/**
 * C247.1: the key whose `secret_hash` is one of `candidates`, in one query over the unique index,
 * with the candidate that matched. Revoked and expired keys are returned too, as the C12 lookup
 * returns them, so the caller can say why they are refused.
 */
export async function findApiKeyByPepperedHashes(
  db: Db,
  candidates: readonly PepperedApiKeyHash[],
): Promise<PepperedApiKeyMatch | null> {
  if (candidates.length === 0) {
    return null;
  }
  const [row] = await db
    .select({ apiKey: apiKeys, environment: environments })
    .from(apiKeys)
    .innerJoin(environments, eq(apiKeys.environmentId, environments.id))
    .where(
      inArray(
        apiKeys.secretHash,
        candidates.map(({ secretHash }) => secretHash),
      ),
    )
    .limit(1);
  const candidate =
    row === undefined
      ? undefined
      : candidates.find(({ secretHash }) => secretHash === row.apiKey.secretHash);
  return row === undefined || candidate === undefined ? null : { ...row, candidate };
}

/**
 * C247.1: moves a key's stored hash to the current pepper (or names the pepper of a key from
 * before 11B) by a compare-and-set on `(secret_hash, pepper_key_id)`: of two requests that found
 * the key under the same earlier pepper, one moves it and the other answers `false`. The display
 * prefixes are untouched (C247.2).
 */
export async function moveApiKeyToPepper(
  db: Db,
  input: {
    readonly id: string;
    readonly from: { readonly secretHash: string; readonly pepperKeyId: string | null };
    readonly to: PepperedApiKeyHash;
  },
): Promise<boolean> {
  const rows = await db
    .update(apiKeys)
    .set({ secretHash: input.to.secretHash, pepperKeyId: input.to.pepperKeyId })
    .where(
      and(
        eq(apiKeys.id, input.id),
        eq(apiKeys.secretHash, input.from.secretHash),
        input.from.pepperKeyId === null
          ? isNull(apiKeys.pepperKeyId)
          : eq(apiKeys.pepperKeyId, input.from.pepperKeyId),
      ),
    )
    .returning({ id: apiKeys.id });
  return rows.length > 0;
}

/** How many keys each pepper id holds; `null` for keys no lookup has proved since 11B. */
export interface ApiKeyPepperCount {
  readonly pepperKeyId: string | null;
  readonly count: number;
}

/**
 * C247.1 (`api-keys:pepper-status`): the keys per pepper id across every environment, revoked and
 * expired ones included (a key that still authenticates nothing still holds its hash), in pepper id
 * order with the unproved (`null`) last. Never a hash.
 */
export async function countApiKeysByPepper(db: Db): Promise<ApiKeyPepperCount[]> {
  const rows = await db
    .select({ pepperKeyId: apiKeys.pepperKeyId, count: count() })
    .from(apiKeys)
    .groupBy(apiKeys.pepperKeyId)
    .orderBy(sql`${apiKeys.pepperKeyId} asc nulls last`);
  return rows.map((row) => ({ pepperKeyId: row.pepperKeyId, count: row.count }));
}

/** Creates a new token (prefix + 256 random bits, base64url) and its stored hash. */
export function generateApiKey(kind: EnvironmentKind, pepper: Uint8Array): GeneratedApiKey {
  const prefix = API_KEY_PREFIXES[kind];
  const token = `${prefix}${randomBytes(SECRET_BYTES).toString('base64url')}`;
  return {
    token,
    prefix,
    tokenPrefix: token.slice(0, prefix.length + API_KEY_TOKEN_PREFIX_SECRET_CHARS),
    secretHash: hashApiKeySecret(token, pepper),
    pepperKeyId: apiKeyPepperId(pepper),
  };
}
