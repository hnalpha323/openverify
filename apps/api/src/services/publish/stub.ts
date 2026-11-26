/**
 * C54.1: the publish hook of a type with no rule needing server state, or whose builder has not
 * landed yet: no problem. A type's builder replaces its file's stub with its rule.
 */
import type { PublishHook } from './index.js';

export function noPublishRules(): PublishHook {
  return { problems: () => Promise.resolve([]) };
}
