/**
 * C234.5, C234.6, C234.11, C235.1 (Workflow 11A, `api-redeem`): hydrate, the vendor's field copy into
 * an account, an inquiry or a transaction of the destination environment, inside the redeem job's one
 * transaction. Fields only: no verification and no report.
 *
 * - **What is written** is `connect-logic`'s `resolveHydrateMappings` over the policy's allowlist and
 *   the source's shared fields: `field-mappings` first, then a name match; a name match the
 *   destination does not declare, or of another type, is dropped and listed (keys only); a mapping
 *   that names an undeclared, twice-mapped, other-typed or filled write-once destination fails the
 *   redemption (`import_failed`).
 * - **How it is written** is the destination's own write path, so its rules apply: an inquiry
 *   through `updateInquiryInTx` (Phase 9's field rules, write-once, `strip-html`, the size limits);
 *   an account through `updateAccountInTx` (its type's fields, the graph index); a transaction
 *   through `updateTransactionInTx` (its published type version's validator, the card guard, the
 *   searchable keys under the destination's blind-index subkey, the sealed fields and its events).
 *   A value the destination's validator refuses fails the redemption (`import_failed`, ours: the
 *   job never writes half of a share).
 * - **Provenance** (C235.1): every hydrated object gets one `hydrated_fields` entry
 *   `{share-token-id, fields, hydrated-at}` (keys only); an inquiry also its `provenance`
 *   (`connect-hydrate`), unless it already carries one.
 */
import {
  hydrateProvenance,
  resolveHydrateMappings,
  type HydrateDestinationField,
  type HydrateFieldMapping,
  type HydrateMappingFailure,
  type HydrateWrite,
  type ShareFieldEntry,
  type ShareFieldType,
} from '@openverify/core';
import {
  accounts,
  getAccount,
  getAccountType,
  getInquiry,
  getInquiryTemplateVersion,
  getTransaction,
  getTransactionTypeVersion,
  inquiries,
  transactions,
  type Db,
} from '@openverify/db';
import { and, eq, sql } from 'drizzle-orm';
import type { StagedEvent } from '../../events/index.js';
import { accountChangeIn, updateAccountInTx } from '../accounts.js';
import type { ApiDependencies } from '../context.js';
import { updateInquiryInTx, type Acting } from '../inquiries.js';
import { transactionChangeIn } from '../transactions/shared.js';
import { updateTransactionInTx } from '../transactions/transactions.js';

/** A destination of a hydrate (C234.5, C234.6). */
export interface HydrateTarget {
  type: 'inquiry' | 'account' | 'transaction';
  id: string;
}

/** What the share carries: the source's allowlisted fields, and the redemption's mappings. */
export interface HydrateRequest {
  /** The policy's field allowlist for the source's type. */
  allowlist: readonly string[];
  /** The source's shared fields (`shareableContent`'s `object.fields`). */
  fields: readonly ShareFieldEntry[];
  mappings: readonly HydrateFieldMapping[];
}

/** What a hydrate writes with. */
export interface HydrateContext {
  tx: Db;
  deps: ApiDependencies;
  /** The principal that asked for the redemption, in the destination environment. */
  acting: Acting;
  /** Events the destination's write paths staged, for the caller to dispatch after the commit. */
  staged: StagedEvent[];
  shareTokenId: string;
  sourceOrganizationName: string;
  now: Date;
}

/** C234.8: what a hydrate wrote (keys only). */
export interface HydrateOutcome {
  written: string[];
  dropped: string[];
}

/** C234.2, C234.5: a hydrate that cannot be written ends the redemption `import_failed`. */
export class HydrateImportFailedError extends Error {
  readonly failures: readonly HydrateMappingFailure[];

  constructor(message: string, failures: readonly HydrateMappingFailure[] = []) {
    super(message);
    this.name = 'HydrateImportFailedError';
    this.failures = failures;
  }
}

/** The destination's declared fields, and its current values. */
interface Destination {
  declared: HydrateDestinationField[];
}

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** `{key, type, write-once}` of a version's field schemas (template or transaction type). */
function declaredOf(
  schemas: readonly unknown[],
  values: Readonly<Record<string, unknown>>,
): HydrateDestinationField[] {
  return schemas.flatMap((schema) => {
    if (typeof schema !== 'object' || schema === null) {
      return [];
    }
    const { key, type } = schema as { key?: unknown; type?: unknown };
    if (typeof key !== 'string' || typeof type !== 'string') {
      return [];
    }
    return [
      {
        name: key,
        type: type as ShareFieldType,
        writeOnce: (schema as Record<string, unknown>)['write-once'] === true,
        filled: values[key] !== undefined && values[key] !== null,
      },
    ];
  });
}

