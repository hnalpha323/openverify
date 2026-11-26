/** The engine's view of what the worker holds. */
import type { WorkflowWorkerDeps } from '../worker.js';
import { processActions } from './actions.js';
import type { EngineDeps } from './deps.js';

export function engineDepsOf(deps: WorkflowWorkerDeps): EngineDeps {
  return {
    db: deps.db,
    clock: deps.clock,
    ids: deps.services.ids,
    events: deps.services.events,
    steps: deps.steps,
    actions: deps.actions ?? processActions(),
    services: deps.services,
    logger: deps.logger,
    ...(deps.inFlightCap === undefined ? {} : { inFlightCap: deps.inFlightCap }),
    ...(deps.heartbeatMs === undefined ? {} : { heartbeatMs: deps.heartbeatMs }),
  };
}
