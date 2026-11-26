/**
 * C171.2 (Workflow 9D, `a11y-audit`): how the mocked server reaches each state of
 * `a11y-matrix.ts`'s catalog, and how a run opens it hosted or embedded in its configuration. A
 * state is reached by the session the mock serves at load (the server's position, the step's client
 * view, the verifications and their reasons), so it opens alike in every locale; the few that need
 * an action take it through attributes, never through localised words. Every value is synthetic.
 */
import { expect, type FrameLocator, type Page } from '@playwright/test';
import { pseudoLocalize } from '../../../../packages/flow-spec/src/pseudo-locale';
import { CATALOGS } from '../../src/i18n/catalogs';
import { BUILTIN_VARIANT_ATTRIBUTE } from '../../src/theme/apply';
import type { A11yStateId, MatrixConfiguration, MatrixLocale } from './a11y-matrix';
import { embedPageUrl, installForEmbedding, serveEmbedOrigins, startEmbedPage } from './mock-embed';
import {
  INQUIRY_ID,
  MockFlowApi,
  PHASE5_CONSENT_GIVEN,
  SESSION_TOKEN,
  defaultFlow,
  flowLink,
  phase5Flow,
  type Verification,
} from './mock-flow-api';
import {
  startMockFlowServer,
  type RunningFlowServer,
  type RunningPageServer,
} from './mock-flow-server';
import { at, serve, type ServedPosition } from './mock-flow-renderer';
import { PSEUDO_BASE_LANGUAGE, pseudoCopy } from './pseudo-locale';
import { DONE, ON_EVERY_KIND } from './screens';

/** Where a state's controls are: the page when hosted, the flow's frame when embedded. */
export type Surface = Page | FrameLocator;

interface StateRecipe {
  /** The session the mock serves at load. */
  readonly served?: ServedPosition;
  /** The rest of the mock: the flow, the consent, the verifications, a session's end. */
  readonly configure?: (mock: MockFlowApi) => void;
  /** The heading in English, checked on the `en` runs. */
  readonly heading: string;
  /** What reaches the state from its load, through attributes only. */
  readonly reach?: (surface: Surface) => Promise<void>;
  /** What shows, whatever the language, once the state is drawn. */
  readonly settled?: (surface: Surface) => Promise<void>;
}

type Step = Readonly<Record<string, unknown>> & { readonly id: string; readonly type: string };

const VERIFICATION_ID = 'ver_01M5CK16P0D13FXHZSS4TCFB00';
const MOBILE = '+12025550143';
const REDIRECT = 'https://shop.example.com/verified?inquiry-id=inq_01M5CJXHG07XPHF3HRM6NREDH7';
/** A synthetic person (C178): fictional values only. */
const PERSON = {
  name_first: 'Sam',
  name_last: 'Example',
  birthdate: '1990-01-01',
  address_country_code: 'US',
};

