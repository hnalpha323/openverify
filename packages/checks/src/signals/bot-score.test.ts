import { BOT_SCORE_CONSTANTS, STRONG_AUTOMATION_ARTEFACTS } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  BOT_SCORE_RULES,
  EVIDENCE_GROUPS,
  IDENTITY_FIELD_STEP_TYPES,
  sessionArtefacts,
  sessionBotScore,
} from './bot-score.js';
import { sessionEvidence } from './evidence.js';
import type { BehaviourInput, IntegrityInput, SignalBodyInput } from './inputs.js';
import { behaviour, cleanNetwork, integrity, seededRandom, session, webBody } from './testing.js';

const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const BRANDS = [
  { brand: 'Chromium', version: '130' },
  { brand: 'Google Chrome', version: '130' },
  { brand: 'Not?A_Brand', version: '99' },
];
const HINTS = { brands: BRANDS, mobile: false, platform: 'Windows' };

/** A browser that keeps its layers consistent: Chrome on Windows in France. */
const consistent = (overrides: Partial<IntegrityInput> = {}) =>
  integrity({
    'client-hints': HINTS,
    timezone: 'Europe/Paris',
    languages: ['fr-FR', 'fr'],
    ...overrides,
  });

/** A web session in France with `screens` behaviour screens and the integrity member. */
function evidenceOf(
  options: {
    integrity?: IntegrityInput | null;
    screens?: readonly BehaviourInput[];
    screenTypes?: readonly string[];
    userAgent?: string;
    extra?: readonly SignalBodyInput[];
    environment?: 'sandbox' | 'production';
  } = {},
) {
  const screens = options.screens ?? [behaviour(), behaviour(), behaviour()];
  const bodies: SignalBodyInput[] = screens.map((aggregates, index) =>
    webBody(index + 1, {
      screenType: options.screenTypes?.[index] ?? 'form',
      behaviour: aggregates,
      ...(index === 0
        ? {
            integrity: options.integrity === undefined ? consistent() : options.integrity,
            requestHeaders: { acceptLanguages: ['fr-FR', 'fr'], clientHints: HINTS },
          }
        : {}),
    }),
  );
  return sessionEvidence(
    session('iqse_1', {
      network: cleanNetwork({ countryCode: 'FR' }),
      bodies: [...bodies, ...(options.extra ?? [])],
      ...(options.userAgent === undefined ? {} : { userAgent: options.userAgent }),
    }),
    options.environment ?? 'production',
  );
}

/** C94.8: voice control: dictated text, spoken clicks with no pointer travel, quick screens. */
const VOICE_CONTROL = Array.from({ length: 4 }, () =>
  behaviour({
    'typing-cadence': 'uniform',
    'correction-count': 0,
    'pointer-types': ['mouse'],
    'pointer-before-click': 'false',
    'dwell-seconds': 1.5,
    'input-event-count': 8,
    'autofill-count': 1,
    'paste-count': 1,
    'focus-loss-count': 3,
    'hidden-seconds': 100,
  }),
);
const VOICE_TYPES = ['form', 'phone_otp', 'email_otp', 'form'];

/** C94.8: keyboard only with a password manager: no pointer, autofilled, quick screens. */
const KEYBOARD_ONLY = Array.from({ length: 4 }, () =>
  behaviour({
    'pointer-types': [],
    'pointer-before-click': 'n/a',
    'dwell-seconds': 1,
    'autofill-count': 2,
    'focus-loss-count': 3,
  }),
);

