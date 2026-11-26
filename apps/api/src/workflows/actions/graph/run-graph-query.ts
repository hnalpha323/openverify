/**
 * C127.5, outcome 27: Run Graph Query. A query from a template, bound to the run's account, then, in
 * synchronous mode, a wait for its terminal event. `account-count` is `null` unless it completed;
 * `errored`, `timed_out` and `cancelled` are step errors; the step's own timeout is `wait_timed_out`;
 * and a 429 is a retryable rate-limit error that honours `Retry-After`, never a failed run or a result.
 */
import { GRAPH_LIMITS, graphKindOfCode } from '@openverify/core';
import { graphQueryTemplateConfigSchema } from '@openverify/contracts';
import {
  getGraphQuery,
  listCurrentGraphQueryTemplateVersions,
  type Db,
  type GraphQueryRow,
} from '@openverify/db';
import {
  runGraphQueryConfigSchema,
  GRAPH_ACTION_LIMITS,
} from '@openverify/workflow-engine/actions';
import type { JsonRecord } from '@openverify/workflow-engine';
import { createGraphQueryInTx, enqueueGraphQuery } from '../../../services/graph/queries.js';
import { consumeGraphQueryRate, graphChangeIn } from '../../../services/graph/shared.js';
import type { StagedEvent } from '../../../events/index.js';
import type { ActionResult, TransactionActionHandler } from '../../engine/action-port.js';
import { apiDepsOf, configOf, refusing } from '../shared.js';

const TERMINAL: Readonly<Record<string, string>> = {
  errored: 'graph_query_errored',
  timed_out: 'graph_query_timed_out',
  cancelled: 'graph_query_cancelled',
};

const TERMINAL_EVENTS = [
  'graph-query.completed',
  'graph-query.errored',
  'graph-query.timed-out',
  'graph-query.cancelled',
];

function outputOf(query: GraphQueryRow): JsonRecord {
  return {
    'graph-query-id': query.id,
    status: query.status,
    'account-count': query.status === 'completed' ? query.accountIds.length : null,
    'node-limit-reached': query.nodeLimitReached,
    'skipped-hub-values': query.skippedHubValues,
    'index-complete': query.kindsNotIndexed.length === 0,
    'kinds-not-indexed': query.kindsNotIndexed.flatMap((code) => graphKindOfCode(code) ?? []),
  };
}

/** C127.5: the parameters that name an account, which the run's account fills. */
async function accountParametersOf(
  tx: Db,
  environmentId: string,
  templateId: string,
): Promise<string[]> {
  const versions = await listCurrentGraphQueryTemplateVersions(tx, environmentId, [templateId]);
  const parsed = graphQueryTemplateConfigSchema.safeParse(
    versions.get(templateId)?.published?.config,
  );
  return parsed.success
    ? parsed.data.parameters.filter(({ kind }) => kind === 'account_id').map(({ name }) => name)
    : [];
}

async function finished(tx: Db, environmentId: string, id: string): Promise<ActionResult> {
  const query = await getGraphQuery(tx, environmentId, id);
  if (query === null) {
    return { kind: 'failed', code: 'object_not_found' };
  }
  const code = TERMINAL[query.status];
  return code === undefined
    ? { kind: 'succeeded', output: outputOf(query) }
    : { kind: 'failed', code, output: outputOf(query) };
}

export const RUN_GRAPH_QUERY_HANDLER: TransactionActionHandler = {
  key: 'run_graph_query',
  version: 1,
  shape: 'transaction',
  async execute(tx, context): Promise<ActionResult> {
    const config = configOf(context, runGraphQueryConfigSchema);
    const deps = apiDepsOf(context);
    const { environmentId, acting } = context;
    await refusing(() => consumeGraphQueryRate(deps, environmentId));
    const staged: StagedEvent[] = [];
    const timeout = config['timeout-seconds'] ?? GRAPH_ACTION_LIMITS['query-timeout-seconds'].value;
    const templateId = config['graph-query-template-id'];
    const accountParameters = await accountParametersOf(tx, environmentId, templateId);
    const query = await refusing(() =>
      createGraphQueryInTx(
        deps,
        graphChangeIn(tx, deps, acting, staged),
        environmentId,
        context.grant.pii,
        {
          data: {
            type: 'graph-query',
            attributes: {
              'graph-query-template-id': templateId,
              'parameter-map': {
                ...Object.fromEntries(
                  accountParameters.map((name) => [name, config['account-id']]),
                ),
                ...(config.fields as Record<string, string> | undefined),
              },
              'timeout-in-seconds': Math.min(timeout, GRAPH_LIMITS.timeoutSeconds),
            },
          },
        },
      ),
    );
    const enqueue = () => enqueueGraphQuery(deps, environmentId, query.id);
    const subjects = [{ subjectId: query.id, source: 'written' as const }];
    if (config.mode === 'asynchronous') {
      return {
        kind: 'succeeded',
        output: { 'graph-query-id': query.id, status: 'submitted', 'account-count': null },
        staged,
        afterCommit: enqueue,
        subjects,
      };
    }
    return {
      kind: 'waiting',
      correlationKey: query.id,
      events: TERMINAL_EVENTS,
      timeoutSeconds: timeout,
      timeoutCode: 'wait_timed_out',
      carry: { 'graph-query-id': query.id },
      staged,
      afterCommit: enqueue,
      subjects,
    };
  },
  resume: (tx, context, { carry }) =>
    finished(tx, context.environmentId, carry['graph-query-id'] as string),
};
