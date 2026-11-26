/**
 * C171.2 (Workflow 9D, `a11y-audit`): the accessibility matrix of the mocked flow suite. One state
 * catalog of the web flow and the configurations each state runs in through axe:
 *
 * - by default, C171.2's CI matrix: every state in `en` at 320 CSS px light, in `ar` at 320 CSS px
 *   dark and in both pseudo-locales at 320 CSS px, all hosted; and per client step type, one run at
 *   768 CSS px and one embedded run;
 * - with `OPENVERIFY_FLOW_A11Y_CROSS_PRODUCT=1` (which CI never sets), the full cross product: every
 *   state in the five locales and both pseudo-locales, light and dark, hosted and embedded, at 320,
 *   375 and 768 CSS px (84 configurations a state), run once by the audit in shards.
 *
 * Pure data and functions, so `src/a11y-matrix.test.ts` holds it to both definitions; the states'
 * recipes (how the mocked server reaches each) are `a11y-states.ts`'.
 */

/** The switch of the full cross product; any value but `1` leaves the CI matrix. */
export const CROSS_PRODUCT_ENV = 'OPENVERIFY_FLOW_A11Y_CROSS_PRODUCT';

/** The shipped locales and the two pseudo-locales (C161.1, C161.7). */
export const MATRIX_LOCALES = ['en', 'es', 'fr', 'de', 'ar', 'en-XA', 'ar-XB'] as const;
export const MATRIX_SCHEMES = ['light', 'dark'] as const;
export const MATRIX_MODES = ['hosted', 'embedded'] as const;
/** CSS px (C171.1). */
export const MATRIX_WIDTHS = [320, 375, 768] as const;

export type MatrixLocale = (typeof MATRIX_LOCALES)[number];
export type MatrixScheme = (typeof MATRIX_SCHEMES)[number];
export type MatrixMode = (typeof MATRIX_MODES)[number];
export type MatrixWidth = (typeof MATRIX_WIDTHS)[number];

export interface MatrixConfiguration {
  readonly locale: MatrixLocale;
  readonly scheme: MatrixScheme;
  readonly mode: MatrixMode;
  readonly width: MatrixWidth;
}

/**
 * The web flow's client step types (C151.5's allowlist; `src/screens/step-registry.tsx`'s
 * `PREVIEW_PLACEHOLDER_TYPES` and `PREVIEWABLE_TYPES`, which the unit test compares).
 */
export const CLIENT_STEP_TYPES = [
  'consent',
  'screen',
  'government_id',
  'selfie',
  'document',
  'phone_otp',
  'email_otp',
  'database',
  'aamva',
  'nfc',
  'crypto_wallet',
  'database_business',
  'business_website',
  'device_handoff',
  'completion',
  'failure',
  // C238.6 (Workflow 11A, clients-connect): the share-consent screen.
  'share_consent',
] as const;

export type ClientStepType = (typeof CLIENT_STEP_TYPES)[number];

/**
 * One state of the flow: the step type it belongs to (`null` for a position or a session's end that
 * belongs to none), and whether it is that type's arrival (the state C171.2's per-type runs use).
 */
export interface A11yStateDescriptor {
  readonly id: string;
  readonly stepType: ClientStepType | null;
  readonly arrival: boolean;
}

const arrival = <Type extends ClientStepType>(stepType: Type) =>
  ({ id: `${stepType}:arrival`, stepType, arrival: true }) as const;
const of = <Id extends string>(id: Id, stepType: ClientStepType | null) =>
  ({ id, stepType, arrival: false }) as const;

/**
 * Every state the matrix opens (C171.1: each step type with its error, retry and final screens),
 * from the flow's position model (`src/flow/flow-position.ts`). Each is reached by the mocked
 * server's answers at load, so it opens alike in every locale, scheme, mode and width.
 */
