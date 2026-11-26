/**
 * C94.8 (V13): the cross-layer consistency rules, medium evidence of the bot score. Each compares
 * two layers of one session that a genuine browser keeps consistent; VPN users, travellers and
 * privacy browsers produce some contradictions honestly, which is why each is medium evidence only
 * and the score caps it (P24).
 *
 * - `ua_client_hints_mismatch`, with at least one set of UA Client Hints (the page's or the
 *   `Sec-CH-UA*` headers'): a non-Blink engine in the `User-Agent` (only Chromium sends the hints);
 *   a platform family that differs from the user agent's operating system (Windows; Apple's macOS
 *   and iOS; the Linux family of Linux, Android and Chrome OS, so a desktop-site request on Android
 *   stays consistent); a `mobile` flag against a phone or desktop user agent; a `Chromium` brand
 *   version against the user agent's `Chrome/` major version; or the page and the headers
 *   disagreeing on any of the hints.
 * - `language_mismatch`: the request's `Accept-Language` sharing no primary language with the
 *   page's `navigator.languages`.
 * - `timezone_country_mismatch`: the page's time zone having none of the UTC offsets of the IP
 *   country's zones at the session's time, never for a session whose country is unreliable (Tor, a
 *   VPN ASN, a provider range, privacy relay). The country's zones come from the runtime's ICU
 *   data (`Intl.Locale` time zones); nothing is typed out here.
 *
 * A rule that cannot compare (a layer missing) is not evaluated; it never reads as consistent.
 */
import Bowser from 'bowser';
import type { ClientHintsInput, IntegrityInput, SignalRequestHeaders } from './inputs.js';
import { SDK_USER_AGENT_PATTERN } from './user-agent.js';
import type { SignalEvidenceReason } from './vocabulary.js';

/** The three cross-layer rules, by their evidence reasons. */
export const CROSS_LAYER_RULES = [
  'ua_client_hints_mismatch',
  'language_mismatch',
  'timezone_country_mismatch',
] as const satisfies readonly SignalEvidenceReason[];
export type CrossLayerRule = (typeof CROSS_LAYER_RULES)[number];

/** What one session gives the cross-layer rules. */
export interface CrossLayerInput {
  /** The `User-Agent` the session started with. */
  readonly userAgent: string | null;
  /** The page's integrity member, merged over the session's bodies. */
  readonly integrity: IntegrityInput | null;
  /** The request facts recorded by `POST /flow/signals`. */
  readonly requestHeaders: SignalRequestHeaders | null;
  /** The session's IP country, `null` when unknown or unreliable. */
  readonly ipCountry: string | null;
  /** When the session ran, for the time zone's offset. */
  readonly at: Date;
}

/** Which rules could compare, and which found a contradiction. */
export interface CrossLayerResult {
  readonly evaluated: readonly CrossLayerRule[];
  readonly mismatches: readonly CrossLayerRule[];
}

/** The operating-system families a platform hint and a user agent are compared by. */
const PLATFORM_FAMILIES: Readonly<Record<string, string>> = Object.freeze({
  windows: 'windows',
  macos: 'apple',
  ios: 'apple',
  linux: 'linux',
  android: 'linux',
  'chrome os': 'linux',
  'chromium os': 'linux',
});

const familyOf = (name: string | null | undefined): string | null =>
  name === null || name === undefined
    ? null
    : (PLATFORM_FAMILIES[name.trim().toLowerCase()] ?? null);

/** The engines that send UA Client Hints. */
const HINTING_ENGINES: ReadonlySet<string> = new Set(['Blink']);
const CHROME_MAJOR = /(?:Chrome|CriOS)\/([0-9]{1,8})\./;

interface ParsedAgent {
  readonly engine: string | null;
  readonly family: string | null;
  readonly deviceType: string | null;
  readonly chromeMajor: string | null;
}

function parseAgent(userAgent: string | null): ParsedAgent | null {
  const raw = userAgent?.trim() ?? '';
  if (raw === '' || SDK_USER_AGENT_PATTERN.test(raw)) {
    return null;
  }
  const { engine, os, platform } = Bowser.parse(raw);
  return {
    engine: engine.name ?? null,
    family: familyOf(os.name),
    deviceType: platform.type ?? null,
    chromeMajor: CHROME_MAJOR.exec(raw)?.[1] ?? null,
  };
}

const brandKey = (hints: ClientHintsInput): string =>
  hints.brands
    .map(({ brand, version }) => `${brand}/${version}`)
    .sort()
    .join('|');

/** The page's and the headers' hints contradicting each other. */
function hintsDisagree(page: ClientHintsInput, headers: ClientHintsInput): boolean {
  return (
    brandKey(page) !== brandKey(headers) ||
    (page.mobile !== null && headers.mobile !== null && page.mobile !== headers.mobile) ||
    (page.platform !== null && headers.platform !== null && page.platform !== headers.platform)
  );
}