describe('BOT_SCORE_RULES (C94.8)', () => {
  it('holds the rules, strong first, each weighted by a registry constant', () => {
    expect(BOT_SCORE_RULES.map(({ reason, strength }) => `${strength}:${reason}`)).toEqual([
      'strong:webdriver',
      'strong:driver_globals',
      'strong:ua_headless_marker',
      'strong:untrusted_events',
      'medium:zero_window_with_focus',
      'medium:plugins_inconsistent',
      'medium:mime_inconsistent',
      'medium:native_function_tampered',
      'medium:android_debugger_connected',
      'medium:ua_client_hints_mismatch',
      'medium:language_mismatch',
      'medium:timezone_country_mismatch',
      'medium:uniform_typing_cadence',
      'medium:fast_screens',
      'medium:no_pointer_travel',
      'weak:paste_into_identity_field',
      'weak:autofill_into_identity_field',
      'weak:many_focus_losses',
      'weak:long_hidden_periods',
      'weak:android_app_debuggable',
    ]);
    for (const rule of BOT_SCORE_RULES) {
      expect(Object.keys(BOT_SCORE_CONSTANTS)).toContain(rule.weight);
      expect(EVIDENCE_GROUPS).toContain(rule.group);
    }
    expect(
      BOT_SCORE_RULES.filter((rule) => rule.strength === 'strong').map((rule) => rule.reason),
    ).toEqual([...STRONG_AUTOMATION_ARTEFACTS]);
  });

  const WEAK_CUT_OFFS = ['many-focus-losses-min', 'long-hidden-seconds-min'] as const;

  it('keeps its two weak cut-offs provisional, with their basis', () => {
    expect(
      Object.fromEntries(WEAK_CUT_OFFS.map((key) => [key, BOT_SCORE_CONSTANTS[key]?.value])),
    ).toEqual({ 'many-focus-losses-min': 10, 'long-hidden-seconds-min': 300 });
    for (const key of WEAK_CUT_OFFS) {
      expect(BOT_SCORE_CONSTANTS[key]?.basis).toBe('provisional');
      expect(BOT_SCORE_CONSTANTS[key]?.source).toMatch(/unmeasured/);
    }
  });

  it('reads paste and autofill only on screens that hold identity fields', () => {
    expect(IDENTITY_FIELD_STEP_TYPES).toEqual([
      'form',
      'phone_otp',
      'email_otp',
      'database',
      'aamva',
      'database_business',
    ]);
  });
});

