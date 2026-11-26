import { problemSchema, type Problem } from '@openverify/contracts';
import { FlowApiError } from '../api/flow-api-error';

/**
 * The golden problem documents of `contracts/fixtures/problems/`, by file name: the 401
 * `session_canceled` answers a flow API call gets, one per `reason` (C20, Workflow 2E C25.8), and
 * the 409 selfie capture answers, one per C40 problem code (Workflow 4B review K202).
 */
const modules = import.meta.glob<unknown>('../../../../contracts/fixtures/problems/*.json', {
  eager: true,
  import: 'default',
});

export const GOLDEN_PROBLEMS: ReadonlyMap<string, unknown> = new Map(
  Object.entries(modules).map(([path, body]) => [path.slice(path.lastIndexOf('/') + 1), body]),
);

/**
 * The golden Phase 5 problems of `contracts/fixtures/problems/flow/` (C52.7), by `code`: one per
 * code the flow API and the template publish answer with.
 */
const flowModules = import.meta.glob<unknown>(
  '../../../../contracts/fixtures/problems/flow/*.json',
  { eager: true, import: 'default' },
);

export const GOLDEN_FLOW_PROBLEMS: ReadonlyMap<string, Problem> = new Map(
  Object.values(flowModules).map((body) => {
    const problem = problemSchema.parse(body);
    if (problem.code === undefined) {
      throw new Error('a golden flow problem has no code');
    }
    return [problem.code, problem];
  }),
);

/**
 * The `FlowApiError` the client raises for the golden problem with `code`, with `members` (such
 * as `attempts-remaining`) replacing the fixture's own values.
 */
export function goldenFlowError(
  code: string,
  members: Readonly<Record<string, unknown>> = {},
): FlowApiError {
  const golden = GOLDEN_FLOW_PROBLEMS.get(code);
  if (golden === undefined) {
    throw new Error(`no golden flow problem ${code}`);
  }
  const problem = problemSchema.parse({ ...golden, ...members });
  return new FlowApiError(
    'http',
    `POST ${problem.instance} failed with HTTP ${String(problem.status)}`,
    { status: problem.status, problem },
  );
}
