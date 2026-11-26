/**
 * C99.5 (Workflow 7B): the `list-config` publish rules of an inquiry template version, which
 * `assertPublishable` (`services/inquiry-templates.ts`) runs beside `signalConfigPublishProblems`
 * and `handoffPublishProblems`: a named list of a kind the environment does not collect answers 422
 * `kind_not_collected`, and a name this environment does not hold 422 `list_kind_mismatch` (ours:
 * the plan names no code, and a typed id would read as `list_archived` on every screening). A list
 * archived already publishes: only the version page warns, as for one archived later. Owner:
 * `api-lists`.
 */
import type { ListConfig, ListProblemCode } from '@openverify/contracts';
import { getEnvironment, getLists, type Db } from '@openverify/db';
import type { EnvironmentKind } from '../../ports.js';
import type { ApiDependencies } from '../context.js';
import { kindsNotCollected } from '../lists/selection.js';

export interface ListConfigPublishContext {
  deps: ApiDependencies;
  /** The request's database, or the transaction that publishes. */
  db: Db;
  environment: { id: string; kind: EnvironmentKind };
  listConfig: ListConfig;
}

export interface ListConfigProblem {
  code: ListProblemCode;
  detail: string;
  /** A JSON pointer into the request body. */
  pointer: string;
}

export type ListConfigPublishProblems = (
  ctx: ListConfigPublishContext,
) => Promise<ListConfigProblem[]>;

export const listConfigPublishProblems: ListConfigPublishProblems = async ({
  db,
  environment,
  listConfig,
}) => {
  const { screen } = listConfig;
  if (!Array.isArray(screen) || screen.length === 0) {
    return [];
  }
  const settled = await getEnvironment(db, environment.id);
  const missing = await kindsNotCollected(db, {
    kind: environment.kind,
    settings: settled?.settings ?? {},
  });
  const lists = new Map((await getLists(db, environment.id, screen)).map((l) => [l.id, l]));
  const problems: ListConfigProblem[] = [];
  screen.forEach((id, index) => {
    const pointer = `/data/attributes/list-config/screen/${String(index)}`;
    const list = lists.get(id);
    if (list === undefined) {
      problems.push({
        code: 'list_kind_mismatch',
        detail: 'Names a list this environment does not hold.',
        pointer,
      });
    } else if (missing.has(list.type)) {
      problems.push({
        code: 'kind_not_collected',
        detail: `This environment collects no ${list.type} value.`,
        pointer,
      });
    }
  });
  return problems;
};
