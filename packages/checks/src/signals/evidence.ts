/**
 * C94.8: one session's collector evidence, gathered from its stored bodies for the bot score, the
 * behaviour level and the artefact count: the integrity member merged over the bodies (any flag
 * seen, the union of driver kinds, the largest untrusted-event count, the newest hints, time zone
 * and languages), the per-screen behaviour aggregates, the newest request facts, and the sandbox
 * outcome where the environment is a sandbox. Bodies are read in `sequence` order.
 *
 * Workflow 10B (C94.7, C210.2): Android's `android-integrity` member is merged the same way: either
 * debugger fact seen in any body, and each indicator list the union of the bodies that carried it
 * (`null` when none did: its probes never ran).
 */
import type {
  AndroidIntegrityInput,
  BehaviourInput,
  IntegrityInput,
  SignalBodyInput,
  SignalRequestHeaders,
  SignalSessionInput,
} from './inputs.js';

/** One screen's behaviour aggregates, with the screen's step type. */
export interface BehaviourScreen {
  readonly screen: string;
  readonly screenType: string | null;
  readonly behaviour: BehaviourInput;
}

/** C94.7, C210.2: Android's integrity member merged over a session's bodies. */
export interface AndroidIntegrityEvidence {
  readonly debuggerConnected: boolean;
  readonly appDebuggable: boolean;
  readonly 'emulator-indicators': readonly string[] | null;
  readonly 'root-indicators': readonly string[] | null;
  readonly 'hooking-indicators': readonly string[] | null;
}

/** The indicator lists of `android-integrity` (C210.2). */
export const ANDROID_INDICATOR_LISTS = [
  'emulator-indicators',
  'root-indicators',
  'hooking-indicators',
] as const;
export type AndroidIndicatorList = (typeof ANDROID_INDICATOR_LISTS)[number];

/** One session's evidence for the collector signals. */
export interface SessionEvidence {
  readonly sessionId: string;
  readonly at: Date;
  readonly userAgent: string | null;
  /** The integrity member merged over the bodies; `null` when no body carried one. */
  readonly integrity: IntegrityInput | null;
  /** One entry per body with behaviour aggregates, in sequence order. */
  readonly screens: readonly BehaviourScreen[];
  /** The newest request facts recorded with a body; `null` when none were. */
  readonly requestHeaders: SignalRequestHeaders | null;
  /** The session's IP country when known and reliable (not Tor, VPN, provider range or relay). */
  readonly ipCountry: string | null;
  /** C90.9: a sandbox body's outcome; always `null` outside a sandbox environment. */
  readonly sandboxOutcome: 'bot' | 'human' | null;
  /** Whether the session sent any body at all. */
  readonly sentPayload: boolean;
  /** Whether any body came from the Android SDK (C94.7). */
  readonly android: boolean;
  /** Android's integrity member merged over the bodies; `null` when no body carried one. */
  readonly androidIntegrity: AndroidIntegrityEvidence | null;
}

function unionOf(
  merged: readonly string[] | null,
  next: readonly string[] | undefined,
): readonly string[] | null {
  if (next === undefined) {
    return merged;
  }
  return [...new Set([...(merged ?? []), ...next])];
}

function mergeAndroidIntegrity(
  merged: AndroidIntegrityEvidence | null,
  next: AndroidIntegrityInput,
): AndroidIntegrityEvidence {
  return {
    debuggerConnected: (merged?.debuggerConnected ?? false) || next['debugger-connected'],
    appDebuggable: (merged?.appDebuggable ?? false) || next['app-debuggable'],
    'emulator-indicators': unionOf(
      merged?.['emulator-indicators'] ?? null,
      next['emulator-indicators'],
    ),
    'root-indicators': unionOf(merged?.['root-indicators'] ?? null, next['root-indicators']),
    'hooking-indicators': unionOf(
      merged?.['hooking-indicators'] ?? null,
      next['hooking-indicators'],
    ),
  };
}

function mergeIntegrity(merged: IntegrityInput, next: IntegrityInput): IntegrityInput {
  return {
    webdriver: merged.webdriver || next.webdriver,
    'driver-globals': [...new Set([...merged['driver-globals'], ...next['driver-globals']])],
    'ua-headless-marker': merged['ua-headless-marker'] || next['ua-headless-marker'],
    'zero-window-with-focus': merged['zero-window-with-focus'] || next['zero-window-with-focus'],
    'plugins-inconsistent': merged['plugins-inconsistent'] || next['plugins-inconsistent'],
    'mime-inconsistent': merged['mime-inconsistent'] || next['mime-inconsistent'],
    'native-function-tampered':
      merged['native-function-tampered'] || next['native-function-tampered'],
    'untrusted-event-count': Math.max(
      merged['untrusted-event-count'],
      next['untrusted-event-count'],
    ),
    'client-hints': next['client-hints'] ?? merged['client-hints'],
    timezone: next.timezone ?? merged.timezone,
    languages: next.languages.length > 0 ? next.languages : merged.languages,
  };
}

/** Whether the session's IP country can be trusted for the time-zone rule (V08). */
function reliableCountry(session: SignalSessionInput): string | null {
  const network = session.network;
  if (
    network === null ||
    network.isTor === true ||
    network.isVpn === true ||
    network.isDatacenter === true ||
    network.privacyRelay === true
  ) {
    return null;
  }
  return network.countryCode;
}

/** Gathers one session's evidence (C94.8); `environment` gates the sandbox outcome (C90.9). */
export function sessionEvidence(
  session: SignalSessionInput,
  environment: 'sandbox' | 'production',
): SessionEvidence {
  const bodies: SignalBodyInput[] = [...session.bodies].sort((a, b) => a.sequence - b.sequence);
  let integrity: IntegrityInput | null = null;
  let requestHeaders: SignalRequestHeaders | null = null;
  let sandboxOutcome: 'bot' | 'human' | null = null;
  let androidIntegrity: AndroidIntegrityEvidence | null = null;
  const screens: BehaviourScreen[] = [];
  for (const body of bodies) {
    if (body.androidIntegrity) {
      androidIntegrity = mergeAndroidIntegrity(androidIntegrity, body.androidIntegrity);
    }
    if (body.integrity) {
      integrity = integrity === null ? body.integrity : mergeIntegrity(integrity, body.integrity);
    }
    if (body.behaviour) {
      screens.push({ screen: body.screen, screenType: body.screenType, behaviour: body.behaviour });
    }
    requestHeaders = body.requestHeaders ?? requestHeaders;
    if (environment === 'sandbox') {
      sandboxOutcome = body.sandboxOutcome ?? sandboxOutcome;
    }
  }
  return {
    sessionId: session.id,
    at: session.createdAt,
    userAgent: session.userAgent,
    integrity,
    screens,
    requestHeaders,
    ipCountry: reliableCountry(session),
    sandboxOutcome,
    sentPayload: bodies.length > 0,
    android: bodies.some((body) => body.platform === 'android'),
    androidIntegrity,
  };
}