async function destinationOf(
  tx: Db,
  environmentId: string,
  target: HydrateTarget,
): Promise<Destination> {
  switch (target.type) {
    case 'inquiry': {
      const inquiry = await getInquiry(tx, environmentId, target.id);
      if (inquiry === null) {
        throw new HydrateImportFailedError('the destination inquiry is gone');
      }
      const version = await getInquiryTemplateVersion(
        tx,
        environmentId,
        inquiry.inquiryTemplateVersionId,
      );
      return {
        declared: declaredOf(asList(version?.fieldSchemas), inquiry.fields),
      };
    }
    case 'account': {
      const account = await getAccount(tx, environmentId, target.id);
      if (account === null) {
        throw new HydrateImportFailedError('the destination account is gone');
      }
      const type = await getAccountType(tx, environmentId, account.accountTypeId);
      const values = account.fields as Record<string, unknown>;
      return {
        declared: Object.entries(type?.fieldsSchema ?? {}).map(([name, schema]) => ({
          name,
          type: (schema as { type: string }).type as ShareFieldType,
          writeOnce: false,
          filled: values[name] !== undefined && values[name] !== null,
        })),
      };
    }
    case 'transaction': {
      const transaction = await getTransaction(tx, environmentId, target.id);
      if (transaction === null) {
        throw new HydrateImportFailedError('the destination transaction is gone');
      }
      const version = await getTransactionTypeVersion(
        tx,
        environmentId,
        transaction.transactionTypeVersionId,
      );
      return { declared: declaredOf(asList(version?.fieldSchemas), transaction.fields ?? {}) };
    }
  }
}

/** `{a: {b: value}}` from the dotted name `a.b` (C234.1: dots name a nested destination). */
function valuesOf(writes: readonly HydrateWrite[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const write of writes) {
    const path = write.destinationName.split('.');
    let node = values;
    for (const part of path.slice(0, -1)) {
      const next = node[part];
      node[part] = typeof next === 'object' && next !== null ? next : {};
      node = node[part] as Record<string, unknown>;
    }
    node[path[path.length - 1] ?? write.destinationName] = write.value;
  }
  return values;
}

/** Runs a destination write, turning a refusal of its validator into `import_failed`. */
async function refusedAsImportFailed<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof Error && 'status' in error && (error as { status: number }).status < 500) {
      throw new HydrateImportFailedError('the destination refused a hydrated value');
    }
    throw error;
  }
}

/**
 * C234.5: hydrates `target` from the share. Throws {@link HydrateImportFailedError} for a failure the
 * redemption ends `import_failed` with; writes nothing beyond what the destination's own path writes.
 */
export async function hydrateInTx(
  context: HydrateContext,
  target: HydrateTarget,
  request: HydrateRequest,
): Promise<HydrateOutcome> {
  const { tx, acting } = context;
  const { environmentId } = acting.ctx;
  const destination = await destinationOf(tx, environmentId, target);
  const resolution = resolveHydrateMappings({
    allowlist: request.allowlist,
    source: request.fields.map(({ key, type, value }) => ({ key, type, value })),
    destination: destination.declared,
    mappings: request.mappings,
  });
  if (resolution.failures.length > 0) {
    throw new HydrateImportFailedError('a field mapping cannot be written', resolution.failures);
  }
  const written = resolution.writes.map(({ destinationName }) => destinationName);
  if (written.length > 0) {
    const fields = valuesOf(resolution.writes);
    await refusedAsImportFailed(() => writeFields(context, target, fields));
  }
  await markHydrated(context, target, written);
  return { written, dropped: [...resolution.dropped] };
}

async function writeFields(
  context: HydrateContext,
  target: HydrateTarget,
  fields: Record<string, unknown>,
): Promise<void> {
  const { tx, deps, acting, staged } = context;
  switch (target.type) {
    case 'inquiry':
      await updateInquiryInTx(tx, deps, acting, target.id, {
        fields: fields as never,
      });
      return;
    case 'account':
      await updateAccountInTx(
        accountChangeIn(tx, deps, acting.ctx, acting.actor, staged),
        target.id,
        { fields: fields as never },
      );
      return;
    case 'transaction':
      await updateTransactionInTx(
        deps,
        transactionChangeIn(tx, deps, acting, staged),
        acting,
        target.id,
        { fields: fields },
      );
      return;
  }
}

/** C235.1: the object's `hydrated_fields` entry (keys only), and an inquiry's provenance. */
async function markHydrated(
  context: HydrateContext,
  target: HydrateTarget,
  written: readonly string[],
): Promise<void> {
  const { tx, acting, now } = context;
  const { environmentId } = acting.ctx;
  const provenance = hydrateProvenance({
    shareTokenId: context.shareTokenId,
    sourceOrganizationName: context.sourceOrganizationName,
    hydratedAt: now,
    fields: written,
  });
  const entry = JSON.stringify([
    {
      'share-token-id': context.shareTokenId,
      fields: provenance.fields,
      'hydrated-at': now.toISOString(),
    },
  ]);
  const append = (column: unknown) => sql`coalesce(${column}, '[]'::jsonb) || ${entry}::jsonb`;
  switch (target.type) {
    case 'inquiry':
      await tx
        .update(inquiries)
        .set({
          hydratedFields: append(inquiries.hydratedFields),
          provenance: sql`coalesce(${inquiries.provenance}, ${JSON.stringify(provenance)}::jsonb)`,
        })
        .where(and(eq(inquiries.environmentId, environmentId), eq(inquiries.id, target.id)));
      return;
    case 'account':
      await tx
        .update(accounts)
        .set({ hydratedFields: append(accounts.hydratedFields) })
        .where(and(eq(accounts.environmentId, environmentId), eq(accounts.id, target.id)));
      return;
    case 'transaction':
      await tx
        .update(transactions)
        .set({ hydratedFields: append(transactions.hydratedFields) })
        .where(and(eq(transactions.environmentId, environmentId), eq(transactions.id, target.id)));
      return;
  }
}
