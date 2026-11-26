/**
 * The hosted flow's public, non-secret URL parameters (C161.2, C160.9; V15): `language` (with
 * `lang` as its alias) and `style-variant`. Each may come in the query or in the fragment beside
 * the credentials; `bootstrapSession` removes the fragment at once, so it carries these over into
 * the query (`carryParameters`), where the app reads them, and a reload keeps them. Neither is a
 * secret; `@openverify/js` passes both in the query.
 */
import { LANGUAGE_PARAMETERS } from '../i18n/languages';
import type { StyleVariant } from '../theme/apply';

/** C160.9: `light` or `dark` forces the theme's variant; anything else is ignored. */
export const STYLE_VARIANTS = ['light', 'dark'] as const satisfies readonly StyleVariant[];

export const STYLE_VARIANT_PARAMETER = 'style-variant';

export interface FlowParameters {
  /** The language tags the URL asked for, in priority order (`language`, then `lang`). */
  readonly languages: readonly string[];
  /** The `style-variant` the URL asked for, or `null`. */
  readonly styleVariant: StyleVariant | null;
}

const isStyleVariant = (value: string): value is StyleVariant =>
  (STYLE_VARIANTS as readonly string[]).includes(value);

/** The public parameters a fragment may carry beside the credentials. */
const CARRIED = [...LANGUAGE_PARAMETERS, STYLE_VARIANT_PARAMETER] as const;

/** The parameters of `location`, the query first; `null` when it carries none of them. */
export function readFlowParameters(
  location: Pick<Location, 'search' | 'hash'>,
): FlowParameters | null {
  const sources = [
    new URLSearchParams(location.search),
    new URLSearchParams(location.hash.replace(/^#/u, '')),
  ];
  const languages = LANGUAGE_PARAMETERS.flatMap((name) =>
    sources.map((params) => params.get(name)?.trim() ?? ''),
  ).filter((value) => value !== '');
  const variant = sources
    .map((params) => params.get(STYLE_VARIANT_PARAMETER)?.trim().toLowerCase() ?? '')
    .find((value) => value !== '');
  const styleVariant = variant !== undefined && isStyleVariant(variant) ? variant : null;
  return languages.length === 0 && styleVariant === null ? null : { languages, styleVariant };
}

/**
 * The query `search` with the fragment's public parameters added (a parameter the query already
 * names keeps the query's value), so they survive the fragment's removal; nothing else of the
 * fragment, the credentials above all, is ever carried.
 */
export function carryParameters(search: string, hash: string): string {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/u, ''));
  let carried = false;
  for (const name of CARRIED) {
    const value = fragment.get(name);
    if (value !== null && value.trim() !== '' && !query.has(name)) {
      query.append(name, value.trim());
      carried = true;
    }
  }
  if (!carried) {
    return search;
  }
  return `?${query.toString()}`;
}
