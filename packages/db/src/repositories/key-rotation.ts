/**
 * C16 KEK rotation (`pnpm --filter @openverify/api kek:rewrap` builds on this): every
 * stored DEK is re-wrapped under the keyring's current KEK. Payloads are never decrypted
 * (`rewrap` keeps them byte for byte), so the row-bound AAD contexts need no row ids.
 *
 * Tables are scanned by primary key in batches, so a run can stop and resume from the last
 * `(table, after)` it reported. Writes are conditional on the ciphertext being unchanged,
 * so a concurrent write (already under the current KEK) wins. Each batch runs with
 * `openverify.kek_rewrap` set locally: `updated_at` stays as it was (retention counts from
 * it) and the append-only audit log accepts the rewrite of its encrypted columns only.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../client.js';
import { needsRewrap, rewrap, rewrapDek, type Keyring } from '../crypto.js';
import { ENCRYPTED_COLUMNS } from '../encrypted-columns.js';

/** Every table with an encrypted column, in the order `rewrapAll` visits them. */
export const REWRAP_TABLES = [
  'accounts',
  // Workflow 11B Stage 1b (D) (C253.2): an access export's manifest key (after `accounts`, which
  // `kek:rewrap`'s resume test and its operators expect first).
  'account_exports',
  'api_logs',
  'audit_logs',
  'business_registry_records',
  'case_attachments',
  'case_bulk_actions',
  'case_comments',
  'case_exports',
  'cases',
  'chip_challenges',
  'chip_reads',
  // Workflow 11A Stage 1b (C) (C230.5): a connection's agreement reference.
  'connect_connections',
  // Workflow 11A Stage 1b (K) (C230.5): a consent record's evidence, and the flow texts.
  'consent_records',
  'consent_texts',
  'crypto_challenges',
  'document_extractions',
  'events',
  // Workflow 9B Stage 1b (X) (C166.1, C174.5): an export's request and file.
  'exports',
  'face_templates',
  'files',
  'government_id_extractions',
  'graph_queries',
  'idempotency_keys',
  'importers',
  'inquiries',
  'inquiry_decisions',
  // Workflow 10B Stage 1b (I) (C211.3, C211.4, C221.3): the token until its decode, and the verdict.
  'inquiry_integrity_challenges',
  'inquiry_integrity_verdicts',
  'inquiry_session_signals',
  'inquiry_sessions',
  'list_import_rows',
  'list_item_backgrounds',
  'list_item_faces',
  'list_items',
  'list_matches',
  'mfa_factors',
  'networks',
  'otp_challenges',
  'report_actions',
  // Workflow 9B Stage 1b (X) (C166.5, C174.5): a bulk job's uploaded CSV.
  'report_bulk_jobs',
  'report_matches',
  'rendition_pages',
  'reports',
  'scheduled_runs',
  'selfie_captures',
  // Workflow 9A Stage 1b (T) (C156.4, C174.5): a user's simulation preset scope.
  'simulation_presets',
  // Workflow 11B Stage 1b (A) (C248.3, C248.4): a provider's client secret; a login state's nonce and
  // PKCE verifier.
  'sso_login_states',
  'sso_providers',
  // Workflow 9A Stage 1b (H) (C160.6, C174.5): a theme asset's envelope.
  'theme_assets',
  'transaction_files',
  'transactions',
  'verification_inputs',
  'webhooks',
  'workflow_run_files',
  'workflow_run_steps',
  'workflow_runs',
  'workflow_secret_values',
  'workflow_step_effects',
] as const;

export type RewrapTable = (typeof REWRAP_TABLES)[number];

type ColumnKind = 'envelope' | 'wrapped_dek' | 'consent';

interface TableSpec {
  /** The primary key: `id`, except where a table is keyed by its parent's id. */
  idColumn: string;
  /**
   * A composite key as one text value, where no single column is the key: `consent_texts` is keyed by
   * `(environment_id, sha256)`, its value sealed for `<environment id>:<sha256>` (Workflow 11A (K)).
   */
  idExpression?: string;
  /** Identity keys (`bigint`) compare numerically; C1 ids as text. */
  idType: 'text' | 'bigint';
  columns: { name: string; kind: ColumnKind }[];
}