describe('sessionBotScore (C94.8)', () => {
  it('golden: a consistent human with every group collected: 0, no artefact found, capped at 0.5', () => {
    expect(sessionBotScore(evidenceOf())).toEqual({
      score: 0,
      confidence: 0.5,
      reasons: ['no_artefact_found'],
      artefacts: [],
      groups: ['integrity', 'cross-layer', 'typing', 'pointer', 'screens'],
    });
  });

  it('golden: webdriver sets the floor of 90', () => {
    expect(sessionBotScore(evidenceOf({ integrity: consistent({ webdriver: true }) }))).toEqual({
      score: 90,
      confidence: 0.6667,
      reasons: ['webdriver'],
      artefacts: ['webdriver'],
      groups: ['integrity', 'cross-layer', 'typing', 'pointer', 'screens'],
    });
  });

  it('golden: strong artefacts with medium evidence reach 100', () => {
    const result = sessionBotScore(
      evidenceOf({
        integrity: consistent({ 'driver-globals': ['selenium'], 'ua-headless-marker': true }),
        screens: [1, 2, 3].map(() =>
          behaviour({ 'typing-cadence': 'uniform', 'correction-count': 0 }),
        ),
      }),
    );
    expect(result).toMatchObject({
      score: 100,
      confidence: 1,
      reasons: ['driver_globals', 'ua_headless_marker', 'uniform_typing_cadence'],
      artefacts: ['driver_globals', 'ua_headless_marker'],
    });
  });

  it('golden: a headless marker in the request user agent counts beside the page flag', () => {
    const headless =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36';
    expect(sessionBotScore(evidenceOf({ userAgent: headless }))).toMatchObject({
      score: 90,
      artefacts: ['ua_headless_marker'],
    });
  });

  it('golden: untrusted input events are strong', () => {
    expect(
      sessionBotScore(evidenceOf({ integrity: consistent({ 'untrusted-event-count': 2 }) })),
    ).toMatchObject({ score: 90, reasons: ['untrusted_events'], artefacts: ['untrusted_events'] });
  });

  it("golden: Chromium's hints under a Safari user agent are medium evidence (25)", () => {
    expect(sessionBotScore(evidenceOf({ userAgent: SAFARI_MAC }))).toMatchObject({
      score: 25,
      confidence: 0.6429,
      reasons: ['ua_client_hints_mismatch'],
      artefacts: [],
    });
  });

  it('golden: each medium integrity artefact adds 10', () => {
    expect(
      sessionBotScore(
        evidenceOf({
          integrity: consistent({
            'zero-window-with-focus': true,
            'plugins-inconsistent': true,
            'mime-inconsistent': true,
            'native-function-tampered': true,
          }),
        }),
      ),
    ).toMatchObject({
      score: 40,
      reasons: [
        'zero_window_with_focus',
        'plugins_inconsistent',
        'mime_inconsistent',
        'native_function_tampered',
      ],
    });
  });

  it('golden: weak evidence alone stays in the low band, with no artefact found', () => {
    expect(
      sessionBotScore(
        evidenceOf({
          integrity: null,
          screens: [1, 2, 3].map(() => behaviour({ 'focus-loss-count': 4 })),
        }),
      ),
    ).toEqual({
      score: 5,
      confidence: 0.5,
      reasons: ['no_artefact_found', 'many_focus_losses'],
      artefacts: [],
      groups: ['cross-layer', 'typing', 'pointer', 'screens'],
    });
  });

  it('golden: a sparse payload gives a low score with a confidence of its collected share only', () => {
    expect(
      sessionBotScore(
        evidenceOf({
          integrity: null,
          screens: [
            behaviour({
              'typing-cadence': 'insufficient',
              'pointer-types': [],
              'pointer-before-click': 'n/a',
            }),
          ],
        }),
      ),
    ).toMatchObject({ score: 0, confidence: 0.4, groups: ['cross-layer', 'screens'] });
  });

  it('golden: paste and autofill count only on an identity screen', () => {
    const pasted = [1, 2, 3].map(() => behaviour({ 'paste-count': 1, 'autofill-count': 1 }));
    expect(
      sessionBotScore(evidenceOf({ screens: pasted, screenTypes: ['selfie', 'selfie', 'selfie'] }))
        ?.score,
    ).toBe(0);
    expect(sessionBotScore(evidenceOf({ screens: pasted }))).toMatchObject({
      score: 10,
      reasons: ['no_artefact_found', 'paste_into_identity_field', 'autofill_into_identity_field'],
    });
  });

  it('golden: long hidden periods add a weak 5', () => {
    expect(
      sessionBotScore(
        evidenceOf({ screens: [1, 2, 3].map(() => behaviour({ 'hidden-seconds': 100 })) }),
      ),
    ).toMatchObject({ score: 5, reasons: ['no_artefact_found', 'long_hidden_periods'] });
  });

  it('golden: fast screens count only when every screen with input was faster than the floor', () => {
    const quick = behaviour({ 'dwell-seconds': 1 });
    expect(sessionBotScore(evidenceOf({ screens: [quick, quick, quick] }))).toMatchObject({
      score: 25,
      reasons: ['fast_screens'],
    });
    expect(
      sessionBotScore(evidenceOf({ screens: [quick, quick, behaviour({ 'dwell-seconds': 2 })] }))
        ?.score,
    ).toBe(0);
    const reading = behaviour({ 'dwell-seconds': 1, 'input-event-count': 0 });
    expect(
      sessionBotScore(evidenceOf({ screens: [reading, behaviour(), behaviour()] }))?.score,
    ).toBe(0);
  });

  it('golden: a mouse that never travelled before a click is medium; touch or any travel is not', () => {
    const still = behaviour({ 'pointer-before-click': 'false' });
    expect(sessionBotScore(evidenceOf({ screens: [still, still, still] }))).toMatchObject({
      score: 25,
      reasons: ['no_pointer_travel'],
    });
    expect(sessionBotScore(evidenceOf({ screens: [still, still, behaviour()] }))?.score).toBe(0);
    const touch = behaviour({
      'pointer-before-click': 'false',
      'pointer-types': ['mouse', 'touch'],
    });
    expect(sessionBotScore(evidenceOf({ screens: [touch, touch, touch] }))?.score).toBe(0);
  });

  it('golden: a uniform cadence counts only with no correction anywhere', () => {
    const uniform = behaviour({ 'typing-cadence': 'uniform', 'correction-count': 0 });
    expect(sessionBotScore(evidenceOf({ screens: [uniform, uniform, uniform] }))).toMatchObject({
      score: 25,
      reasons: ['uniform_typing_cadence'],
    });
    expect(sessionBotScore(evidenceOf({ screens: [uniform, uniform, behaviour()] }))?.score).toBe(
      0,
    );
  });

  it('golden: the voice-control profile stays below 70 (P24)', () => {
    expect(
      sessionBotScore(evidenceOf({ screens: VOICE_CONTROL, screenTypes: VOICE_TYPES })),
    ).toEqual({
      score: 60,
      confidence: 0.1429,
      reasons: [
        'uniform_typing_cadence',
        'fast_screens',
        'no_pointer_travel',
        'paste_into_identity_field',
        'autofill_into_identity_field',
        'many_focus_losses',
        'long_hidden_periods',
      ],
      artefacts: [],
      groups: ['integrity', 'cross-layer', 'typing', 'pointer', 'screens'],
    });
  });

  it('golden: the keyboard-only profile stays below 70 (P24)', () => {
    expect(sessionBotScore(evidenceOf({ screens: KEYBOARD_ONLY }))).toEqual({
      score: 35,
      confidence: 0.45,
      reasons: ['fast_screens', 'autofill_into_identity_field', 'many_focus_losses'],
      artefacts: [],
      groups: ['integrity', 'cross-layer', 'typing', 'screens'],
    });
  });

  it('golden: the sandbox outcomes, in a sandbox only (C90.9)', () => {
    const bot = evidenceOf({
      extra: [webBody(9, { sandboxOutcome: 'bot' })],
      environment: 'sandbox',
    });
    expect(sessionBotScore(bot)).toMatchObject({
      score: 95,
      confidence: 1,
      reasons: ['sandbox_outcome'],
    });
    const human = evidenceOf({
      integrity: consistent({ webdriver: true }),
      extra: [webBody(9, { sandboxOutcome: 'human' })],
      environment: 'sandbox',
    });
    expect(sessionBotScore(human)).toMatchObject({
      score: 5,
      confidence: 1,
      reasons: ['sandbox_outcome'],
      artefacts: ['webdriver'],
    });
    expect(
      sessionBotScore(evidenceOf({ extra: [webBody(9, { sandboxOutcome: 'bot' })] }))?.score,
    ).toBe(0);
  });

  it('answers null when the payload carries nothing the score reads (an Android body without its integrity member)', () => {
    const android = sessionEvidence(
      session('iqse_1', {
        userAgent: 'OpenVerify-Android/0.1.0',
        bodies: [
          {
            screen: 'consent',
            screenType: 'consent',
            sequence: 1,
            platform: 'android',
            deviceClass: 'smartphone',
          },
        ],
      }),
      'production',
    );
    expect(sessionBotScore(android)).toBeNull();
    expect(sessionArtefacts(android)).toBeNull();
  });
});

