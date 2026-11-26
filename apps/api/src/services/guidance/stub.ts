/**
 * C54.1: the guidance hook of a type whose builder has not landed yet: `guidance` is `null` (the
 * client has nothing to run the step with yet). Each type's builder replaces its file's stub.
 */
import type { VerificationGuidanceHook } from './index.js';

export function unbuiltGuidanceHook(): VerificationGuidanceHook {
  return { flowAttributes: () => Promise.resolve({ guidance: null }) };
}
