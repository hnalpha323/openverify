/**
 * C140.3 (Workflow 8B): the eight case steps' handlers (`./steps.ts`), joined to `HANDLERS` in
 * `workflows/engine/actions.ts` beside 8A's lists, because a catalogue action with no handler fails
 * `engine/actions.test.ts`. Owner `api-case-workflows`.
 */
import type { ActionHandler } from '../../engine/action-port.js';
import { CASE_STEP_HANDLERS } from './steps.js';

export const CASE_ACTION_HANDLERS: readonly ActionHandler[] = CASE_STEP_HANDLERS;