/**
 * Workflow 10B Stage 1a amendment 17 (Phase 7 C94.7, C94.8 amended): the Android debugger facts.
 * `inquiry/bot_score` reads `android-integrity` through its integrity group: a connected debugger is
 * medium evidence (`medium-evidence-min`), a debuggable host app weak (`weak-evidence-max`), never
 * strong, so neither alone reaches the strong band (P24); `automation_artefact_count` counts a
 * connected debugger.
 */
describe('the Android debugger facts (C94.7, C94.8 amended)', () => {
  const androidEvidence = (debuggerConnected: boolean, appDebuggable: boolean) =>
    sessionEvidence(
      session('iqse_1', {
        userAgent: 'OpenVerify-Android/0.1.0',
        bodies: [
          {
            screen: 'consent',
            screenType: 'consent',
            sequence: 1,
            platform: 'android',
            androidIntegrity: {
              'debugger-connected': debuggerConnected,
              'app-debuggable': appDebuggable,
            },
            deviceClass: 'smartphone',
          },
        ],
      }),
      'production',
    );
  const groupShare = 1 / EVIDENCE_GROUPS.length;

  it('golden: neither fact reads the low band with no_artefact_found and its capped confidence', () => {
    expect(sessionBotScore(androidEvidence(false, false))).toEqual({
      score: 0,
      confidence: Math.min(
        BOT_SCORE_CONSTANTS['low-score-confidence-cap']?.value as number,
        groupShare,
      ),
      reasons: ['no_artefact_found'],
      artefacts: [],
      groups: ['integrity'],
    });
    expect(sessionArtefacts(androidEvidence(false, false))).toEqual([]);
  });

  it('golden: a connected debugger is medium evidence and an automation artefact, never strong', () => {
    const score = sessionBotScore(androidEvidence(true, false));
    expect(score).toMatchObject({
      score: BOT_SCORE_CONSTANTS['medium-evidence-min']?.value,
      reasons: ['android_debugger_connected'],
      artefacts: ['android_debugger_connected'],
    });
    expect(score?.score ?? 100).toBeLessThan(BOT_SCORE_CONSTANTS['strong-band']?.value as number);
    expect(sessionArtefacts(androidEvidence(true, false))).toEqual(['android_debugger_connected']);
  });

  it('golden: a debuggable host app is weak evidence in the low band', () => {
    expect(sessionBotScore(androidEvidence(false, true))).toMatchObject({
      score: BOT_SCORE_CONSTANTS['weak-evidence-max']?.value,
      reasons: ['no_artefact_found', 'android_app_debuggable'],
    });
    expect(sessionArtefacts(androidEvidence(false, true))).toEqual([]);
  });

  it('adds both, under the medium and weak cap, and never answers human', () => {
    const both = sessionBotScore(androidEvidence(true, true));
    expect(both?.score).toBe(
      (BOT_SCORE_CONSTANTS['medium-evidence-min']?.value as number) +
        (BOT_SCORE_CONSTANTS['weak-evidence-max']?.value as number),
    );
    expect(both?.reasons).toEqual(['android_debugger_connected', 'android_app_debuggable']);
    expect(both?.reasons).not.toContain('sandbox_outcome');
  });
});

