/**
 * C127.5: the graph actions. A graph that was not indexed is never "not linked": `account-count` is
 * `null` unless the query completed, the public `-1` is served only on the graph-query resource, and
 * `sync_graph` answers `synced: true` only when nothing is pending and every kind its mode covers is
 * indexed (decision 47, outcome 26).
 */
import { graphQueryStatusSchema } from '@openverify/core';
import { z } from 'zod';
import { actionReferenceSchema, actionValueMapSchema, plain, provisional } from './common.js';

export const GRAPH_ACTION_LIMITS = Object.freeze({
  'query-timeout-seconds': provisional(60, 'C127.5: a synchronous query within its step'),
  'sync-timeout-seconds': provisional(60, 'C127.5: the default of sync_graph'),
  'sync-poll-seconds': provisional(2, 'C127.5'),
  'sync-lease-margin-seconds': provisional(30, 'C127.5'),
  'timeout-seconds-ceiling': provisional(600, 'C117.4: a step lease stays short'),
});

export const GRAPH_QUERY_MODES = ['synchronous', 'asynchronous'] as const;

const timeoutSchema = z.int().min(1).max(GRAPH_ACTION_LIMITS['timeout-seconds-ceiling'].value);

export const runGraphQueryConfigSchema = z.strictObject({
  'graph-query-template-id': actionReferenceSchema,
  'account-id': actionReferenceSchema,
  fields: actionValueMapSchema.optional(),
  mode: z.enum(GRAPH_QUERY_MODES),
  'timeout-seconds': timeoutSchema.optional(),
});
export type RunGraphQueryConfig = z.infer<typeof runGraphQueryConfigSchema>;

const graphQueryIdSchema = z.string().min(1).max(64);

interface GraphAnswer {
  readonly status: string;
  readonly 'account-count': number | null;
}

/** C127.5: a count only from a finished query. */
const countFollowsCompletion = (value: GraphAnswer): boolean =>
  value['account-count'] === null || value.status === 'completed';

const finishedQuerySchema = z
  .strictObject({
    'graph-query-id': plain(graphQueryIdSchema),
    status: plain(graphQueryStatusSchema),
    'account-count': plain(z.int().min(0).nullable()),
    'node-limit-reached': plain(z.boolean()),
    'skipped-hub-values': plain(z.int().min(0)),
    'index-complete': plain(z.boolean()),
    'kinds-not-indexed': plain(z.array(z.string().min(1).max(64))),
  })
  .refine(countFollowsCompletion, {
    message: 'only a completed query has a count',
    path: ['account-count'],
  });

/** C127.5: asynchronous mode; a read of the count needs a later wait on that query. */
const submittedQuerySchema = z.strictObject({
  'graph-query-id': plain(graphQueryIdSchema),
  status: plain(z.literal('submitted')),
  'account-count': plain(z.null()),
});

export const runGraphQueryOutputSchema = z.union([finishedQuerySchema, submittedQuerySchema]);
export type RunGraphQueryOutput = z.infer<typeof runGraphQueryOutputSchema>;

/** The public modes (behaviour note H69). */
export const SYNC_GRAPH_MODES = ['non-embedding', 'all', 'selective'] as const;
/** C127.5: `error` by default. `continue` answers `synced: false`, never a value that reads as done. */
export const SYNC_GRAPH_ON_PENDING = ['error', 'continue'] as const;

interface SyncConfig {
  readonly mode: string;
  readonly 'graph-query-template-ids'?: readonly string[] | undefined;
}

/** Selective mode names its templates, and no other does. */
const templatesFollowMode = (config: SyncConfig): boolean =>
  (config.mode === 'selective') === (config['graph-query-template-ids'] !== undefined);

export const syncGraphConfigSchema = z
  .strictObject({
    'account-id': actionReferenceSchema,
    mode: z.enum(SYNC_GRAPH_MODES).default('non-embedding'),
    'graph-query-template-ids': z.array(actionReferenceSchema).min(1).max(50).optional(),
    'timeout-seconds': timeoutSchema.default(GRAPH_ACTION_LIMITS['sync-timeout-seconds'].value),
    'on-pending': z.enum(SYNC_GRAPH_ON_PENDING).default('error'),
  })
  .refine(templatesFollowMode, {
    message: 'selective mode names its templates, and no other mode does',
    path: ['graph-query-template-ids'],
  });
export type SyncGraphConfig = z.infer<typeof syncGraphConfigSchema>;

export const syncGraphOutputSchema = z.union([
  z.strictObject({
    synced: plain(z.literal(true)),
    mode: plain(z.enum(SYNC_GRAPH_MODES)),
  }),
  z.strictObject({
    synced: plain(z.literal(false)),
    'pending-jobs': plain(z.int().min(0)),
    'kinds-not-indexed': plain(z.array(z.string().min(1).max(64))),
  }),
]);
export type SyncGraphOutput = z.infer<typeof syncGraphOutputSchema>;
