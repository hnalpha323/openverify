/**
 * C54.1: the attribute hook of a type whose builder has not landed yet: it stores nothing, so it
 * loads no attribute (every C52.8 member is optional), and masks with the C53.7 list. Each type's
 * builder replaces its file's stub with the real hook.
 */
import type { VerificationAttributeHook } from './index.js';

export function unbuiltAttributeHook(): VerificationAttributeHook {
  return {
    load: () => Promise.resolve({}),
    mask: (attributes, mask) => mask.attributes(attributes),
  };
}
