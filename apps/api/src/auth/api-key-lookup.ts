import {
  apiKeyHashCandidates,
  findApiKeyByPepperedHashes,
  moveApiKeyToPepper,
  touchApiKeyLastUsed,
  type Db,
} from '@openverify/db';
import type { ApiKeyLookup, AuthenticatedApiKey } from '../plugins/principal-auth.js';
import { systemClock, type Clock } from '../ports.js';

export interface DbApiKeyAuthenticatorOptions {
  db: Db;
  /** `OPENVERIFY_API_KEY_PEPPER`: the HMAC key of `api_keys.secret_hash`, at least 32 bytes. */
  pepper: Uint8Array;
  /**
   * C247.1 (Workflow 11B, auth-sessions): `OPENVERIFY_API_KEY_PEPPER_PREVIOUS`, at most two earlier
   * peppers tried after the current one; none by default.
   */
  previousPeppers?: readonly Uint8Array[];
  clock?: Clock;
  /** Write `last_used_at` at most this often per key. Defaults to 60 s. */
  touchIntervalMs?: number;
}

export interface DbApiKeyAuthenticator {
  /** The `lookupApiKey` of `buildApp`: finds a key by the peppered hash of the token. */
  lookup: ApiKeyLookup;
  /** The `onAuthenticated` of `buildApp`: records that the key was just used. */
  touch: (key: AuthenticatedApiKey) => Promise<void>;
}

const DEFAULT_TOUCH_INTERVAL_MS = 60_000;

/**
 * API key authentication backed by `api_keys`. The token is never stored or compared in
 * plaintext: it is hashed with the server pepper (HMAC-SHA256) and looked up by that hash, and,
 * after a pepper rotation (C247.1), by its hash under each earlier pepper too: a key found under an
 * earlier pepper is re-hashed under the current one in the same request, so the rotation completes
 * as keys are used (`api-keys:pepper-status` counts the rest).
 * Revoked and expired keys are returned too; the auth plugin refuses them with a reason. The
 * key's organization and environment kind come from its environment row (C12 principals).
 */
export function createDbApiKeyAuthenticator(
  options: DbApiKeyAuthenticatorOptions,
): DbApiKeyAuthenticator {
  const { db, pepper } = options;
  const previousPeppers = options.previousPeppers ?? [];
  const clock = options.clock ?? systemClock;
  const minIntervalMs = options.touchIntervalMs ?? DEFAULT_TOUCH_INTERVAL_MS;
  return {
    async lookup(token) {
      // C247.1: one query over the current pepper's hash and each earlier pepper's.
      const candidates = apiKeyHashCandidates(token, pepper, previousPeppers);
      const found = await findApiKeyByPepperedHashes(db, candidates);
      if (found === null) {
        return null;
      }
      const { apiKey, environment, candidate } = found;
      const [current] = candidates;
      if (current !== undefined && apiKey.pepperKeyId !== current.pepperKeyId) {
        // Found under an earlier pepper (re-hashed now), or a key from before 11B under the
        // current one (named now). A compare-and-set: when another request moved it first this
        // one changes nothing, and the key is the same key either way.
        await moveApiKeyToPepper(db, {
          id: apiKey.id,
          from: { secretHash: candidate.secretHash, pepperKeyId: apiKey.pepperKeyId },
          to: current,
        });
      }
      return {
        id: apiKey.id,
        organizationId: environment.organizationId,
        environmentId: apiKey.environmentId,
        environmentKind: environment.kind,
        scopes: [...apiKey.scopes],
        expiresAt: apiKey.expiresAt,
        revokedAt: apiKey.revokedAt,
        allowedIps: apiKey.allowedIps === null ? null : [...apiKey.allowedIps],
        piiMasked: apiKey.piiMasked,
        // C169.3 (Workflow 9B Stage 1b (W)): only a key that has one.
        ...(apiKey.attributeBlocklist.length > 0
          ? { attributeBlocklist: [...apiKey.attributeBlocklist] }
          : {}),
      };
    },
    async touch(key) {
      await touchApiKeyLastUsed(db, key.environmentId, key.id, { at: clock.now(), minIntervalMs });
    },
  };
}