const BIGINT_IDS = new Set<string>([
  'audit_logs',
  'idempotency_keys',
  'inquiry_session_signals',
  'list_import_rows',
]);

/**
 * Tables whose primary key is not `id`: one row per verification (C31.7, C53.2, C53.3). Their sealed
 * values are bound to that id.
 */
const ID_COLUMNS: Readonly<Record<string, string>> = {
  government_id_extractions: 'verification_id',
  verification_inputs: 'verification_id',
  // Phase 5, Workflow 5B (C53.3, C53.4).
  document_extractions: 'verification_id',
  chip_reads: 'verification_id',
  business_registry_records: 'verification_id',
  // Workflow 7B (C98.1): one row per list item.
  list_item_faces: 'item_id',
  list_item_backgrounds: 'item_id',
  // Workflow 10B Stage 1b (I) (C211.4): one verdict per inquiry.
  inquiry_integrity_verdicts: 'inquiry_id',
  // Workflow 11B Stage 1b (A) (amendment 11): keyed by the binding cookie's digest.
  sso_login_states: 'binding_sha256',
};

/** Tables keyed by more than one column, scanned by their key as one text value. */
const ID_EXPRESSIONS: Readonly<Record<string, string>> = {
  consent_texts: "environment_id || ':' || sha256",
};

const SPECS = new Map<string, TableSpec>(
  REWRAP_TABLES.map((table) => [
    table,
    {
      idColumn: ID_COLUMNS[table] ?? 'id',
      ...(ID_EXPRESSIONS[table] === undefined ? {} : { idExpression: ID_EXPRESSIONS[table] }),
      idType: BIGINT_IDS.has(table) ? 'bigint' : 'text',
      columns: ENCRYPTED_COLUMNS.filter((entry) => entry.table === table).map((entry) => ({
        name: entry.column,
        kind:
          entry.aad === 'file'
            ? ('wrapped_dek' as const)
            : entry.column === 'consent'
              ? ('consent' as const)
              : ('envelope' as const),
      })),
    },
  ]),
);

export interface RewrapBatchOptions {
  /** The keyring with the new KEK as current and the old ones as previous. */
  keyring: Keyring;
  /** The last id of the previous batch of this table (`next`). */
  after?: string | null;
  /** Rows per batch; defaults to 500. */
  limit?: number;
  /** Count what would change without writing. */
  dryRun?: boolean;
}

export interface RewrapBatchResult {
  table: RewrapTable;
  scanned: number;
  /** Values re-wrapped (or, in a dry run, that would be). */
  rewrapped: number;
  /** Pass as `after` to continue this table; `null` once it is done. */
  next: string | null;
}

export interface RewrapAllOptions {
  keyring: Keyring;
  /** Rows per batch; defaults to 500. */
  batchSize?: number;
  dryRun?: boolean;
  /** Resume from a reported position: start at `table`, after `after`. */
  resume?: { table: RewrapTable; after: string | null };
  /** Called after every batch, e.g. to persist the position. */
  onBatch?: (batch: RewrapBatchResult) => void | Promise<void>;
}

export interface RewrapSummary {
  scanned: number;
  rewrapped: number;
}

const rowsOf = <T>(result: unknown): T[] => (result as { rows: T[] }).rows;

/** The value under the current KEK, or `null` when it already is (or is not a value). */
function rewrapped(kind: ColumnKind, value: string | null, keyring: Keyring): string | null {
  if (value === null) {
    return null;
  }
  if (kind === 'envelope') {
    return needsRewrap(value, keyring) ? rewrap(value, keyring) : null;
  }
  if (kind === 'wrapped_dek') {
    const keyId = value.split('.')[1];
    return keyId === keyring.currentKeyId ? null : rewrapDek(value, keyring);
  }
  // The consent jsonb: only its `ip` and `user_agent` members are envelopes.
  const consent = JSON.parse(value) as Record<string, unknown>;
  let changed = false;
  for (const member of ['ip', 'user_agent']) {
    const envelope = consent[member];
    if (typeof envelope === 'string' && needsRewrap(envelope, keyring)) {
      consent[member] = rewrap(envelope, keyring);
      changed = true;
    }
  }
  return changed ? JSON.stringify(consent) : null;
}

