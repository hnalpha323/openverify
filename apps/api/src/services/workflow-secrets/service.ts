/**
 * C125 (Workflow 8A): the secrets routes' service.
 *
 * C125.2's rules live here, not in the route: a value route acts only on the caller's own environment
 * (another id answers 404), setting or rotating a production value needs a user session, and a change
 * of hosts or placements needs one too when any production value exists. A delete with a production
 * value follows the same rule (ours: it removes that value as surely as a new one replaces it). Every
 * write is audit-logged with the key's name, never the value, and nothing here answers a value: the
 * resource is metadata, and only the action opens one (C125.5).
 */
import {
  WORKFLOW_SECRET_LIMITS,
  buildWorkflowSecretResource,
  type CreateWorkflowSecretBody,
  type listWorkflowSecretsQuerySchema,
  type PutWorkflowSecretValueBody,
  type RotateWorkflowSecretValueBody,
  type UpdateWorkflowSecretBody,
  type WorkflowSecretDocument,
  type WorkflowSecretListDocument,
} from '@openverify/contracts';
import {
  createWorkflowSecret as createRow,
  deleteWorkflowSecret as deleteRow,
  findWorkflowSecretReference,
  getEnvironment,
  getWorkflowSecret as getRow,
  getWorkflowSecretValueMeta,
  listWorkflowSecretValueEnvironments,
  listWorkflowSecretValueMetas,
  listWorkflowSecrets as listRows,
  lockWorkflowSecret,
  pgErrorCode,
  putWorkflowSecretValue as putRow,
  rotateWorkflowSecretValue as rotateRow,
  updateWorkflowSecret as updateRow,
  type Db,
  type WorkflowSecret,
  type WorkflowSecretValueMeta,
} from '@openverify/db';
import { z } from 'zod';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableContentError,
  WorkflowProblemError,
} from '../../errors.js';
import type { WorkflowActing } from '../../workflows/acting.js';
import { normalizeHost } from '../../workflows/actions/https/hosts.js';
import type { ServiceContext } from '../../ports.js';
import { auditEntryOf, type ApiDependencies } from '../context.js';
import { nextLink, pageRequest, withCursor } from '../pagination.js';

const SECRETS_PATH = '/api/v1/workflow-secrets';
const UNIQUE_VIOLATION = '23505';
const HOUR_MS = 3_600_000;

const AUDIT_KEY = z.string().regex(/^[a-z][a-z0-9_]*$/);

/** C143.5 (P19): each action's metadata is strict and holds no free text. */
const SECRET_AUDIT_METADATA = {
  'workflow-secret.created': z.strictObject({ key: AUDIT_KEY }),
  'workflow-secret.updated': z.strictObject({
    key: AUDIT_KEY,
    changed: z.array(z.enum(['description', 'allowed-hosts', 'allowed-placements'])),
  }),
  'workflow-secret.deleted': z.strictObject({ key: AUDIT_KEY }),
  'workflow-secret.value-set': z.strictObject({ key: AUDIT_KEY, version: z.int().min(1) }),
  'workflow-secret.value-rotated': z.strictObject({ key: AUDIT_KEY, version: z.int().min(1) }),
} as const;
type SecretAuditAction = keyof typeof SECRET_AUDIT_METADATA;

async function audit<Action extends SecretAuditAction>(
  deps: ApiDependencies,
  tx: Db,
  ctx: ServiceContext,
  acting: WorkflowActing,
  action: Action,
  secret: WorkflowSecret,
  metadata: z.input<(typeof SECRET_AUDIT_METADATA)[Action]>,
): Promise<void> {
  await deps.audit.record(
    tx,
    auditEntryOf(ctx, acting.actor, {
      action,
      resourceType: 'workflow-secret',
      resourceId: secret.id,
      metadata: SECRET_AUDIT_METADATA[action].parse(metadata),
    }),
  );
}

const resourceOf = (secret: WorkflowSecret, value: WorkflowSecretValueMeta | null) =>
  buildWorkflowSecretResource({ ...secret, value });

function missing(): NotFoundError {
  return new NotFoundError('No workflow secret has this key.');
}

/** C125.2: a production value is a production user's. */
function requireProductionUser(acting: WorkflowActing): void {
  const { principal, environmentKind } = acting;
  const allowed =
    environmentKind === 'production' &&
    principal.kind === 'user' &&
    principal.permissions.has('environments:production');
  if (!allowed) {
    throw new ForbiddenError('This needs a user session in production.');
  }
}

