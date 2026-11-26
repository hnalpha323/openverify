/** What every Workflow 8A route service takes. */
import type { Principal } from '../ports.js';
import type { Acting } from '../services/inquiries.js';

/**
 * C121 (P07, P08): the principal too, because publishing, rollout, restore and promote are user-only
 * (C121.2), and a run a principal starts needs every scope of its version's grant (C121.3).
 */
export interface WorkflowActing extends Acting {
  principal: Principal;
}