describe('the bot score properties (C94.8, P24, H06)', () => {
  const pick = <Value>(random: () => number, values: readonly Value[]): Value =>
    values[Math.floor(random() * values.length)] as Value;

  function randomScreen(random: () => number): BehaviourInput {
    return behaviour({
      'paste-count': pick(random, [0, 0, 1, 5]),
      'drop-count': pick(random, [0, 1]),
      'autofill-count': pick(random, [0, 0, 3]),
      'correction-count': pick(random, [0, 0, 2]),
      'focus-loss-count': pick(random, [0, 1, 6, 20]),
      'input-event-count': pick(random, [0, 5, 30]),
      'dwell-seconds': pick(random, [0.5, 1, 1.9, 2, 40]),
      'hidden-seconds': pick(random, [0, 30, 400]),
      'typing-cadence': pick(random, ['uniform', 'variable', 'insufficient'] as const),
      'pointer-types': pick(random, [[], ['mouse'], ['touch'], ['mouse', 'pen']] as const),
      'pointer-before-click': pick(random, ['true', 'false', 'n/a'] as const),
    });
  }

  function randomIntegrity(random: () => number, strong: boolean): IntegrityInput {
    return integrity({
      webdriver: strong && random() < 0.5,
      'driver-globals': strong && random() < 0.5 ? ['cypress'] : [],
      'ua-headless-marker': strong && random() < 0.5,
      'untrusted-event-count': strong ? pick(random, [1, 7]) : 0,
      'zero-window-with-focus': random() < 0.5,
      'plugins-inconsistent': random() < 0.5,
      'mime-inconsistent': random() < 0.5,
      'native-function-tampered': random() < 0.5,
      'client-hints': random() < 0.5 ? HINTS : { ...HINTS, platform: 'macOS' },
      timezone: pick(random, ['Europe/Paris', 'Asia/Tokyo', null]),
      languages: pick(random, [['fr'], ['de'], []]),
    });
  }

  it('medium and weak evidence never reach 70; the score stays within 0..60', () => {
    const random = seededRandom('bot-score-medium-weak-cap');
    for (let run = 0; run < 400; run += 1) {
      const screens = Array.from({ length: 1 + Math.floor(random() * 5) }, () =>
        randomScreen(random),
      );
      const result = sessionBotScore(
        evidenceOf({
          integrity: randomIntegrity(random, false),
          screens,
          screenTypes: screens.map(() => pick(random, ['form', 'selfie', 'phone_otp'])),
          userAgent: pick(random, [SAFARI_MAC, session('x').userAgent ?? '']),
        }),
      );
      expect(result).not.toBeNull();
      expect(result?.score).toBeLessThanOrEqual(
        Number(BOT_SCORE_CONSTANTS['medium-weak-cap']?.value),
      );
      expect(result?.artefacts).toEqual([]);
    }
  });

  it('a strong artefact always reaches the floor of 90', () => {
    const random = seededRandom('bot-score-strong-floor');
    for (let run = 0; run < 200; run += 1) {
      const result = sessionBotScore(
        evidenceOf({
          integrity: randomIntegrity(random, true),
          screens: [randomScreen(random), randomScreen(random)],
        }),
      );
      expect(result?.score).toBeGreaterThanOrEqual(90);
      expect(result?.score).toBeLessThanOrEqual(100);
      expect(result?.artefacts.length).toBeGreaterThan(0);
    }
  });

  it('a score in the low band never carries more than the 0.5 cap, and says no artefact was found', () => {
    const random = seededRandom('bot-score-low-band');
    let lowBand = 0;
    for (let run = 0; run < 400; run += 1) {
      const result = sessionBotScore(
        evidenceOf({
          integrity: random() < 0.5 ? consistent() : null,
          screens: Array.from({ length: 1 + Math.floor(random() * 4) }, () => randomScreen(random)),
        }),
      );
      if (result?.reasons.includes('no_artefact_found')) {
        lowBand += 1;
        expect(result.confidence).toBeLessThanOrEqual(0.5);
        expect(result.score).toBeLessThanOrEqual(20);
      }
    }
    expect(lowBand).toBeGreaterThan(20);
  });
});

describe('sessionArtefacts (C94.3)', () => {
  it('lists the distinct strong artefacts in the registry order', () => {
    expect(
      sessionArtefacts(
        evidenceOf({
          integrity: consistent({
            'untrusted-event-count': 1,
            webdriver: true,
            'zero-window-with-focus': true,
          }),
        }),
      ),
    ).toEqual(['webdriver', 'untrusted_events']);
    expect(sessionArtefacts(evidenceOf())).toEqual([]);
    expect(sessionArtefacts(evidenceOf({ integrity: null }))).toBeNull();
  });
});