/** Every environment holding a value of the secret, and whether one of them is production. */
async function holdersOf(tx: Db, secret: WorkflowSecret) {
  const holders = await listWorkflowSecretValueEnvironments(tx, secret.id);
  const environments = await Promise.all(
    holders.map(({ environmentId }) => getEnvironment(tx, environmentId)),
  );
  return {
    environmentIds: holders.map(({ environmentId }) => environmentId),
    production: environments.some((environment) => environment?.kind === 'production'),
  };
}

/** C124.3: hosts as every comparison reads them. The schema holds their shape. */
function normalisedHosts(hosts: readonly string[]): string[] {
  return hosts.map((host) => {
    const normal = normalizeHost(host);
    if (normal === null) {
      throw new UnprocessableContentError('Each allowed host must be a host name.', [
        {
          location: 'body',
          pointer: '/data/attributes/allowed-hosts',
          detail: 'This is no host name.',
        },
      ]);
    }
    return normal;
  });
}

export async function listWorkflowSecrets(
  deps: ApiDependencies,
  acting: WorkflowActing,
  query: z.infer<typeof listWorkflowSecretsQuerySchema>,
): Promise<WorkflowSecretListDocument> {
  const { organizationId, environmentId } = acting.ctx;
  const page = await withCursor(() => listRows(deps.db, organizationId, pageRequest(query)));
  const values = await listWorkflowSecretValueMetas(
    deps.db,
    environmentId,
    page.items.map(({ id }) => id),
  );
  const byId = new Map(values.map((value) => [value.secretId, value]));
  return {
    data: page.items.map((secret) => resourceOf(secret, byId.get(secret.id) ?? null)),
    links: { next: nextLink(SECRETS_PATH, {}, query, page.next) },
  };
}

export async function createWorkflowSecret(
  deps: ApiDependencies,
  acting: WorkflowActing,
  body: CreateWorkflowSecretBody,
): Promise<WorkflowSecretDocument> {
  const { attributes } = body.data;
  const { organizationId } = acting.ctx;
  const hosts = normalisedHosts(attributes['allowed-hosts']);
  try {
    const secret = await deps.db.transaction(async (tx) => {
      const created = await createRow(tx, organizationId, {
        id: deps.ids.newId('wsec'),
        key: attributes.key,
        description: attributes.description,
        allowedHosts: hosts,
        allowedPlacements: attributes['allowed-placements'],
        createdBy: acting.actor.id,
      });
      await audit(deps, tx, acting.ctx, acting, 'workflow-secret.created', created, {
        key: created.key,
      });
      return created;
    });
    return { data: resourceOf(secret, null) };
  } catch (error) {
    if (pgErrorCode(error) === UNIQUE_VIOLATION) {
      throw new ConflictError('The organization already has a workflow secret with this key.');
    }
    throw error;
  }
}

export async function getWorkflowSecret(
  deps: ApiDependencies,
  acting: WorkflowActing,
  key: string,
): Promise<WorkflowSecretDocument> {
  const { organizationId, environmentId } = acting.ctx;
  const secret = await getRow(deps.db, organizationId, key);
  // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
  if (secret === null) {
    throw missing();
  }
  const value = await getWorkflowSecretValueMeta(deps.db, environmentId, secret.id);
  return { data: resourceOf(secret, value) };
}

type SecretAttributes = UpdateWorkflowSecretBody['data']['attributes'];

const CHANGEABLE = ['description', 'allowed-hosts', 'allowed-placements'] as const;

function changesOf(attributes: SecretAttributes) {
  const hosts = attributes['allowed-hosts'];
  return {
    ...(attributes.description === undefined ? {} : { description: attributes.description }),
    ...(hosts === undefined ? {} : { allowedHosts: normalisedHosts(hosts) }),
    ...(attributes['allowed-placements'] === undefined
      ? {}
      : { allowedPlacements: attributes['allowed-placements'] }),
  };
}