/** Re-wraps one batch of one table. */
export async function rewrapTableBatch(
  db: Db,
  table: RewrapTable,
  options: RewrapBatchOptions,
): Promise<RewrapBatchResult> {
  const spec = SPECS.get(table);
  if (spec === undefined) {
    throw new Error(`rewrapTableBatch: ${table} is not an encrypted table`);
  }
  const limit = options.limit ?? 500;
  const id =
    spec.idExpression === undefined
      ? sql.identifier(spec.idColumn)
      : sql.raw(`(${spec.idExpression})`);
  const typedId = (value: string): SQL =>
    spec.idType === 'bigint' ? sql`${value}::bigint` : sql`${value}`;
  const selected = sql.join(
    spec.columns.map(
      (column, index) =>
        sql`${sql.identifier(column.name)}::text as ${sql.identifier(`c${String(index)}`)}`,
    ),
    sql`, `,
  );
  const rows = rowsOf<Record<string, string | null>>(
    await db.execute(sql`
      select ${id}::text as id, ${selected} from ${sql.identifier(table)}
       where ${options.after == null ? sql`true` : sql`${id} > ${typedId(options.after)}`}
       order by ${id} limit ${limit}`),
  );
  const updates: {
    id: string;
    changes: { column: string; kind: ColumnKind; from: string; to: string }[];
  }[] = [];
  let count = 0;
  for (const row of rows) {
    const changes = spec.columns.flatMap((column, index) => {
      const from = row[`c${String(index)}`] ?? null;
      const to = rewrapped(column.kind, from, options.keyring);
      return from === null || to === null
        ? []
        : [{ column: column.name, kind: column.kind, from, to }];
    });
    if (changes.length > 0) {
      updates.push({ id: row.id ?? '', changes });
      count += changes.length;
    }
  }
  if (options.dryRun !== true && updates.length > 0) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('openverify.kek_rewrap', 'on', true)`);
      for (const update of updates) {
        const value = (change: (typeof update.changes)[number]) =>
          change.kind === 'consent' ? sql`${change.to}::jsonb` : sql`${change.to}`;
        const assignments = sql.join(
          update.changes.map((change) => sql`${sql.identifier(change.column)} = ${value(change)}`),
          sql`, `,
        );
        const unchanged = sql.join(
          update.changes.map(
            (change) => sql`${sql.identifier(change.column)}::text = ${change.from}`,
          ),
          sql` and `,
        );
        await tx.execute(sql`
          update ${sql.identifier(table)} set ${assignments}
           where ${id} = ${typedId(update.id)} and ${unchanged}`);
      }
    });
  }
  return {
    table,
    scanned: rows.length,
    rewrapped: count,
    next: rows.length === limit ? (rows.at(-1)?.id ?? null) : null,
  };
}

/**
 * Re-wraps every encrypted column of every table, batch by batch, from `resume` if given.
 * Returns the totals; `onBatch` sees each batch's position for resuming.
 */
export async function rewrapAll(db: Db, options: RewrapAllOptions): Promise<RewrapSummary> {
  const start = options.resume === undefined ? 0 : REWRAP_TABLES.indexOf(options.resume.table);
  const summary: RewrapSummary = { scanned: 0, rewrapped: 0 };
  for (const table of REWRAP_TABLES.slice(Math.max(start, 0))) {
    let after: string | null = table === options.resume?.table ? options.resume.after : null;
    do {
      const batch: RewrapBatchResult = await rewrapTableBatch(db, table, {
        keyring: options.keyring,
        after,
        limit: options.batchSize ?? 500,
        dryRun: options.dryRun ?? false,
      });
      summary.scanned += batch.scanned;
      summary.rewrapped += batch.rewrapped;
      await options.onBatch?.(batch);
      after = batch.next;
    } while (after !== null);
  }
  return summary;
}
