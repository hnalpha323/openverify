/**
 * C122.1: this process's catalogue and handlers. Each owner's list joins {@link HANDLERS}, so a step
 * with no handler errors `provider_not_configured`, never a skip, and `actions.test.ts` fails a
 * catalogue action no list holds.
 */
import { CASE_ACTION_HANDLERS } from '../actions/cases/index.js';
import { CONNECT_ACTION_HANDLERS } from '../actions/connect/index.js';
import { OBJECT_ACTION_HANDLERS } from '../actions/index.js';
import { EGRESS_ACTION_HANDLERS } from '../actions/messaging/egress-handlers.js';
import { WORKFLOW_ACTIONS } from '../definitions/registry.js';
import { SCHEDULE_WORKFLOW_HANDLER } from '../triggers/schedule-workflow.js';
import {
  createActionHandlerTable,
  type ActionHandler,
  type ActionHandlerTable,
  type EngineActions,
} from './action-port.js';
import { RUN_WORKFLOW_HANDLER } from './run-workflow.js';

const HANDLERS: readonly ActionHandler[] = [
  RUN_WORKFLOW_HANDLER,
  SCHEDULE_WORKFLOW_HANDLER,
  ...OBJECT_ACTION_HANDLERS,
  ...EGRESS_ACTION_HANDLERS,
  // Workflow 8B (C140.3): `api-case-workflows`' list, stubs until it builds them.
  ...CASE_ACTION_HANDLERS,
  // C243.1 (Workflow 11A): `workflow-connect`'s three share token steps.
  ...CONNECT_ACTION_HANDLERS,
];

let table: ActionHandlerTable | undefined;

export function processActions(): EngineActions {
  table ??= createActionHandlerTable(HANDLERS);
  return { registry: WORKFLOW_ACTIONS, handlers: table };
}
