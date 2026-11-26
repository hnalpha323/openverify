/**
 * C244.1 (Workflow 11A, `api-connect`): `seed:dev --connect`, the sample partner of a development
 * install. A second organisation, "Example Partner", with a sandbox and a production environment,
 * its built-in roles and one operator per built-in role (the dev operators' emails with `+partner`,
 * hashed from the same passwords, never printed), opted in to inbound connections, and a `pending`
 * connection from the dev organisation to it with a sample share policy (version 1). Its environments'
 * display name says it is a sample ("Example Partner (sample)"). It prints ids and emails only:
 * nothing secret beyond what `seed:dev` already prints once. A second run reuses all of it.
 * Self-connections are made by the e2e only.
 */
import type { SharePolicy } from '@openverify/contracts';
import type { BuiltinRoleKey } from '@openverify/core';
import {
  connectConnections,
  createConnection,
  createEnvironment,
  createOrganization,
  createUser,
  findEnvironmentByKind,
  listUserRoles,
  listUsersByEmail,
  setOrganizationConnectInbound,
  setUserRoles,
  updateEnvironmentSettings,
  type Db,
} from '@openverify/db';
import { and, eq } from 'drizzle-orm';
import type { PasswordHasher } from '../operator-auth/index.js';
import { systemClock, ulidIdGenerator, type Clock, type IdGenerator } from '../ports.js';
import { syncOrganizationRoles } from '../services/roles.js';

/** C244.1: the partner organisation's name. */
export const SAMPLE_PARTNER_NAME = 'Example Partner';
/** C244.4: how the partner's environments name it to a person: a sample. */
export const SAMPLE_PARTNER_DISPLAY_NAME = 'Example Partner (sample)';

/** C244.1: the sample policy of the seeded connection (version 1). */
export const SAMPLE_SHARE_POLICY: SharePolicy = Object.freeze({
  purpose: 'share.reuse-kyc',
  'source-types': ['inquiry', 'account'],
  verifications: {
    types: ['government-id', 'selfie'],
    'extracted-data': true,
    'check-results': true,
    files: false,
  },
  fields: { inquiry: [], account: [], transaction: [] },
  biometric: true,
  peek: { 'inquiry.status': 'full' },
  'attested-consent': 'non-biometric',
}) as SharePolicy;

/** One operator of the dev organisation, whose credentials the partner's twin reuses. */
export interface ConnectSeedOperator {
  role: BuiltinRoleKey;
  email: string;
  password: string;
}

export interface ConnectSeedOptions {
  db: Db;
  /** The dev organisation, the connection's source. */
  sourceOrganizationId: string;
  /** The dev admin, the connection's creator. */
  creatorUserId: string;
  /** One per built-in role, the admin first. */
  operators: readonly ConnectSeedOperator[];
  hasher: Pick<PasswordHasher, 'hash'>;
  ids?: IdGenerator;
  clock?: Clock;
}

export interface ConnectSeedResult {
  /** False when the partner already existed and was reused. */
  created: boolean;
  organizationId: string;
  name: string;
  environments: { sandbox: string; production: string };
  users: { role: BuiltinRoleKey; id: string; email: string; created: boolean }[];
  connection: { id: string; status: string; created: boolean };
}

/** The partner's twin of a dev operator's email: `<local>+partner@<domain>`. */
export function partnerEmail(email: string): string {
  const at = email.lastIndexOf('@');
  return `${email.slice(0, at)}+partner${email.slice(at)}`;
}