const STEPS = {
  consent: {
    id: 'consent',
    type: 'consent',
    textKeys: ['consent.biometric', 'consent.processing'],
    required: true,
  },
  government_id: {
    id: 'id_card',
    type: 'government_id',
    sides: 'both',
    maxAttempts: 3,
    captureMethods: ['upload', 'camera'],
  },
  selfie: { id: 'face', type: 'selfie', poses: ['center'], liveness: 'passive', maxAttempts: 3 },
  document: {
    id: 'proof',
    type: 'document',
    documentTypes: ['utility_bill'],
    captureMethods: ['upload', 'camera'],
    maxAttempts: 3,
  },
  phone_otp: { id: 'phone', type: 'phone_otp', allowedCountries: ['US', 'GB'] },
  email_otp: { id: 'email', type: 'email_otp' },
  database: {
    id: 'records',
    type: 'database',
    fields: ['name_first', 'name_last', 'address_country_code', 'birthdate'],
    requiredFields: ['birthdate'],
    maxAttempts: 1,
  },
  aamva: { id: 'licence', type: 'aamva', source: 'form' },
  crypto_wallet: {
    id: 'wallet',
    type: 'crypto_wallet',
    chains: ['eip155:1'],
    signing: ['wallet', 'paste'],
    maxAttempts: 3,
  },
  database_business: { id: 'business', type: 'database_business' },
  business_website: { id: 'website', type: 'business_website' },
  nfc: { id: 'chip', type: 'nfc', androidOnly: true },
  device_handoff: { id: 'device_handoff', type: 'device_handoff' },
  completion: { id: 'done', type: 'completion' },
  failure: { id: 'refused', type: 'failure' },
  // C238.3 (Workflow 11A, clients-connect): a source-side client view as the server composes it, in
  // English whatever the run's locale (its paragraphs carry their own language); synthetic digests,
  // since no state here accepts.
  share_consent: {
    id: 'share_back',
    type: 'share_consent',
    side: 'source',
    recipientName: 'Example Partner',
    sourceName: 'Example Source',
    categories: ['identity-fields', 'biometric', 'check-results'],
    text: {
      locale: 'en',
      body: 'Example Source asks for your agreement to share the details it verified about you with Example Partner.\n\nTo withdraw your agreement, email privacy@example.com.',
      sha256: 'a'.repeat(64),
      keys: ['share.consent.source'],
    },
    biometric: {
      body: 'I agree that Example Source shares my biometric data with Example Partner.',
      sha256: 'b'.repeat(64),
    },
  },
} as const satisfies Record<string, Step>;

/** The flow at `step`, the server serving it: as `step-matrix.spec.ts` opened each step type. */
function atStep(step: Step, extra: Partial<ServedPosition> = {}): ServedPosition {
  const ended = step.type === 'completion' || step.type === 'failure';
  return {
    position: at(step.id, ended ? 'ended' : 'active'),
    step,
    ...(step.type === 'failure' ? { inquiryStatus: 'failed' } : {}),
    ...(step.type === 'completion' ? { inquiryStatus: 'completed' } : {}),
    ...extra,
  };
}

/** The mock as `step-matrix.spec.ts` set it for `step`: a production session past the consent. */
function phase5(step: Step, more?: (mock: MockFlowApi) => void) {
  return (mock: MockFlowApi) => {
    mock.flow = phase5Flow(
      `matrix-${step.type}`,
      ...(step.type === 'consent' ? [] : [step as never]),
    );
    mock.environmentKind = 'production';
    if (step.type === 'consent') mock.consent = null;
    more?.(mock);
  };
}

function attempt(
  mock: MockFlowApi,
  type: Verification['type'],
  rest: Omit<Verification, 'type' | 'id'>,
): void {
  mock.verifications.push({ type, id: VERIFICATION_ID, ...rest });
}

const visible =
  (pick: (surface: Surface) => ReturnType<Surface['locator']>) => async (surface: Surface) => {
    await expect(pick(surface).first()).toBeVisible();
  };

const alertShown = visible((surface) => surface.locator('[role="alert"]'));
const codeField = visible((surface) => surface.locator('input[autocomplete="one-time-code"]'));

/** A screen's own copy beside every built-in message, so `es`, `fr` and `de` fall back as C162.5 says. */
const SCREEN_LOCALES = { enabled: ['en', 'es', 'fr', 'de', 'ar'], default: 'en' } as const;

const handoff = (mock: MockFlowApi) => {
  const flow = defaultFlow();
  const [consent, ...rest] = flow.steps;
  flow.steps = [consent ?? {}, { ...STEPS.device_handoff }, ...rest];
  mock.flow = flow;
  mock.handoff = { 'step-id': 'device_handoff', state: 'pending' };
  mock.handoffAnswers.issue = {
    status: 201,
    body: {
      id: 'hnd_01M5CK16P0D13FXHZSS4TCFBVH',
      method: 'qr',
      'expires-at': new Date(Date.now() + 300_000).toISOString(),
      'url-fragment': `#inquiry-id=${INQUIRY_ID}&handoff-token=ovh_${'E2eSyntheticHandoffToken'.padEnd(43, 'x')}`,
    },
  };
  mock.handoffAnswers.current = {
    status: 200,
    body: { status: 'issued', 'redeemed-at': null, 'os-name': null, 'browser-name': null },
  };
};

