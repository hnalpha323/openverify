/**
 * C122.1: the action catalogue as this process reads it. A generic action's scopes come from the
 * object-type table, so Workflow 8B adds its case row here, in one place (F33).
 *
 * Workflow 8B (C140.3, Stage 1a amendment 27): the case row, the eight case entries and the case
 * sinks join 8A's here. Their handlers are `workflows/actions/cases/index.ts`, stubs that end a step
 * with `not_implemented` until `api-case-workflows` builds them.
 */
import {
  ACTION_SINK_ROWS,
  createActionSinkTable,
  type ActionSinkTable,
} from '@openverify/workflow-engine';
import {
  ACTION_OBJECT_TYPE_ENTRIES,
  CASE_ACTION_OBJECT_TYPE_ENTRY,
  CASE_ACTION_SINK_ROWS,
  createActionObjectTypeTable,
  createActionRegistry,
  createCaseActionEntries,
  createWorkflowActionEntries,
  type ActionRegistry,
} from '@openverify/workflow-engine/actions';
import { createConnectActionEntries } from '../actions/connect/entries.js';

export const WORKFLOW_OBJECT_TYPES = createActionObjectTypeTable([
  ...ACTION_OBJECT_TYPE_ENTRIES,
  CASE_ACTION_OBJECT_TYPE_ENTRY,
]);

export const WORKFLOW_ACTIONS: ActionRegistry = createActionRegistry([
  ...createWorkflowActionEntries(WORKFLOW_OBJECT_TYPES),
  ...createCaseActionEntries(),
  // C243.1 (Workflow 11A): workflow-connect's entries, empty until it builds them (fail closed).
  ...createConnectActionEntries(),
]);

/** C115.6: what each config member of a step is, for the taint pass (`context.sinks`). */
export const WORKFLOW_SINKS: ActionSinkTable = createActionSinkTable([
  ...ACTION_SINK_ROWS,
  ...CASE_ACTION_SINK_ROWS,
]);
