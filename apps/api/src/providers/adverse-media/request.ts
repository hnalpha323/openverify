/**
 * C81.2: the media jobs' search request is the port's `AdverseMediaSearch` (owner decision 5 (b)
 * folded the asking environment and every screened name into it). These read them with their
 * defaults.
 */
import type { AdverseMediaSearch } from '../../ports.js';

/** Every name a request screens: its `names`, else the port's one phrase. */
export function searchNamesOf(request: AdverseMediaSearch): readonly (readonly string[])[] {
  const { names } = request;
  return names !== undefined && names.length > 0 ? names : [request.nameTokens];
}

/** The environment whose share a request takes; `install` when a caller named none. */
export function searchEnvironmentOf(request: AdverseMediaSearch): string {
  return request.environmentId ?? 'install';
}