const ended =
  (status: MockFlowApi['sessionStatus'], reason: string | null = null) =>
  (mock: MockFlowApi) => {
    mock.sessionStatus = status;
    mock.cancelReason = reason;
  };

/** Every state of the catalog, reached. */
export const STATE_RECIPES = {
  'consent:arrival': {
    served: atStep(STEPS.consent),
    configure: phase5(STEPS.consent),
    heading: 'Consent to use your biometric data',
  },
  'screen:arrival': {
    served: { ...ON_EVERY_KIND, locales: SCREEN_LOCALES },
    heading: 'About you',
  },
  'government_id:arrival': {
    served: atStep(STEPS.government_id),
    configure: phase5(STEPS.government_id),
    heading: 'Photograph your ID',
  },
  'selfie:arrival': {
    served: atStep(STEPS.selfie),
    configure: phase5(STEPS.selfie),
    heading: 'Take a selfie',
  },
  'document:arrival': {
    served: atStep(STEPS.document),
    configure: phase5(STEPS.document),
    heading: 'Upload a document',
  },
  'phone_otp:arrival': {
    served: atStep(STEPS.phone_otp),
    configure: phase5(STEPS.phone_otp),
    heading: 'Confirm your phone number',
  },
  'email_otp:arrival': {
    served: atStep(STEPS.email_otp),
    configure: phase5(STEPS.email_otp),
    heading: 'Confirm your email address',
  },
  'database:arrival': {
    served: atStep(STEPS.database),
    configure: phase5(STEPS.database),
    heading: 'Enter your details',
  },
  'aamva:arrival': {
    served: atStep(STEPS.aamva),
    configure: phase5(STEPS.aamva),
    heading: 'Enter your driver’s license details',
  },
  // C207.10 (Workflow 10C, api-nfc): the nfc screen in a browser, in the state that offers "use
  // another way" (the step's client view with `fallbackAvailable`).
  'nfc:arrival': {
    served: atStep({ ...STEPS.nfc, fallbackAvailable: true }),
    configure: phase5(STEPS.government_id),
    heading: 'This step needs the organization’s app',
    settled: visible((surface) => surface.locator('main button')),
  },
  // C238.6 (Workflow 11A, clients-connect): the share-consent screen, with its biometric box.
  'share_consent:arrival': {
    served: atStep(STEPS.share_consent),
    configure: phase5(STEPS.government_id),
    heading: 'Share your verified details with Example Partner',
    settled: visible((surface) => surface.locator('main input[type="checkbox"]')),
  },
  // C237.6: the withdrawal of an accepted share, under the completion screen.
  'share_consent:withdrawable': {
    served: atStep(STEPS.completion, {
      'withdrawable-share-consents': [
        { 'step-id': 'share_back', side: 'source', 'recipient-name': 'Example Partner' },
      ],
    } as Partial<ServedPosition>),
    configure: phase5(STEPS.government_id),
    heading: 'Verification submitted',
    settled: visible((surface) => surface.locator('[data-share-consent-withdraw]')),
  },
  'crypto_wallet:arrival': {
    served: atStep(STEPS.crypto_wallet),
    configure: phase5(STEPS.crypto_wallet),
    heading: 'Prove that you control your crypto wallet',
  },
  'database_business:arrival': {
    served: atStep(STEPS.database_business),
    configure: phase5(STEPS.database_business),
    heading: 'Tell us about your business',
  },
  'business_website:arrival': {
    served: atStep(STEPS.business_website),
    configure: phase5(STEPS.business_website),
    heading: 'Enter your business website',
  },
  'device_handoff:arrival': {
    served: atStep(STEPS.device_handoff),
    configure: handoff,
    heading: 'Continue on your phone',
    settled: visible((surface) => surface.locator('svg[data-icon]')),
  },
  'completion:arrival': {
    served: atStep(STEPS.completion),
    configure: phase5(STEPS.completion),
    heading: 'Verification submitted',
  },
  'failure:arrival': {
    served: atStep(STEPS.failure),
    configure: phase5(STEPS.failure),
    heading: 'Verification not completed',
  },
  'government_id:retry': {
    served: atStep(STEPS.government_id),
    configure: phase5(STEPS.government_id, (mock) => {
      attempt(mock, 'verification/government-id', {
        status: 'failed',
        hints: [{ name: 'id_glare_detection', reasons: ['glare_present'] }],
      });
    }),
    heading: 'Photograph your ID',
    settled: alertShown,
  },
  'selfie:retry': {
    served: atStep(STEPS.selfie),
    configure: phase5(STEPS.selfie, (mock) => {
      attempt(mock, 'verification/selfie', {
        status: 'failed',
        hints: [{ name: 'selfie_image_quality_detection', reasons: ['image_too_dark'] }],
      });
    }),
    heading: 'Take a selfie',
    settled: alertShown,
  },
  'document:retry': {
    served: atStep(STEPS.document),
    configure: phase5(STEPS.document, (mock) => {
      attempt(mock, 'verification/document', {
        status: 'failed',
        hints: [{ name: 'document_recency_detection', reasons: ['document_too_old'] }],
      });
    }),
    heading: 'Upload a document',
    settled: alertShown,
  },
  'crypto_wallet:restart': {
    served: atStep(STEPS.crypto_wallet),
    configure: phase5(STEPS.crypto_wallet, (mock) => {
      attempt(mock, 'verification/crypto-wallet', { status: 'canceled', hints: [] });
    }),
    heading: 'Prove that you control your crypto wallet',
    settled: alertShown,
  },
  'phone_otp:code-sent': {
    served: atStep(STEPS.phone_otp),
    configure: phase5(STEPS.phone_otp, (mock) => {
      attempt(mock, 'verification/phone-number', {
        status: 'initiated',
        hints: [],
        sends: 1,
        otp: { destination: MOBILE, sentAtMs: Date.now(), attemptsRemaining: 5 },
      });
    }),
    heading: 'Enter the code',
    settled: codeField,
  },
  'phone_otp:code-expired': {
    served: atStep(STEPS.phone_otp),
    configure: phase5(STEPS.phone_otp, (mock) => {
      attempt(mock, 'verification/phone-number', {
        status: 'initiated',
        hints: [],
        sends: 5,
        otp: { destination: MOBILE, sentAtMs: Date.now() - 660_000, attemptsRemaining: 5 },
      });
    }),
    heading: 'Enter the code',
    settled: alertShown,
  },
  'email_otp:code-sent': {
    served: atStep(STEPS.email_otp),
    configure: phase5(STEPS.email_otp, (mock) => {
      attempt(mock, 'verification/email-address', {
        status: 'initiated',
        hints: [],
        sends: 1,
        otp: { destination: 'sam@example.com', sentAtMs: Date.now(), attemptsRemaining: 5 },
      });
    }),
    heading: 'Enter the code',
    settled: codeField,
  },
  'database:received': {
    served: atStep(STEPS.database),
    configure: phase5(STEPS.database, (mock) => {
      attempt(mock, 'verification/database', {
        status: 'initiated',
        hints: [],
        values: { ...PERSON },
        inputsReceived: true,
      });
    }),
    heading: 'Enter your details',
  },
  'database:errors': {
    served: atStep(STEPS.database),
    configure: phase5(STEPS.database),
    heading: 'Enter your details',
    reach: async (surface) => {
      await surface.locator('form button[type="submit"]').first().click();
    },
    settled: alertShown,
  },
  'screen:conditional': {
    served: { ...ON_EVERY_KIND, locales: SCREEN_LOCALES },
    heading: 'About you',
    reach: async (surface) => {
      await surface.locator('input[type="radio"][value="yes"]').check();
    },
    settled: visible((surface) => surface.locator('input[name="pet_name"]')),
  },
  'screen:errors': {
    served: { ...ON_EVERY_KIND, locales: SCREEN_LOCALES },
    heading: 'About you',
    reach: async (surface) => {
      await surface.locator('input[type="radio"][value="yes"]').check();
      await surface.locator('button[type="submit"][name="button"][value=""]').click();
    },
    settled: alertShown,
  },
  'government_id:processing': {
    served: atStep(STEPS.government_id),
    configure: phase5(STEPS.government_id, (mock) => {
      attempt(mock, 'verification/government-id', { status: 'submitted', hints: [] });
      mock.pendingPolls = 100_000;
    }),
    heading: 'Checking your photos',
  },
  'government_id:finalizing': {
    served: atStep(STEPS.government_id),
    configure: phase5(STEPS.government_id, (mock) => {
      attempt(mock, 'verification/government-id', { status: 'failed', hints: [] });
    }),
    heading: 'Finishing your verification',
  },
  'aamva:silent': {
    served: atStep({ id: 'licence', type: 'aamva', source: 'government_id' }),
    configure: phase5({ id: 'licence', type: 'aamva', source: 'government_id' }),
    heading: 'Checking your license details',
  },
  'completion:redirect': {
    served: { ...DONE, completion: { 'redirect-url': REDIRECT } },
    heading: 'Verification submitted',
  },
  'failure:contest-route': {
    served: {
      position: at('refused', 'ended', 'about'),
      step: STEPS.failure,
      'decision-contest-route': {
        url: 'https://help.example.com/review',
        host: 'help.example.com',
        contact: 'reviews@example.com',
      },
      inquiryStatus: 'failed',
    },
    heading: 'Verification not completed',
  },
  'position:waiting': {
    served: { position: at('age_route', 'waiting', 'about') },
    heading: 'One moment',
  },
  'position:halted': {
    served: { position: at('again', 'halted', 'about') },
    heading: 'This verification cannot continue',
  },
  'inquiry:expired': {
    served: { ...atStep(STEPS.government_id), inquiryStatus: 'expired' },
    configure: phase5(STEPS.government_id),
    heading: 'This verification link has expired',
  },
  'session:expired': {
    configure: ended('expired'),
    heading: 'Your verification session has expired',
  },
  'session:link-expired': {
    configure: ended('canceled', 'inquiry_expired'),
    heading: 'This verification link has expired',
  },
  'session:redacted': {
    configure: ended('canceled', 'inquiry_redacted'),
    heading: 'This verification is no longer available',
  },
  'session:ended': {
    configure: ended('canceled', 'inquiry_finished'),
    heading: 'This verification session has ended',
  },
} as const satisfies Record<A11yStateId, StateRecipe>;

