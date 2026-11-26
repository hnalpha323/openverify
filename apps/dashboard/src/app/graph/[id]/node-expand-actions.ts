'use server';

/**
 * Owner decision 20 after Workflow 7B (Workflow 9B B42): an explicit "Expand" on a property node of
 * a stored graph result runs `POST /graph-queries/:id/nodes/:nodeId/expand` (`graph:write`, and
 * `pii:view` for a person-identifying kind, which the API checks) and answers the new query, which
 * the explorer merges onto the node. Nothing expands on render or hover: each run counts against
 * the `graph-queries` limit. Each refusal is said in words: the graph's own codes (a redacted query,
 * a busy environment) as the explorer says them, and a 403, 404 or 422 in this action's words.
 */
import { expandGraphNodeParamsSchema, type GraphQueryResource } from '@openverify/contracts';
import { describeGraphProblem } from '../../../components/graph/graph-words';
import type { ActionResult, ActionState, DisplayProblem } from '../../../lib/action-state';
import { formString, parseInput, runAction } from '../../../lib/api/action';
import { CASES_REPORTS_COPY } from '../../../lib/copy/cases-reports';

const REFUSALS: Readonly<Record<number, string>> = CASES_REPORTS_COPY.graphExpand.refusals;

/** A refusal in words: the graph's own code first, then the status's words. */
function expansionProblem(problem: DisplayProblem): DisplayProblem {
  const described = describeGraphProblem(problem);
  if (described !== problem) {
    return described;
  }
  const words = problem.status === undefined ? undefined : REFUSALS[problem.status];
  return words === undefined ? problem : { ...problem, title: words };
}

export async function expandPropertyNode(
  _state: ActionState<GraphQueryResource>,
  formData: FormData,
): Promise<ActionResult<GraphQueryResource>> {
  const result = await runAction({ permissions: ['graph:write'] }, async ({ api }) => {
    const params = parseInput(expandGraphNodeParamsSchema, {
      id: formString(formData, 'graph-query-id'),
      nodeId: formString(formData, 'node-id'),
    });
    const { data } = await api.graphQueries.expandNode(params.id, params.nodeId, {
      runSync: true,
    });
    return data;
  });
  return result.ok ? result : { ok: false, problem: expansionProblem(result.problem) };
}
