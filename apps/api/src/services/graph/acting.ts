/** What every Workflow 7B graph service takes, and a stub's whole body. */
import { NotImplementedError } from '../../errors.js';
import type { Principal } from '../../ports.js';
import type { Acting } from '../inquiries.js';

/**
 * C102.4, C103.2 (P11, V18): the principal too, because a person-identifying parameter needs
 * `pii:view` and each bulk action checks its own scope.
 */
export interface GraphActing extends Acting {
  principal: Principal;
}

/** A stub's answer: 501 until `api-graph` builds it. */
export const notBuilt = (name: string): Promise<never> =>
  Promise.reject(new NotImplementedError(`${name} is not built yet.`));
