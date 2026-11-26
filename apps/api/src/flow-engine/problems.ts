/**
 * C174.8 (Workflow 9A, api-flow-engine): the flow engine's problems, each with the status
 * `FLOW_ENGINE_PROBLEM_STATUSES` freezes. No problem names another step, a path, a value or a
 * condition (C151.4: no detail of another path).
 */
import { FLOW_ENGINE_PROBLEM_STATUSES, type FlowEngineProblemCode } from '@openverify/contracts';
import { AppError, type ProblemMembers } from '../errors.js';

export class FlowEngineProblemError extends AppError {
  override name = 'FlowEngineProblemError';

  constructor(code: FlowEngineProblemCode, detail: string, members?: ProblemMembers) {
    super({
      status: FLOW_ENGINE_PROBLEM_STATUSES[code],
      detail,
      code,
      ...(members === undefined ? {} : { members }),
    });
  }
}

/** C151.4: 409 `flow_step_not_current`, one body whatever the request was. */
export const flowStepNotCurrent = (): FlowEngineProblemError =>
  new FlowEngineProblemError('flow_step_not_current', 'This step is not the step the flow is on.');