/** The language the flow is opened in: a pseudo-locale opens in its base language (C161.7). */
function languageOf(locale: MatrixLocale): string {
  return locale === 'en-XA' || locale === 'ar-XB' ? PSEUDO_BASE_LANGUAGE[locale] : locale;
}

/** The session's copy in `locale`: every built-in message and the state's own, pseudo-localised. */
function copyIn(
  locale: MatrixLocale,
  served: ServedPosition,
): Partial<Pick<ServedPosition, 'copy' | 'locales'>> {
  if (locale !== 'en-XA' && locale !== 'ar-XB') return {};
  const base = PSEUDO_BASE_LANGUAGE[locale];
  const own = Object.fromEntries(
    Object.entries(served.copy?.messages.en ?? {}).map(([key, text]) => [
      key,
      pseudoLocalize(locale, text),
    ]),
  );
  return {
    copy: { messages: { [base]: { ...(pseudoCopy(locale).messages[base] ?? {}), ...own } } },
    ...(served.locales === undefined ? {} : { locales: { enabled: [base], default: base } }),
  };
}

/** The flow's own loading words in every language, so a run never checks the loading card. */
const LOADING = new RegExp(
  Object.values(CATALOGS)
    .flatMap((catalog) => [
      catalog.loading,
      pseudoLocalize('en-XA', catalog.loading),
      pseudoLocalize('ar-XB', catalog.loading),
    ])
    .map((text) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
    .join('|'),
  'u',
);

/** The customer page and the flow server of this worker, started once when a run embeds. */
interface Embedding {
  readonly flowServer: RunningFlowServer;
  readonly embedder: RunningPageServer;
}

let embedding: Promise<Embedding> | undefined;

/**
 * The embedding page's script for the matrix: the fixture's options (`e2e/fixtures/embed-page/`)
 * plus `styleVariant` from the fragment's `style-variant`, which a customer passes for the flow's
 * built-in dark palette (C159, C160.9).
 */
const MATRIX_EMBED_SCRIPT = `(function () {
  'use strict';
  var params = new URLSearchParams(window.location.hash.slice(1));
  var optional = function (name) {
    var value = params.get(name);
    return value === null ? undefined : value;
  };
  window.openverifyHandle = window.OpenVerify.embed({
    container: '#verify',
    flowUrl: params.get('flow-url'),
    inquiryId: params.get('inquiry-id'),
    sessionToken: optional('session-token'),
    language: optional('language'),
    styleVariant: optional('style-variant'),
    iframeTitle: 'Identity verification',
  });
})();
`;

function embeddingOnce(): Promise<Embedding> {
  embedding ??= (async () => {
    const embedder = await startEmbedPage({ script: MATRIX_EMBED_SCRIPT });
    const flowServer = await startMockFlowServer('http://localhost:9');
    flowServer.setPolicy(INQUIRY_ID, [embedder.origin]);
    return { embedder, flowServer };
  })();
  return embedding;
}

/** Ends this worker's embedding servers, when a run started them. */
export async function closeEmbedding(): Promise<void> {
  if (embedding === undefined) return;
  const { embedder, flowServer } = await embedding;
  embedding = undefined;
  await flowServer.close();
  await embedder.close();
}

const FRAME = 'iframe[title="Identity verification"]';

/**
 * Opens `id` in `configuration` and answers the page's surface once the state is drawn: the
 * heading shown (in English, the state's own), the loading card gone, what the state shows.
 */
export async function openState(
  page: Page,
  id: A11yStateId,
  configuration: MatrixConfiguration,
): Promise<Surface> {
  const recipe: StateRecipe = STATE_RECIPES[id];
  const { locale, scheme, mode, width } = configuration;
  await page.setViewportSize({ width, height: 720 });
  await page.emulateMedia({ colorScheme: scheme });

  const mock = new MockFlowApi();
  mock.consent = { ...PHASE5_CONSENT_GIVEN, textKeys: [...PHASE5_CONSENT_GIVEN.textKeys] };
  mock.inquiryStatus = 'pending';
  recipe.configure?.(mock);
  if (recipe.served !== undefined) {
    serve(mock, { ...recipe.served, ...copyIn(locale, recipe.served) });
  }
  // C160.9: with no theme set, the built-in dark palette is the page's `style-variant=dark`; the
  // browser's preference alone keeps the built-in light one.
  const parameters = `language=${languageOf(locale)}${scheme === 'dark' ? '&style-variant=dark' : ''}`;

  let surface: Surface;
  if (mode === 'hosted') {
    await mock.install(page);
    await page.goto(`/?${parameters}${flowLink().slice(1)}`);
    surface = page;
  } else {
    const { embedder, flowServer } = await embeddingOnce();
    const removeOrigins = serveEmbedOrigins([embedder.origin]);
    page.once('close', removeOrigins);
    await installForEmbedding(mock, page, flowServer.origin);
    await page.goto(
      `${embedPageUrl(embedder.origin, flowServer.origin, INQUIRY_ID, SESSION_TOKEN)}&${parameters}`,
    );
    surface = page.frameLocator(FRAME);
  }

  const heading = surface.locator('h1');
  await expect(heading).toBeVisible();
  await expect(surface.locator('[role="status"]').filter({ hasText: LOADING })).toHaveCount(0);
  await recipe.reach?.(surface);
  await recipe.settled?.(surface);
  if (locale === 'en') {
    await expect(heading).toHaveText(recipe.heading);
  }
  // The palette the run names is the one drawn (the built-in dark one only for `dark`).
  const root = surface.locator(':root');
  if (scheme === 'dark') {
    await expect(root).toHaveAttribute(BUILTIN_VARIANT_ATTRIBUTE, 'dark');
  } else {
    await expect(root).not.toHaveAttribute(BUILTIN_VARIANT_ATTRIBUTE, /./u);
  }
  return surface;
}
