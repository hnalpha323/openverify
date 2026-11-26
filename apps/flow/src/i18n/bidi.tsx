/**
 * C161.3: every interpolated value inside `<bdi>`, so an email address, a phone number or a Latin
 * name inside Arabic text keeps its own direction and the punctuation around it stays in place.
 * Values are rendered as React text, never as markup, and as given: a number the screen wants in
 * the person's digits is formatted with `Intl` and `intlLocale` before it is passed in. Consent
 * texts keep `fillPlaceholders`, since their digest is taken over the plain filled text (C162.9).
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export type IsolatedValues = Readonly<Record<string, string | number>>;

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/**
 * `message` with each `{{name}}` replaced by `<bdi>{values[name]}</bdi>`. A placeholder without a
 * value is left as written, so the gap shows instead of a silently shorter sentence.
 */
export function isolateValues(message: string, values: IsolatedValues): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of message.matchAll(PLACEHOLDER)) {
    const name = match[1] ?? '';
    if (!Object.hasOwn(values, name)) {
      continue;
    }
    if (match.index > last) {
      nodes.push(message.slice(last, match.index));
    }
    nodes.push(<bdi key={`${name}-${String(match.index)}`}>{String(values[name])}</bdi>);
    last = match.index + match[0].length;
  }
  if (last < message.length) {
    nodes.push(message.slice(last));
  }
  return nodes;
}

type RawTranslate = (key: string, options: Readonly<Record<string, unknown>>) => unknown;

/**
 * A catalog message in the current language, with its values isolated: i18next chooses the
 * plural form from `count` and leaves the placeholders to {@link isolateValues}.
 */
export function useIsolatedT(): (key: string, values?: IsolatedValues) => ReactNode[] {
  const { i18n } = useTranslation();
  // The key is a runtime string here, so the typed `t` is called through a plain signature.
  const translate = i18n.t.bind(i18n) as unknown as RawTranslate;
  return (key, values = {}) => {
    const count = values.count;
    const message = translate(key, {
      ...(count === undefined ? {} : { count }),
      skipInterpolation: true,
    });
    return isolateValues(typeof message === 'string' ? message : key, values);
  };
}
