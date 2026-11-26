/**
 * Graph queries (plan C102, C103): the statuses, the limits and the bulk-action vocabularies. The
 * kinds are `graph-kinds.ts`. They live in core because `packages/db`'s table CHECKs read them.
 */
import { z } from 'zod';

/** C102.4: the public statuses of a graph query. */
export const GRAPH_QUERY_STATUSES = [
  'submitted',
  'completed',
  'errored',
  'cancelled',
  'timed_out',
] as const;
export const graphQueryStatusSchema = z.enum(GRAPH_QUERY_STATUSES);
export type GraphQueryStatus = z.infer<typeof graphQueryStatusSchema>;

/** C102.1: a template and a version, as C71. */
export const GRAPH_TEMPLATE_STATUSES = ['active', 'archived'] as const;
export const graphTemplateStatusSchema = z.enum(GRAPH_TEMPLATE_STATUSES);
export type GraphTemplateStatus = z.infer<typeof graphTemplateStatusSchema>;

export const GRAPH_TEMPLATE_VERSION_STATUSES = ['draft', 'published', 'superseded'] as const;
export const graphTemplateVersionStatusSchema = z.enum(GRAPH_TEMPLATE_VERSION_STATUSES);
export type GraphTemplateVersionStatus = z.infer<typeof graphTemplateVersionStatusSchema>;

/** C102.2: hops are counted the public way: two accounts sharing a value are 2 hops apart. */
export const GRAPH_MAX_HOPS = [2, 4, 6] as const;

/** C102, C103 (ours; the fan-out and node limits are cost bounds, stated in the API docs). */
export const GRAPH_LIMITS = Object.freeze({
  parameters: 10,
  startClauses: 5,
  defaultMaxHops: 4,
  /** `include-weak-kinds: true` needs `max-hops` at most this (decision 34). */
  weakMaxHops: 4,
  defaultNodeLimit: 100,
  nodeLimit: 2000,
  defaultFanOut: 50,
  fanOut: 500,
  defaultTimeoutSeconds: 30,
  timeoutSeconds: 59,
  /** C102.4 (P25): a synchronous run's timeout, and how many run at once per environment. */
  syncTimeoutSeconds: 10,
  syncPerEnvironment: 2,
  /** C103.1 (P16, decision 37): accounts per bulk action. */
  bulkAccounts: 500,
  /** C103.2: rows of the CSV export. */
  exportRows: 2000,
  /** C102.7: `graph-query-retention-days`. */
  defaultRetentionDays: 30,
  retentionDays: 365,
});

/** C103.2: what a bulk action does; C140.6 (Workflow 8B): one case holding the selection. */
export const GRAPH_BULK_ACTIONS = [
  'add-tag',
  'remove-tag',
  'set-account-status',
  'add-to-list',
  'export',
  'create-case',
] as const;
export const graphBulkActionSchema = z.enum(GRAPH_BULK_ACTIONS);
export type GraphBulkAction = z.infer<typeof graphBulkActionSchema>;

/** C103.1: what happened to one account of a bulk action. */
export const GRAPH_BULK_OUTCOMES = [
  'done',
  'skipped_redacted',
  'skipped_consolidated',
  'refused_scope',
] as const;
export const graphBulkOutcomeSchema = z.enum(GRAPH_BULK_OUTCOMES);
export type GraphBulkOutcome = z.infer<typeof graphBulkOutcomeSchema>;
