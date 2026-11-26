/**
 * C169.1 (decision 50; ours; Workflow 9B): `POST /api-keys/:id/rotate` clones the key (scopes, IPs,
 * version, blocklist and note) through `cloneApiKey`'s own checks (the caller holds every scope it
 * copies, and `pii-masked` is forced when the caller cannot see PII), expires the old one after
 * `meta.previous-expires-in-seconds` in the same transaction, answers the new token once and writes one
 * audit entry linking both keys.
 *
 * - The old key's row is locked first, so two rotations of one key run one after the other, and a
 *   refusal (a scope the caller lacks, a restricted template it cannot see) changes nothing.
 * - The old key stops working at the earliest of its own end, its revocation and now plus the chosen
 *   seconds: a rotation never extends a key (as `expire`). `meta.previous-expires-at` is that time.
 * - The one audit entry is `api-key.rotated` on the new key, naming the old one and its end; the token
 *   is in neither.
 *
 * Owner: `api-keys-webhooks`.
 */
import type { RotateApiKeyBody, RotatedApiKeyDocument } from '@openverify/contracts';
import { isApiScope } from '@openverify/core';
import { apiKeys, expireApiKey as setApiKeyExpiry } from '@openverify/db';
import { and, eq } from 'drizzle-orm';
import { actorOf, type Principal, type ServiceContext } from '../../ports.js';
import {
  apiKeyAgeOf,
  apiKeyResource,
  earliest,
  ensureCanGrant,
  insertKeyCopyInTx,
  notFound,
  type ApiKeyTokenIssuer,
} from '../api-keys.js';
import { auditEntryOf, type ApiDependencies } from '../context.js';

export type RotateApiKey = (
  deps: ApiDependencies,
  ctx: ServiceContext,
  principal: Principal,
  id: string,
  meta: RotateApiKeyBody['meta'],
  issue: ApiKeyTokenIssuer,
) => Promise<RotatedApiKeyDocument>;

/**
 * @throws {NotFoundError} 404 when the key is not in the principal's environment.
 * @throws {PermissionDeniedError} 403 when the caller does not hold every scope the key has.
 */
export const rotateApiKey: RotateApiKey = async (deps, ctx, principal, id, meta, issue) => {
  const { environmentId } = principal;
  const requested = new Date(
    deps.clock.now().getTime() + meta['previous-expires-in-seconds'] * 1000,
  );
  const generated = issue(principal.environmentKind);
  const { key, previousEnd } = await deps.db.transaction(async (tx) => {
    const [source] = await tx
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.environmentId, environmentId)))
      .for('update');
    if (source === undefined) {
      throw notFound(id);
    }
    ensureCanGrant(principal, source.scopes.filter(isApiScope));
    const created = await insertKeyCopyInTx(deps, tx, principal, source, {
      name: meta.name ?? source.name,
      generated,
    });
    const end = earliest(earliest(source.expiresAt, source.revokedAt), requested) ?? requested;
    await setApiKeyExpiry(tx, environmentId, source.id, end);
    await deps.audit.record(
      tx,
      auditEntryOf(ctx, actorOf(principal), {
        action: 'api-key.rotated',
        resourceType: 'api-key',
        resourceId: created.id,
        metadata: { 'previous-api-key-id': source.id, 'previous-expires-at': end.toISOString() },
      }),
    );
    return { key: created, previousEnd: end };
  });
  return {
    data: apiKeyResource(key, await apiKeyAgeOf(deps, environmentId)),
    meta: {
      token: generated.token,
      'previous-key-id': id,
      'previous-expires-at': previousEnd.toISOString(),
    },
  };
};