/** One set of hints contradicting the user agent. */
function hintsContradictAgent(hints: ClientHintsInput, agent: ParsedAgent): boolean {
  if (agent.engine !== null && !HINTING_ENGINES.has(agent.engine)) {
    return true;
  }
  const family = familyOf(hints.platform);
  if (family !== null && agent.family !== null && family !== agent.family) {
    return true;
  }
  if (
    (hints.mobile === true && agent.deviceType === 'desktop') ||
    (hints.mobile === false && agent.deviceType === 'mobile')
  ) {
    return true;
  }
  const chromium = hints.brands.find(({ brand }) => brand === 'Chromium')?.version ?? null;
  return chromium !== null && agent.chromeMajor !== null && chromium !== agent.chromeMajor;
}

/** `ua_client_hints_mismatch`: `null` when nothing could be compared. */
function clientHintsMismatch(input: CrossLayerInput): boolean | null {
  const page = input.integrity?.['client-hints'] ?? null;
  const headers = input.requestHeaders?.clientHints ?? null;
  const agent = parseAgent(input.userAgent);
  const sets = [page, headers].filter((hints): hints is ClientHintsInput => hints !== null);
  if (sets.length === 0 || (agent === null && sets.length < 2)) {
    return null;
  }
  if (page !== null && headers !== null && hintsDisagree(page, headers)) {
    return true;
  }
  return agent !== null && sets.some((hints) => hintsContradictAgent(hints, agent));
}

const primary = (tag: string): string => (tag.split('-')[0] ?? tag).toLowerCase();

/** `language_mismatch`: `null` without both lists. */
function languageMismatch(input: CrossLayerInput): boolean | null {
  const header = input.requestHeaders?.acceptLanguages ?? [];
  const page = input.integrity?.languages ?? [];
  if (header.length === 0 || page.length === 0) {
    return null;
  }
  const spoken = new Set(page.map(primary));
  return !header.some((tag) => spoken.has(primary(tag)));
}

/** `timezone_country_mismatch`: `null` without a time zone and a reliable country. */
function timezoneMismatch(input: CrossLayerInput): boolean | null {
  const timeZone = input.integrity?.timezone ?? null;
  if (timeZone === null || input.ipCountry === null) {
    return null;
  }
  const fits = timeZoneFitsCountry(timeZone, input.ipCountry, input.at);
  return fits === null ? null : !fits;
}

/** C94.8: the cross-layer rules over one session. */
export function crossLayerEvidence(input: CrossLayerInput): CrossLayerResult {
  const outcomes: Readonly<Record<CrossLayerRule, boolean | null>> = {
    ua_client_hints_mismatch: clientHintsMismatch(input),
    language_mismatch: languageMismatch(input),
    timezone_country_mismatch: timezoneMismatch(input),
  };
  return {
    evaluated: CROSS_LAYER_RULES.filter((rule) => outcomes[rule] !== null),
    mismatches: CROSS_LAYER_RULES.filter((rule) => outcomes[rule] === true),
  };
}

/** Zones privacy browsers report instead of the real one, which say nothing about a country. */
const UNINFORMATIVE_ZONE = /^(?:Etc\/.*|UTC|UCT|GMT|Universal|Zulu|Greenwich)$/i;

/** `Intl.Locale` time zones: `getTimeZones()` on newer runtimes, the `timeZones` getter on Node 22. */
interface LocaleTimeZones {
  readonly getTimeZones?: () => string[] | undefined;
  readonly timeZones?: string[] | undefined;
}

function countryZones(countryCode: string): readonly string[] | null {
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    return null;
  }
  const locale = new Intl.Locale(`und-${countryCode}`) as Intl.Locale & LocaleTimeZones;
  const zones =
    typeof locale.getTimeZones === 'function' ? locale.getTimeZones() : locale.timeZones;
  return zones === undefined || zones.length === 0 ? null : zones;
}

/** The UTC offset of `timeZone` at `at`, as ICU names it (`GMT+01:00`), or `null` when unknown. */
function offsetOf(timeZone: string, at: Date): string | null {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find(({ type }) => type === 'timeZoneName');
    return part?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether the IANA `timeZone` fits `countryCode` at `at`: one of the country's zones, or a zone
 * with one of their UTC offsets then. `null` when either side is unknown to the runtime's ICU
 * data or the zone is UTC itself (privacy browsers report UTC).
 */
export function timeZoneFitsCountry(
  timeZone: string,
  countryCode: string,
  at: Date,
): boolean | null {
  if (UNINFORMATIVE_ZONE.test(timeZone)) {
    return null;
  }
  const offset = offsetOf(timeZone, at);
  const zones = countryZones(countryCode);
  if (offset === null || zones === null) {
    return null;
  }
  return zones.includes(timeZone) || zones.some((zone) => offsetOf(zone, at) === offset);
}
