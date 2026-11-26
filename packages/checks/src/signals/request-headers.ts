/**
 * C94.8 (V13): what `POST /api/v1/flow/signals` keeps of its own request for the cross-layer
 * rules, sealed in `components` because nothing else stores it: the `Accept-Language` tags (at
 * most {@link MAX_ACCEPT_LANGUAGES}, in preference order) and the low-entropy `Sec-CH-UA`,
 * `Sec-CH-UA-Mobile` and `Sec-CH-UA-Platform` values. Every value is bounded and shaped as the
 * flow body's own members are (a BCP 47 tag of at most 35 characters; at most 8 brands of 1-64
 * characters with a numeric version; a platform of at most 32), so no raw header string is kept.
 */
import type { ClientHintsInput, SignalRequestHeaders } from './inputs.js';

/** As the body's `languages` member: at most 5 tags. */
export const MAX_ACCEPT_LANGUAGES = 5;

/** The request headers a Node server hands over (lower-case names). */
export type RequestHeaderValues = Readonly<Record<string, string | readonly string[] | undefined>>;

/** The flow body's language tag bound (`flowIntegritySignalsSchema.languages`). */
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const LANGUAGE_TAG = /^[a-zA-Z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const MAX_TAG_LENGTH = 35;
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const QUALITY = /^q=(0(?:\.[0-9]{0,3})?|1(?:\.0{0,3})?)$/i;
/** One `Sec-CH-UA` list member: `"<brand>";v="<version>"`, as the flow body bounds a brand. */
const BRAND = /^"([^"\\]{1,64})";\s*v="([0-9]{1,8})"$/;
const MAX_BRANDS = 8;
const PLATFORM = /^"([^"\\]{0,32})"$/;

function headerOf(headers: RequestHeaderValues, name: string): string | null {
  const value = headers[name];
  if (value === undefined) {
    return null;
  }
  return typeof value === 'string' ? value : value.join(', ');
}

function acceptLanguages(header: string | null): string[] {
  if (header === null) {
    return [];
  }
  const ranked: { tag: string; quality: number; order: number }[] = [];
  header.split(',').forEach((member, order) => {
    const [tag = '', ...parameters] = member.split(';').map((part) => part.trim());
    if (tag.length > MAX_TAG_LENGTH || !LANGUAGE_TAG.test(tag)) {
      return;
    }
    let quality = 1;
    for (const parameter of parameters) {
      const match = QUALITY.exec(parameter);
      if (match?.[1] === undefined) {
        return;
      }
      quality = Number(match[1]);
    }
    if (quality > 0) {
      ranked.push({ tag, quality, order });
    }
  });
  return ranked
    .sort((a, b) => b.quality - a.quality || a.order - b.order)
    .slice(0, MAX_ACCEPT_LANGUAGES)
    .map(({ tag }) => tag);
}

function brands(header: string): ClientHintsInput['brands'] | null {
  const members = header.split(',').map((member) => member.trim());
  if (members.length > MAX_BRANDS) {
    return null;
  }
  const parsed: { brand: string; version: string }[] = [];
  for (const member of members) {
    const match = BRAND.exec(member);
    if (match?.[1] === undefined || match[2] === undefined) {
      return null;
    }
    parsed.push({ brand: match[1], version: match[2] });
  }
  return parsed;
}

function mobileOf(header: string | null): boolean | null {
  const value = header?.trim();
  return value === '?1' ? true : value === '?0' ? false : null;
}

function platformOf(header: string | null): string | null {
  const match = header === null ? null : PLATFORM.exec(header.trim());
  return match?.[1] === undefined || match[1] === '' ? null : match[1];
}

/** The bounded facts of `headers` (C94.8, V13); a missing or malformed header gives nothing. */
export function parseSignalRequestHeaders(headers: RequestHeaderValues): SignalRequestHeaders {
  const brandHeader = headerOf(headers, 'sec-ch-ua');
  const brandList = brandHeader === null ? null : brands(brandHeader);
  return {
    acceptLanguages: acceptLanguages(headerOf(headers, 'accept-language')),
    clientHints:
      brandList === null
        ? null
        : {
            brands: brandList,
            mobile: mobileOf(headerOf(headers, 'sec-ch-ua-mobile')),
            platform: platformOf(headerOf(headers, 'sec-ch-ua-platform')),
          },
  };
}
