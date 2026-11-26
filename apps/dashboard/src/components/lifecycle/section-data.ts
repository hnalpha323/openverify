/**
 * The data of an optional section of a page, such as an inquiry's sessions or timeline: loaded
 * only with its permission, and when the API still refuses it (403), shown as the section's
 * forbidden panel while the rest of the page renders.
 */
import 'server-only';
import { classifyApiError } from '../../lib/api/errors';

export type SectionData<T> =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'ready'; readonly data: T };

/**
 * `load()` when `allowed`, else `hidden` without calling anything.
 * @throws whatever `load` throws, except a 403.
 */
export async function loadSection<T>(
  allowed: boolean,
  load: () => Promise<T>,
): Promise<SectionData<T>> {
  if (!allowed) {
    return { kind: 'hidden' };
  }
  try {
    return { kind: 'ready', data: await load() };
  } catch (error) {
    if (classifyApiError(error) === 'forbidden') {
      return { kind: 'forbidden' };
    }
    throw error;
  }
}
