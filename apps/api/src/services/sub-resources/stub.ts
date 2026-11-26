/**
 * C54.1: the cancel hook of a type with no sub-resource, or whose builder has not landed yet: it
 * has nothing to do. A type's builder replaces its file's stub when it adds a sub-resource.
 */
import type { SubResourceHook } from './index.js';

export function noSubResources(): SubResourceHook {
  return { onVerificationCanceled: () => Promise.resolve({ staged: [], storageKeys: [] }) };
}