/** Seeds (or reuses) the sample partner and its pending connection. */
export async function seedConnectPartner(options: ConnectSeedOptions): Promise<ConnectSeedResult> {
  const { db, hasher } = options;
  const ids = options.ids ?? ulidIdGenerator;
  const clock = options.clock ?? systemClock;
  const operators = options.operators.map((operator) => ({
    ...operator,
    email: partnerEmail(operator.email),
  }));
  const [admin] = operators;
  if (admin === undefined) {
    throw new RangeError('seed:dev --connect needs the dev operators');
  }
  const [existingAdmin] = await listUsersByEmail(db, admin.email);
  // Argon2id runs before the transaction, so no connection is held while it works.
  const hashes = new Map<string, string>();
  for (const operator of operators) {
    hashes.set(operator.email, await hasher.hash(operator.password));
  }
  return db.transaction(async (tx) => {
    const organizationId =
      existingAdmin?.organizationId ??
      (
        await createOrganization(tx, {
          id: ids.newId('org'),
          name: SAMPLE_PARTNER_NAME,
          requireMfa: false,
        })
      ).id;
    // C231.10: the partner receives connections; the seed is a development install's.
    await setOrganizationConnectInbound(tx, organizationId, true);
    const environment = async (kind: 'sandbox' | 'production') => {
      const found =
        (await findEnvironmentByKind(tx, organizationId, kind)) ??
        (await createEnvironment(tx, { id: ids.newId('env'), organizationId, kind }));
      // C244.4: a person is told the partner is a sample.
      await updateEnvironmentSettings(tx, found.id, {
        'organization-display-name': SAMPLE_PARTNER_DISPLAY_NAME,
      });
      return found.id;
    };
    const environments = {
      sandbox: await environment('sandbox'),
      production: await environment('production'),
    };
    const roleIds = new Map(
      (await syncOrganizationRoles(tx, organizationId, ids)).map((role) => [role.key, role.id]),
    );
    const users: ConnectSeedResult['users'] = [];
    for (const operator of operators) {
      const existing = (await listUsersByEmail(tx, operator.email)).find(
        (user) => user.organizationId === organizationId,
      );
      const user =
        existing ??
        (await createUser(tx, {
          id: ids.newId('usr'),
          organizationId,
          email: operator.email,
          passwordHash: hashes.get(operator.email) ?? '',
          name: `Example Partner ${operator.role}`,
        }));
      const roleId = roleIds.get(operator.role) ?? '';
      const held = (await listUserRoles(tx, organizationId, user.id)).map((role) => role.id);
      if (!held.includes(roleId)) {
        await setUserRoles(tx, organizationId, user.id, [...held, roleId]);
      }
      users.push({
        role: operator.role,
        id: user.id,
        email: user.email,
        created: existing === undefined,
      });
    }
    const [found] = await tx
      .select({ id: connectConnections.id, status: connectConnections.status })
      .from(connectConnections)
      .where(
        and(
          eq(connectConnections.sourceOrganizationId, options.sourceOrganizationId),
          eq(connectConnections.destinationOrganizationId, organizationId),
        ),
      )
      .limit(1);
    const connection =
      found === undefined
        ? {
            ...(
              await createConnection(tx, {
                id: ids.newId('cxn'),
                sourceOrganizationId: options.sourceOrganizationId,
                destinationOrganizationId: organizationId,
                creatorType: 'user',
                creatorId: options.creatorUserId,
                policyId: ids.newId('cxnp'),
                policy: { ...SAMPLE_SHARE_POLICY },
                createdAt: clock.now(),
              })
            ).connection,
            created: true,
          }
        : { ...found, created: false };
    return {
      created: existingAdmin === undefined,
      organizationId,
      name: SAMPLE_PARTNER_NAME,
      environments,
      users,
      connection: { id: connection.id, status: connection.status, created: connection.created },
    };
  });
}

/** The partner's lines for a terminal: ids and emails only. */
export function formatConnectSeedResult(result: ConnectSeedResult): string {
  return [
    '',
    `Connect sample partner (C244.1; a sample, not a real organisation): ${result.name} ${result.organizationId}${result.created ? '' : ' (reused)'}`,
    `  environments: sandbox ${result.environments.sandbox}, production ${result.environments.production}`,
    ...result.users.map(
      (user) => `  ${user.role}: ${user.email} ${user.id} (the dev ${user.role}'s password)`,
    ),
    `  connection from the dev organisation: ${result.connection.id} (${result.connection.status}${result.connection.created ? '' : ', reused'}); activate it in the partner's console`,
    '',
  ].join('\n');
}