export const A11Y_STATES = [
  ...CLIENT_STEP_TYPES.map(arrival),
  // Retries: the attempt after a failed one, with the server's reasons (C30.1, C50.5).
  of('government_id:retry', 'government_id'),
  of('selfie:retry', 'selfie'),
  of('document:retry', 'document'),
  of('crypto_wallet:restart', 'crypto_wallet'),
  // The one-time codes (C55): a code being entered, and the last code expired with none left.
  of('phone_otp:code-sent', 'phone_otp'),
  of('phone_otp:code-expired', 'phone_otp'),
  of('email_otp:code-sent', 'email_otp'),
  // Entered values: the values received, and the fields refused on submit (C52.3).
  of('database:received', 'database'),
  of('database:errors', 'database'),
  // A screen's own states (C148.4, C148.7).
  of('screen:conditional', 'screen'),
  of('screen:errors', 'screen'),
  // Waiting on the server for a verification (C30, C59.6).
  of('government_id:processing', 'government_id'),
  of('government_id:finalizing', 'government_id'),
  of('aamva:silent', 'aamva'),
  // C237.6 (Workflow 11A, clients-connect): the withdrawal of an accepted share, under a later screen.
  of('share_consent:withdrawable', 'share_consent'),
  // Final screens (C150.7, C158.5).
  of('completion:redirect', 'completion'),
  of('failure:contest-route', 'failure'),
  // The server's positions that are not steps (C150.5, C151.2).
  of('position:waiting', null),
  of('position:halted', null),
  // An expired inquiry, and the session-ended screens (C10, C25.8).
  of('inquiry:expired', null),
  of('session:expired', null),
  of('session:link-expired', null),
  of('session:redacted', null),
  of('session:ended', null),
] as const satisfies readonly A11yStateDescriptor[];

export type A11yStateId = (typeof A11Y_STATES)[number]['id'];

export interface MatrixRun {
  readonly state: A11yStateDescriptor;
  readonly configuration: MatrixConfiguration;
}

/** Whether `env` asks for the full cross product. */
export function crossProductRequested(env: Readonly<Record<string, string | undefined>>): boolean {
  return env[CROSS_PRODUCT_ENV] === '1';
}

/** The 84 configurations of the full cross product. */
export function crossProductConfigurations(): MatrixConfiguration[] {
  return MATRIX_LOCALES.flatMap((locale) =>
    MATRIX_SCHEMES.flatMap((scheme) =>
      MATRIX_MODES.flatMap((mode) =>
        MATRIX_WIDTHS.map((width) => ({ locale, scheme, mode, width })),
      ),
    ),
  );
}

/** C171.2's CI matrix for every state: hosted, at 320 CSS px. */
const EVERY_STATE: readonly MatrixConfiguration[] = [
  { locale: 'en', scheme: 'light', mode: 'hosted', width: 320 },
  { locale: 'ar', scheme: 'dark', mode: 'hosted', width: 320 },
  { locale: 'en-XA', scheme: 'light', mode: 'hosted', width: 320 },
  { locale: 'ar-XB', scheme: 'dark', mode: 'hosted', width: 320 },
];

/** ... and once per client step type, on its arrival: at 768 CSS px, and embedded (at 375). */
const PER_STEP_TYPE: readonly MatrixConfiguration[] = [
  { locale: 'en', scheme: 'light', mode: 'hosted', width: 768 },
  { locale: 'en', scheme: 'light', mode: 'embedded', width: 375 },
];

/** The configurations C171.2's CI matrix runs `state` in. */
export function ciConfigurations(state: A11yStateDescriptor): MatrixConfiguration[] {
  return state.arrival ? [...EVERY_STATE, ...PER_STEP_TYPE] : [...EVERY_STATE];
}

/** Every run of the matrix `env` selects, state by state. */
export function matrixRuns(
  env: Readonly<Record<string, string | undefined>>,
  states: readonly A11yStateDescriptor[] = A11Y_STATES,
): MatrixRun[] {
  const crossProduct = crossProductRequested(env);
  return states.flatMap((state) =>
    (crossProduct ? crossProductConfigurations() : ciConfigurations(state)).map(
      (configuration) => ({ state, configuration }),
    ),
  );
}

/** A run's test title: the state, then its configuration. */
export function runTitle({ state, configuration }: MatrixRun): string {
  const { locale, scheme, mode, width } = configuration;
  return `${state.id} (${locale}, ${String(width)} px, ${scheme}, ${mode})`;
}