export async function updateWorkflowSecret(
  deps: ApiDependencies,
  acting: WorkflowActing,
  key: string,
  body: UpdateWorkflowSecretBody,
): Promise<WorkflowSecretDocument> {
  const { attributes } = body.data;
  const { organizationId, environmentId } = acting.ctx;
  const changed = CHANGEABLE.filter((name) => attributes[name] !== undefined);
  const binds = changed.some((name) => name !== 'description');
  const changes = changesOf(attributes);
  const secret = await deps.db.transaction(async (tx) => {
    const held = await lockWorkflowSecret(tx, organizationId, key);
    if (held === null) {
      throw missing();
    }
    const holders = await holdersOf(tx, held);
    if (binds && holders.production) {
      requireProductionUser(acting);
    }
    const updated = await updateRow(tx, organizationId, held.id, changes);
    const reached = binds ? new Set([environmentId, ...holders.environmentIds]) : [environmentId];
    for (const reachedId of reached) {
      await audit(
        deps,
        tx,
        { ...acting.ctx, environmentId: reachedId },
        acting,
        'workflow-secret.updated',
        updated,
        { key, changed },
      );
    }
    return updated;
  });
  const value = await getWorkflowSecretValueMeta(deps.db, environmentId, secret.id);
  return { data: resourceOf(secret, value) };
}

/** Refused with `secret_in_use` while a published version references the key (C125.2). */
export async function deleteWorkflowSecret(
  deps: ApiDependencies,
  acting: WorkflowActing,
  key: string,
): Promise<WorkflowSecretDocument> {
  const { organizationId, environmentId } = acting.ctx;
  return deps.db.transaction(async (tx) => {
    const secret = await lockWorkflowSecret(tx, organizationId, key);
    // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
    if (secret === null) {
      throw missing();
    }
    if ((await holdersOf(tx, secret)).production) {
      requireProductionUser(acting);
    }
    if (await findWorkflowSecretReference(tx, organizationId, key)) {
      throw new WorkflowProblemError(
        'secret_in_use',
        'A published workflow version references this secret.',
      );
    }
    const value = await getWorkflowSecretValueMeta(tx, environmentId, secret.id);
    await deleteRow(tx, organizationId, secret.id);
    await audit(deps, tx, acting.ctx, acting, 'workflow-secret.deleted', secret, { key });
    return { data: resourceOf(secret, value) };
  });
}

/** C125.2: the caller's own environment, and in production a user's session. */
function checkValueRoute(acting: WorkflowActing, environmentId: string): void {
  if (environmentId !== acting.ctx.environmentId) {
    throw missing();
  }
  if (acting.environmentKind === 'production') {
    requireProductionUser(acting);
  }
}

export async function putWorkflowSecretValue(
  deps: ApiDependencies,
  acting: WorkflowActing,
  key: string,
  environmentId: string,
  body: PutWorkflowSecretValueBody,
): Promise<WorkflowSecretDocument> {
  checkValueRoute(acting, environmentId);
  const { organizationId } = acting.ctx;
  return deps.db.transaction(async (tx) => {
    const secret = await lockWorkflowSecret(tx, organizationId, key);
    // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
    if (secret === null) {
      throw missing();
    }
    const value = await putRow(tx, {
      id: deps.ids.newId('wsecv'),
      organizationId,
      secretId: secret.id,
      environmentId,
      value: body.data.attributes['secret-value'],
      actorId: acting.actor.id,
    });
    await audit(deps, tx, acting.ctx, acting, 'workflow-secret.value-set', secret, {
      key,
      version: value.version,
    });
    return { data: resourceOf(secret, value) };
  });
}

export async function rotateWorkflowSecretValue(
  deps: ApiDependencies,
  acting: WorkflowActing,
  key: string,
  environmentId: string,
  body: RotateWorkflowSecretValueBody,
): Promise<WorkflowSecretDocument> {
  checkValueRoute(acting, environmentId);
  const { organizationId } = acting.ctx;
  const rotatedAt = deps.clock.now();
  return deps.db.transaction(async (tx) => {
    const secret = await lockWorkflowSecret(tx, organizationId, key);
    if (
      secret === null ||
      (await getWorkflowSecretValueMeta(tx, environmentId, secret.id)) === null
    ) {
      throw missing();
    }
    const value = await rotateRow(tx, {
      id: deps.ids.newId('wsecv'),
      organizationId,
      secretId: secret.id,
      environmentId,
      value: body.data.attributes['secret-value'],
      actorId: acting.actor.id,
      rotatedAt,
      previousExpiresAt: new Date(
        rotatedAt.getTime() + WORKFLOW_SECRET_LIMITS['previous-value-hours'] * HOUR_MS,
      ),
    });
    await audit(deps, tx, acting.ctx, acting, 'workflow-secret.value-rotated', secret, {
      key,
      version: value.version,
    });
    return { data: resourceOf(secret, value) };
  });
}
