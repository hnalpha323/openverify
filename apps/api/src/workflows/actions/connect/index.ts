/**
 * C243.1 (Phase 11, Workflow 11A): Connect's action handlers (`./handlers.ts`) over the share token
 * services (`./share-token-services.ts`), joined to the process table beside the case steps'.
 * Owner `workflow-connect`.
 */
import type { ActionHandler } from '../../engine/action-port.js';
import { createConnectActionHandlers } from './handlers.js';
import { SHARE_TOKEN_SERVICES } from './share-token-services.js';

export const CONNECT_ACTION_HANDLERS: readonly ActionHandler[] =
  createConnectActionHandlers(SHARE_TOKEN_SERVICES);
