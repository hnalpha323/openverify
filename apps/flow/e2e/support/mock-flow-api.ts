/**
 * A stateful stand-in for the flow API (contract C3), installed with `page.route`, so the flow
 * runs end to end in Chromium without a server. It enforces what the real API enforces for
 * the client (bearer session token, consent before uploads, `kind` before `file`, image magic
 * bytes) and records every request for assertions.
 *
 * C19 additions: the session's `environment`, the one-time link redeem (each link works once,
 * every refusal is the same 401), inactive sessions (401 with `code`), a redacted inquiry
 * (410 on writes), and requests that never answer.
 *
 * Phase 5 additions (C52, C55, C57, C59.6, C64.1), on the mock's own clock (`clockMs`, which a
 * spec keeps equal to the page's frozen clock):
 * - phone and email codes: five sends with the 30/60/120/240 s waits, five tries per code, ten
 *   minutes per code, ten wrong entries in all; a send after the last one, or the tenth wrong
 *   entry, submits the verification; a confirmed code (or one a limit refused) may be submitted;
 * - wallet challenges: a chain the step offers, an EVM address of the right shape, the inquiry's
 *   expected address; a new one supersedes the open one, the eleventh cancels the attempt; a
 *   submit names the open, unexpired challenge. No signature is checked: the server does that;
 * - entered values: a database body carries only the step's fields and all its required ones, a
 *   422 with a JSON Pointer per member otherwise; a form is submitted once its values arrived;
 * - a silent AAMVA step's attempt is made by the "server" (`silentAamva`), never by the flow.
 * Workflow 5B additions (C52.4, C52.6, C61):
 * - documents: a `document` file (a PDF, its header within the first 1,024 bytes, or an image)
 *   goes to an initiated document verification only, and a document is submitted only with its
 *   file; `refusedUploads` makes the next document uploads answer a status (such as 413);
 * - the business registry and website forms: a business body names associated persons only when
 *   the step collects them and carries every `required-inputs` member (`businessRequiredInputs`);
 * - each type's guidance comes from its step; `documentGuidance` replaces the document's.
 * Refusals answer the golden problems of `contracts/fixtures/problems/flow/` (C52.7).
 */
import { readFileSync, readdirSync } from 'node:fs';
import type * as contracts from '@openverify/contracts';
import type { FlowStep } from '@openverify/flow-spec';
import type { Page, Request, Route } from '@playwright/test';

/** The API origin the e2e build is configured with (`VITE_OPENVERIFY_API_URL`). */
export const API_ORIGIN = 'http://api.openverify.test';

export const INQUIRY_ID = 'inq_01M5CJXHG07XPHF3HRM6NREDH7';
/** Synthetic and obviously fake: `ovs_` plus 43 base64url characters. */
export const SESSION_TOKEN = `ovs_${'E2eSyntheticSessionToken'.padEnd(43, 'x')}`;

const AT = '2026-10-20T12:00:00.000Z';

/** Synthetic and obviously fake: `ovo_` plus 43 base64url characters. */
export const ONE_TIME_TOKEN = `ovo_${'E2eSyntheticOneTimeToken'.padEnd(43, 'x')}`;

/** The hosted-flow link, as `POST /inquiries/:id/resume` builds it (relative to the flow). */
export function flowLink(token = SESSION_TOKEN, inquiryId = INQUIRY_ID): string {
  return `/#inquiry-id=${inquiryId}&session-token=${token}`;
}

/** A one-time link, as `POST /inquiries/:id/generate-one-time-link` builds it (C10). */
export function oneTimeLink(token = ONE_TIME_TOKEN, inquiryId = INQUIRY_ID): string {
  return `/#inquiry-id=${inquiryId}&one-time-token=${token}`;
}

export const REDEEM_PATH = '/api/v1/flow/one-time-links/redeem';

type FlowDocument = Record<string, unknown> & { steps: Record<string, unknown>[] };

/** The default template's flow (C45.1), read from the shared golden fixture (contract C8). */
export function selfieFlow(): FlowDocument {
  const fixture = JSON.parse(
    readFileSync(
      new URL('../../../../contracts/fixtures/flows/default-gov-id-selfie.json', import.meta.url),
      'utf8',
    ),
  ) as { flow: FlowDocument };
  return fixture.flow;
}

/**
 * The default template's flow with its own centre-only, passive selfie step (C45.1): the specs
 * that are not about the selfie take one photo, while `selfie-capture.spec.ts` takes the three
 * poses of the default template.
 */
export function defaultFlow(): FlowDocument {
  const flow = selfieFlow();
  return {
    ...flow,
    steps: flow.steps.map((step) =>
      step.type === 'selfie' ? { ...step, poses: ['center'], liveness: 'passive' } : step,
    ),
  };
}

/** The consent step of the Phase 5 flows: the default texts, without the optional one. */
const PHASE5_CONSENT: Extract<FlowStep, { type: 'consent' }> = {
  id: 'consent',
  type: 'consent',
  textKeys: ['consent.biometric', 'consent.processing'],
  required: true,
};

/** What a Phase 5 flow's consent records, to start a spec past the consent screen. */
export const PHASE5_CONSENT_GIVEN = {
  textKeys: [...PHASE5_CONSENT.textKeys],
  locale: 'en',
} as const;

/** A flow of `steps` between the consent and the completion and failure steps (C50.3). */
export function phase5Flow(name: string, ...steps: FlowStep[]): FlowDocument {
  return {
    metadata: { specVersion: 1, id: name, version: 1, name },
    steps: [
      PHASE5_CONSENT,
      ...steps,
      { id: 'completion', type: 'completion', messageKey: 'flow.completion' },
      { id: 'failure', type: 'failure', messageKey: 'flow.failure' },
    ],
    transitions: [],
  };
}

/**
 * The C50.1, C55 and C57.2 numbers the mock applies. The suite runs on the built flow without
 * building the workspace packages, so it imports none of them at run time; each is checked
 * against `@openverify/contracts` by its type, so the typecheck fails if the contracts change it.
 */
const OTP = {
  codeTtlMs: (600 satisfies typeof contracts.OTP_CODE_TTL_SECONDS) * 1000,
  attemptsPerCode: 5 satisfies typeof contracts.OTP_MAX_ATTEMPTS_PER_CODE,
  maxWrongEntries: 10 satisfies typeof contracts.OTP_MAX_WRONG_ENTRIES,
  maxSends: 5 satisfies typeof contracts.OTP_MAX_SENDS,
  /** `OTP_RESEND_COOLDOWNS_SECONDS`: the wait after sends 1 to 4. */
  cooldownsSeconds: [30, 60, 120, 240],
  codeLength: 6 satisfies (typeof contracts.OTP_CODE_LENGTH)['default'],
} as const;

const CRYPTO = {
  challengeTtlMs: (600 satisfies typeof contracts.CRYPTO_CHALLENGE_TTL_SECONDS) * 1000,
  challengeLimit: 10 satisfies typeof contracts.CRYPTO_CHALLENGE_LIMIT,
} as const;

/** C50.1: the attempts of a step that sets no `maxAttempts`. */
const DEFAULT_MAX_ATTEMPTS = {
  document: 3,
  database: 1,
  aamva: 1,
  phone_number: 5,
  email_address: 5,
  government_id_nfc: 3,
  crypto_wallet: 3,
  database_business: 3,
  business_website: 3,
} as const satisfies typeof contracts.DEFAULT_MAX_ATTEMPTS;

const PROBLEMS = new URL('../../../../contracts/fixtures/problems/flow/', import.meta.url);

/** The golden Phase 5 problems (C52.7), by `code`, as the flow API answers them. */
const GOLDEN_PROBLEMS: ReadonlyMap<string, Readonly<Record<string, unknown>>> = new Map(
  readdirSync(PROBLEMS)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const body = JSON.parse(readFileSync(new URL(name, PROBLEMS), 'utf8')) as {
        readonly code: string;
      };
      return [body.code, body];
    }),
);

/** The resources the web flow runs (C50.1, C64.1), with the step type of each (C50.2). */
const STEP_OF_TYPE = {
  'verification/government-id': 'government_id',
  'verification/selfie': 'selfie',
  'verification/phone-number': 'phone_otp',
  'verification/email-address': 'email_otp',
  'verification/crypto-wallet': 'crypto_wallet',
  'verification/database': 'database',
  'verification/aamva': 'aamva',
  'verification/document': 'document',
  'verification/database-business': 'database_business',
  'verification/business-website': 'business_website',
} as const;

type ResourceType = keyof typeof STEP_OF_TYPE;

const isResourceType = (type: string): type is ResourceType => Object.hasOwn(STEP_OF_TYPE, type);

const OTP_TYPES: ReadonlySet<string> = new Set([
  'verification/phone-number',
  'verification/email-address',
]);
const INPUT_TYPES: ReadonlySet<string> = new Set([
  'verification/database',
  'verification/aamva',
  'verification/database-business',
  'verification/business-website',
]);

/** C52.4: the media types a document may be, the default of its guidance (a PDF first). */
const DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

/** C52.4: a PDF's `%PDF-` header lies within its first 1,024 bytes. */
const PDF_HEADER = Buffer.from('%PDF-', 'latin1');

/** C57.1: an EVM account, `0x` and 40 hexadecimal digits. */
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/u;

const iso = (ms: number) => new Date(ms).toISOString();

/** A step field (`name_first`) as a body names it (`name-first`, C52.3). */
const bodyName = (field: string) => field.replaceAll('_', '-');

/** C52.3: every database body carries these, whatever the step requires. */
const DATABASE_REQUIRED_FIELDS = ['name_first', 'name_last', 'address_country_code'];

/** What the mock shows of a destination: its last characters only, as a masked one would. */
function maskDestination(destination: string): string {
  const at = destination.indexOf('@');
  return at > 0
    ? `${destination.slice(0, 1)}•••${destination.slice(at)}`
    : `•••••••${destination.slice(-4)}`;
}

interface Hint {
  readonly name: string;
  readonly reasons: readonly string[];
}

export type Decision =
  | { readonly status: 'passed' }
  /** An operator decides it (C30.4); for the user it is done (C30.6). */
  | { readonly status: 'needs_review' }
  | { readonly status: 'failed'; readonly hints?: Hint[] };

/** The open code of a phone or email verification (C55); the code itself is `otpCode`. */
export interface MockOtp {
  readonly destination: string;
  readonly sentAtMs: number;
  attemptsRemaining: number;
}

/** A wallet challenge (C57.2), as the mock keeps it. */
export interface MockChallenge {
  readonly id: string;
  readonly chainId: string;
  readonly walletAddress: string;
  readonly message: string;
  readonly expiresAtMs: number;
  status: 'initiated' | 'superseded' | 'submitted';
}

export interface Verification {
  readonly type: ResourceType;
  readonly id: string;
  status: string;
  hints: readonly Hint[];
  /** C55: accepted sends, the open code, wrong entries, and whether a limit refused the user. */
  sends?: number;
  otp?: MockOtp;
  wrongEntries?: number;
  limited?: boolean;
  /** C57.2: the wallet challenges, oldest first. */
  challenges?: MockChallenge[];
  /** C52.3: the values last entered, and whether any were. */
  values?: Readonly<Record<string, unknown>>;
  inputsReceived?: boolean;
}

/** A golden problem (C52.7) a Phase 5 route answers first, its members replacing the fixture's. */
export interface Refusal {
  readonly code: string;
  readonly members?: Readonly<Record<string, unknown>>;
}

/** The Phase 5 routes `refusals` can make answer a golden problem first. */
export type RefusingRoute = 'otp' | 'otp/confirm' | 'inputs' | 'crypto-challenges' | 'submit';

/** A Phase 5 request's JSON body, as the flow sent it. */
export interface RecordedBody {
  readonly verificationId: string;
  readonly body: Readonly<Record<string, unknown>>;
}

export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly path: string;
  readonly authorization: string | undefined;
  readonly referer: string | undefined;
  readonly cookie: string | undefined;
}

export interface RecordedUpload {
  readonly verificationId: string;
  readonly kind: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly size: number;
  /** Multipart field names, in order. */
  readonly fields: readonly string[];
  /** A selfie pose's capture fields (C40.3). */
  readonly captureId?: string;
  readonly nonce?: string;
  readonly clientElapsedMs?: number;
}

/** A selfie capture (C40), as the mock keeps it. */
export interface MockCapture {
  readonly id: string;
  readonly nonce: string;
  readonly verificationId: string;
  readonly method: string;
  readonly prompts: readonly string[];
  status: 'initiated' | 'submitted' | 'errored';
  readonly uploaded: Set<string>;
}

/** A submit's JSON body (C40.4), when it had one. */
export interface RecordedSubmit {
  readonly verificationId: string;
  readonly body: {
    readonly capture?: { readonly id: string; readonly nonce: string; readonly device?: Device };
    /** C57.3: the wallet's signature over the named challenge. */
    readonly crypto?: Readonly<Record<string, string>>;
  } | null;
}

/** The device snapshot a selfie submit carries (C40.4). */
export interface Device {
  readonly label?: string;
  readonly settings?: Readonly<Record<string, number | string>>;
  readonly capabilities?: Readonly<Record<string, unknown>>;
  readonly 'frame-stats'?: Readonly<Record<string, number>>;
  readonly webdriver?: boolean;
  readonly 'image-mirrored'?: boolean;
}

const POSE_BY_KIND: Readonly<Record<string, string>> = {
  'selfie-center': 'center',
  'selfie-left': 'left',
  'selfie-right': 'right',
};

interface Part {
  readonly name: string;
  readonly fileName: string | undefined;
  readonly body: Buffer;
}

function parseMultipart(body: Buffer, contentType: string): Part[] {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const delimiter = Buffer.from(`--${boundary?.[1] ?? boundary?.[2] ?? ''}`);
  const parts: Part[] = [];
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) {
      break;
    }
    const part = body.subarray(start + delimiter.length + 2, next - 2);
    const split = part.indexOf('\r\n\r\n');
    const headers = part.subarray(0, split).toString('utf8');
    const name = /name="([^"]*)"/.exec(headers)?.[1] ?? '';
    const fileName = /filename="([^"]*)"/.exec(headers)?.[1];
    parts.push({ name, fileName, body: part.subarray(split + 4) });
    start = next;
  }
  return parts;
}

function sniff(bytes: Buffer, kind: string): string | null {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return 'image/jpeg';
  }
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  // C52.4: a document may also be a PDF.
  if (kind === 'document' && bytes.subarray(0, 1024).includes(PDF_HEADER)) {
    return 'application/pdf';
  }
  return null;
}

/** C96.3 (Workflow 7A): the flow handoff routes the mock answers. */
export type HandoffRoute =
  'issue' | 'continue-here' | 'current' | 'reject' | 'preview' | 'decline' | 'redeem';

/** The phone's handoff routes: no session token, the `ovh_` token in the body (C96.3). */
const HANDOFF_TOKEN_ROUTES: Readonly<Record<string, HandoffRoute>> = {
  '/handoffs/preview': 'preview',
  '/handoffs/decline': 'decline',
  '/handoffs/redeem': 'redeem',
};

/** The issuing session's handoff routes, by `METHOD /path` below `/api/v1/flow`. */
const HANDOFF_SESSION_ROUTES: Readonly<Record<string, HandoffRoute>> = {
  'POST /handoffs': 'issue',
  'POST /handoffs/continue-here': 'continue-here',
  'GET /handoffs/current': 'current',
  'POST /handoffs/current/reject': 'reject',
};

/** A scripted answer of a handoff route: its status and JSON body. */
export interface HandoffAnswer {
  readonly status: number;
  readonly body: unknown;
}

/**
 * Workflow 9A Stage 1b (F; review F11): the registration hook of this mock, so each owner keeps its
 * answers in its own `e2e/support/mock-<area>.ts` and never edits this shared file. An area
 * registers once, at import, and a spec imports the area's file:
 *
 * ```ts
 * registerMockFlowExtension('renderer', {
 *   session: (session, mock) => ({ ...session, position: positionOf(mock) }),
 *   route: async ({ method, path, reply }) => {
 *     if (method !== 'POST' || !path.startsWith('/screens/')) return false;
 *     await reply(200, sessionOf(...));
 *     return true;
 *   },
 * });
 * ```
 *
 * `route` sees every request below `/api/v1/flow` that carries the session token of an active
 * session, before the mock's own routes, and answers `true` when it answered; `session` rewrites
 * every session answer. Extensions run in registration order; registering an area again replaces it.
 */
export interface MockFlowRouteRequest {
  readonly mock: MockFlowApi;
  readonly request: Request;
  /** `GET`, `POST`, ... */
  readonly method: string;
  /** The path below `/api/v1/flow`, such as `/screens/about/submit`. */
  readonly path: string;
  /** Answers with the CORS headers the mock sends (`application/json` unless `type` is given). */
  readonly reply: (status: number, body: unknown, type?: string) => Promise<void>;
  /** Answers an RFC 9457 problem with `title`, and `members` beside it. */
  readonly problem: (
    status: number,
    title: string,
    members?: Readonly<Record<string, unknown>>,
  ) => Promise<void>;
}

export interface MockFlowExtension {
  readonly route?: (request: MockFlowRouteRequest) => Promise<boolean>;
  readonly session?: (
    session: Readonly<Record<string, unknown>>,
    mock: MockFlowApi,
  ) => Readonly<Record<string, unknown>>;
}

const mockFlowExtensions = new Map<string, MockFlowExtension>();

/** Registers `area`'s extension (replacing an earlier one); answers a function that removes it. */
export function registerMockFlowExtension(area: string, extension: MockFlowExtension): () => void {
  mockFlowExtensions.set(area, extension);
  return () => {
    if (mockFlowExtensions.get(area) === extension) {
      mockFlowExtensions.delete(area);
    }
  };
}

export class MockFlowApi {
  flow = defaultFlow();
  inquiryStatus = 'created';
  /** `environment.kind` of the session (C19); `null` leaves it out, as a Phase 1 server did. */
  environmentKind: 'sandbox' | 'production' | null = null;
  /** One-time tokens the redeem still accepts, each once. */
  readonly oneTimeTokens = new Set<string>([ONE_TIME_TOKEN]);
  /** An inactive session answers every call with 401 and this `code` (C10). */
  sessionStatus: 'active' | 'expired' | 'canceled' = 'active';
  /**
   * The `reason` of a canceled session's 401 (C25.8): `inquiry_redacted`, `inquiry_expired`,
   * `inquiry_finished`, or anything a newer server may add. `null` leaves it out, as before 2E.
   */
  cancelReason: string | null = null;
  /** A redacted inquiry answers every write with 410 `redacted` (Workflow 2B F018). */
  redacted = false;
  /** `METHOD /path` (below `/api/v1/flow`) of requests left unanswered, once each. */
  readonly hang: string[] = [];
  /**
   * `METHOD /path` of requests that do their work, then answer 2xx with a body the contract
   * does not describe, once each (the 2E follow-up: a create that is made but unreadable).
   */
  readonly garble: string[] = [];
  consent: { textKeys: string[]; optionalTextKeys?: string[]; locale: string } | null = null;
  /**
   * C237.6, C238.4 (Workflow 11A Stage 1b (K)): every share-consent exit the flow posted, oldest first
   * (`POST /share-consents/:stepId/accept`, `/decline`, `/withdraw`), each answered with the session at
   * the same position; the share-consent screen and its spec are `clients-connect`'s.
   */
  readonly shareConsentExits: { stepId: string; exit: string; body: unknown }[] = [];
  /** C94.6 (K7A-16): the session's collection tiers once it consented; `null` reports none. */
  signalTiers: contracts.FlowSessionSignals | null = null;
  /** The session's `face-template-retention-days` (C42.6); `null` leaves it out. */
  retentionDays: number | null = 365;
  readonly verifications: Verification[] = [];
  readonly uploads: RecordedUpload[] = [];
  readonly requests: RecordedRequest[] = [];
  readonly captures: MockCapture[] = [];
  readonly submits: RecordedSubmit[] = [];
  /** The prompts of the next captures; defaults to `center`, then the step's other poses. */
  capturePrompts: readonly string[] | null = null;
  /** The next selfie uploads answer 503, once each. */
  failingUploads = 0;
  /** The next selfie submits answer 409 `selfie_capture_invalid`, once each. */
  invalidSubmits = 0;
  /** Decisions for submitted verifications, applied in order when they are first polled. */
  readonly decisions: Decision[] = [];
  /** Polls of a submitted verification that still find it submitted before it is decided. */
  pendingPolls = 0;

  /**
   * The mock's wall clock for code and challenge times (C55, C57.2): `null` reads the real one.
   * A spec that freezes the page's clock sets this to the same time and moves both together.
   */
  clockMs: number | null = null;
  /** The one code the mock accepts (C55); synthetic. */
  otpCode = '246810';
  /** The inquiry's `crypto_wallet_address` field (C57.2), or `null` for none. */
  expectedWalletAddress: string | null = null;
  /** Golden problems a Phase 5 route answers first, in order, once each. */
  readonly refusals: Partial<Record<RefusingRoute, Refusal[]>> = {};
  /** The next entered values refused with these JSON Pointers (a C52.3 422), once each. */
  readonly refusedInputs: (readonly string[])[] = [];
  /**
   * C59.6: what the server does with a silent AAMVA step's attempt, one entry per session read:
   * `null` nothing yet; a status creates the attempt (the server's, never the flow's) or moves it.
   */
  readonly silentAamva: (string | null)[] = [];
  /** C52.2: the document verification's guidance in place of the one its step gives. */
  documentGuidance: Readonly<Record<string, unknown>> | null | undefined = undefined;
  /** C52.2, C52.3: the business inputs every configured match group names. */
  businessRequiredInputs: readonly string[] = ['business-name'];
  /** The statuses the next document uploads answer instead of storing the file, once each. */
  readonly refusedUploads: number[] = [];
  /** The codes sent and confirmed, the values entered and the challenges asked for, in order. */
  readonly otpSends: RecordedBody[] = [];
  readonly otpConfirms: RecordedBody[] = [];
  readonly enteredValues: RecordedBody[] = [];
  readonly challengeRequests: RecordedBody[] = [];
  /**
   * C94.2 (Workflow 7A): the signal bodies the collector posted, answered 202 as the API answers.
   * They are kept here, not in `requests`, so the specs that count requests stay as they are.
   */
  readonly signalBodies: RecordedBody[] = [];
  /**
   * C96.3 (Workflow 7A): the session's `handoff` and `handoff-context` members, left out while
   * `null` (as a Phase 6 server did).
   */
  handoff: { readonly 'step-id': string; readonly state: string } | null = null;
  handoffContext: Readonly<Record<string, unknown>> | null = null;
  /**
   * C96.3: the answers of the handoff routes, each used until replaced; a route without one
   * answers 501, as the API does until `flow-handoff` builds it.
   */
  readonly handoffAnswers: Partial<Record<HandoffRoute, HandoffAnswer>> = {};
  /** C96.3: the handoff calls the flow made, with their bodies (synthetic only), in order. */
  readonly handoffCalls: { readonly route: HandoffRoute; readonly body: unknown }[] = [];

  async install(page: Page): Promise<void> {
    await page.route(`${API_ORIGIN}/**`, (route) => this.handle(route, page));
  }

  /** Each registered area's session members (`registerMockFlowExtension`), in registration order. */
  private extendedSession(
    session: Readonly<Record<string, unknown>>,
  ): Readonly<Record<string, unknown>> {
    let extended = session;
    for (const extension of mockFlowExtensions.values()) {
      extended = extension.session?.(extended, this) ?? extended;
    }
    return extended;
  }

  private async handle(route: Route, page: Page): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const cors = {
      'access-control-allow-origin': new URL(page.url()).origin,
      'access-control-allow-headers': 'authorization, content-type, accept',
      'access-control-allow-methods': 'GET, POST',
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const headers = await request.allHeaders();
    if (
      request.method() === 'POST' &&
      url.pathname === '/api/v1/flow/signals' &&
      headers.authorization === `Bearer ${SESSION_TOKEN}`
    ) {
      this.signalBodies.push(request.postDataJSON() as RecordedBody);
      await route.fulfill({
        status: 202,
        headers: { ...cors, 'content-type': 'application/json' },
        body: 'null',
      });
      return;
    }
    this.requests.push({
      method: request.method(),
      url: request.url(),
      path: url.pathname,
      authorization: headers.authorization,
      referer: headers.referer,
      cookie: headers.cookie,
    });
    const reply = async (status: number, body: unknown, type = 'application/json') => {
      await route.fulfill({
        status,
        headers: { ...cors, 'content-type': type },
        body: JSON.stringify(body),
      });
    };
    const problem = async (
      status: number,
      title: string,
      extra: Readonly<Record<string, unknown>> = {},
    ) => {
      await reply(
        status,
        {
          type: 'about:blank',
          title,
          status,
          detail: `${title}.`,
          instance: url.pathname,
          requestId: 'e2e',
          ...extra,
        },
        'application/problem+json',
      );
    };
    /** The golden problem with `code` (C52.7), its members replacing the fixture's own. */
    const golden = async (code: string, members: Readonly<Record<string, unknown>> = {}) => {
      const body: Readonly<Record<string, unknown>> = {
        ...GOLDEN_PROBLEMS.get(code),
        ...members,
        instance: url.pathname,
      };
      if (typeof body.status !== 'number') {
        throw new Error(`No golden flow problem ${code}`);
      }
      await reply(body.status, body, 'application/problem+json');
    };

    const path = url.pathname.replace(/^\/api\/v1\/flow/, '');
    const method = request.method();
    const hung = this.hang.indexOf(`${method} ${path}`);
    if (hung !== -1) {
      // Never answered: the client's own deadline has to end the request.
      this.hang.splice(hung, 1);
      return;
    }

    if (method === 'POST' && url.pathname === REDEEM_PATH) {
      const body = request.postDataJSON() as { 'inquiry-id'?: string; 'one-time-token'?: string };
      const token = body['one-time-token'] ?? '';
      if (
        headers.authorization === undefined &&
        body['inquiry-id'] === INQUIRY_ID &&
        this.oneTimeTokens.delete(token)
      ) {
        await reply(200, {
          'session-token': SESSION_TOKEN,
          'expires-at': '2026-10-21T12:00:00.000Z',
        });
      } else {
        await problem(401, 'Unauthorized');
      }
      return;
    }

    /** C96.3: a handoff route's scripted answer, or the API's 501 until built. */
    const handoffAnswer = async (handoffRoute: HandoffRoute) => {
      this.handoffCalls.push({
        route: handoffRoute,
        body: method === 'GET' ? null : (request.postDataJSON() as unknown),
      });
      const answer = this.handoffAnswers[handoffRoute];
      if (answer === undefined) {
        await problem(501, 'Not Implemented');
      } else {
        await reply(answer.status, answer.body);
      }
    };
    const tokenRoute = HANDOFF_TOKEN_ROUTES[path];
    if (method === 'POST' && tokenRoute !== undefined) {
      if (headers.authorization === undefined) {
        await handoffAnswer(tokenRoute);
      } else {
        await problem(400, 'Bad Request');
      }
      return;
    }

    if (headers.authorization !== `Bearer ${SESSION_TOKEN}`) {
      await problem(401, 'Unauthorized');
      return;
    }
    if (this.sessionStatus !== 'active') {
      const reason =
        this.sessionStatus === 'canceled' && this.cancelReason !== null
          ? { reason: this.cancelReason }
          : {};
      await problem(401, 'Unauthorized', { code: `session_${this.sessionStatus}`, ...reason });
      return;
    }
    if (this.redacted && method === 'POST') {
      await problem(410, 'Redacted', { type: 'https://openverify.dev/problems/redacted' });
      return;
    }

    // Workflow 9A Stage 1b (F; review F11): each registered area's routes, before the mock's own.
    for (const extension of mockFlowExtensions.values()) {
      if (
        extension.route !== undefined &&
        (await extension.route({ mock: this, request, method, path, reply, problem }))
      ) {
        return;
      }
    }

    const verificationMatch =
      /^\/verifications\/(ver_[0-9A-Z]{26})(\/files|\/submit|\/selfies|\/otp|\/otp\/confirm|\/inputs|\/crypto-challenges)?$/.exec(
        path,
      );

    const sessionAnswer = () =>
      this.extendedSession({
        inquiry: { id: INQUIRY_ID, status: this.inquiryStatus },
        flow: this.flow,
        verifications: this.verifications.map((v) => this.resource(v)),
        consent: this.consent === null ? null : { 'accepted-at': AT },
        ...(this.environmentKind === null ? {} : { environment: { kind: this.environmentKind } }),
        ...(this.retentionDays === null
          ? {}
          : { 'face-template-retention-days': this.retentionDays }),
        ...(this.consent === null || this.signalTiers === null
          ? {}
          : { signals: this.signalTiers }),
        ...(this.handoff === null ? {} : { handoff: this.handoff }),
        ...(this.handoffContext === null ? {} : { 'handoff-context': this.handoffContext }),
      });
    if (method === 'GET' && path === '/session') {
      if (this.inquiryStatus === 'created') {
        this.inquiryStatus = 'pending';
      }
      this.runSilentAamva();
      await reply(200, sessionAnswer());
      return;
    }
    // C237.6, C238.4 (Workflow 11A Stage 1b (K)): the three share-consent exits, each answered
    // with the session at the same position (the server decides; the mock only records).
    const shareConsentExit =
      /^\/share-consents\/([a-z][a-z0-9_-]{0,63})\/(accept|decline|withdraw)$/.exec(path);
    if (method === 'POST' && shareConsentExit !== null) {
      this.shareConsentExits.push({
        stepId: shareConsentExit[1] ?? '',
        exit: shareConsentExit[2] ?? '',
        body: request.postDataJSON() as unknown,
      });
      await reply(200, sessionAnswer());
      return;
    }
    const sessionRoute = HANDOFF_SESSION_ROUTES[`${method} ${path}`];
    if (sessionRoute !== undefined) {
      await handoffAnswer(sessionRoute);
      return;
    }
    if (method === 'POST' && path === '/consent') {
      const body = request.postDataJSON() as {
        'text-keys': string[];
        'optional-text-keys'?: string[];
        locale: string;
      };
      this.consent = {
        textKeys: body['text-keys'],
        ...(body['optional-text-keys'] === undefined
          ? {}
          : { optionalTextKeys: body['optional-text-keys'] }),
        locale: body.locale,
      };
      await reply(201, { consent: { 'accepted-at': AT } });
      return;
    }
    if (method === 'POST' && path === '/verifications') {
      const body = request.postDataJSON() as { type: string };
      const type = `verification/${body.type}`;
      if (!isResourceType(type)) {
        await problem(422, 'Unprocessable Content');
        return;
      }
      // C52.2, C59.6: the server creates a silent AAMVA step's attempts itself.
      if (type === 'verification/aamva' && this.step('aamva')?.source === 'government_id') {
        await golden('verification_created_by_server');
        return;
      }
      const verification: Verification = {
        type,
        id: this.nextVerificationId(),
        status: 'initiated',
        hints: [],
      };
      this.verifications.push(verification);
      const garbled = this.garble.indexOf(`${method} ${path}`);
      if (garbled !== -1) {
        this.garble.splice(garbled, 1);
        // Made, but answered without the attributes the contract requires.
        await reply(201, { data: { type: verification.type, id: verification.id } });
        return;
      }
      await reply(201, { data: this.resource(verification) });
      return;
    }
    const verification = this.verifications.find((v) => v.id === verificationMatch?.[1]);
    if (verificationMatch === null || verification === undefined) {
      await problem(404, 'Not Found');
      return;
    }
    const action = verificationMatch[2];

    const captureInvalid = () => problem(409, 'Conflict', { code: 'selfie_capture_invalid' });

    if (method === 'POST' && action === '/selfies') {
      const body = request.postDataJSON() as { method?: string };
      if (
        this.consent === null ||
        verification.type !== 'verification/selfie' ||
        verification.status !== 'initiated' ||
        (body.method !== 'camera' && body.method !== 'upload')
      ) {
        await problem(409, 'Conflict');
        return;
      }
      for (const open of this.captures) {
        if (open.verificationId === verification.id && open.status === 'initiated') {
          open.status = 'errored';
        }
      }
      const index = String(this.captures.length).padStart(2, '0');
      const capture: MockCapture = {
        id: `self_01M5CJXHG07XPHF3HRM6NRED${index}`,
        nonce: `E2eSyntheticNonce000${index}`,
        verificationId: verification.id,
        method: body.method,
        prompts: this.capturePrompts ?? this.stepPrompts(),
        status: 'initiated',
        uploaded: new Set(),
      };
      this.captures.push(capture);
      await reply(201, {
        data: {
          type: 'selfie',
          id: capture.id,
          attributes: {
            prompts: capture.prompts,
            'expires-at': '2026-10-20T12:03:00.000Z',
            nonce: capture.nonce,
            guidance: {
              'max-center-yaw-ratio': 0.021,
              'min-side-yaw-ratio-change': 0.077,
              'hold-ms': 500,
            },
          },
        },
      });
      return;
    }

    if (method === 'POST' && action === '/files') {
      if (this.consent === null) {
        await problem(409, 'Conflict');
        return;
      }
      const parts = parseMultipart(
        request.postDataBuffer() ?? Buffer.alloc(0),
        headers['content-type'] ?? '',
      );
      const field = (name: string) =>
        parts.find((part) => part.name === name)?.body.toString('utf8');
      const kind = field('kind') ?? '';
      const file = parts.find((part) => part.name === 'file');
      const mimeType = file === undefined ? null : sniff(file.body, kind);
      if (file === undefined || mimeType === null) {
        await problem(415, 'Unsupported Media Type');
        return;
      }
      // C52.4: a document goes to an initiated document verification only.
      if (
        (kind === 'document') !== (verification.type === 'verification/document') ||
        verification.status !== 'initiated'
      ) {
        await problem(409, 'Conflict');
        return;
      }
      const refusedUpload = kind === 'document' ? this.refusedUploads.shift() : undefined;
      if (refusedUpload !== undefined) {
        await problem(refusedUpload, refusedUpload === 413 ? 'Content Too Large' : 'Refused');
        return;
      }
      const pose = POSE_BY_KIND[kind];
      const captureId = field('capture-id');
      const nonce = field('nonce');
      const elapsed = field('client-elapsed-ms');
      if (pose !== undefined) {
        // C40.3, C40.7: a selfie pose belongs to the open capture of its verification.
        const capture = this.captures.find((candidate) => candidate.id === captureId);
        if (
          capture === undefined ||
          capture.nonce !== nonce ||
          capture.status !== 'initiated' ||
          capture.verificationId !== verification.id ||
          !capture.prompts.includes(pose)
        ) {
          await captureInvalid();
          return;
        }
        if (this.failingUploads > 0) {
          this.failingUploads -= 1;
          await problem(503, 'Service Unavailable');
          return;
        }
        capture.uploaded.add(pose);
      }
      this.uploads.push({
        verificationId: verification.id,
        kind,
        fileName: file.fileName ?? '',
        mimeType,
        size: file.body.length,
        fields: parts.map((part) => part.name),
        ...(captureId === undefined ? {} : { captureId }),
        ...(nonce === undefined ? {} : { nonce }),
        ...(elapsed === undefined ? {} : { clientElapsedMs: Number(elapsed) }),
      });
      const fileId = `file_01M5CK17N82ZP0PQ8RZRRTT5${String(this.uploads.length).padStart(2, '0')}`;
      await reply(201, {
        data: {
          type: 'file',
          id: fileId,
          attributes: {
            kind,
            'mime-type': mimeType,
            'byte-size': file.body.length,
            'created-at': AT,
          },
          relationships: {
            verification: { data: { type: verification.type, id: verification.id } },
          },
        },
      });
      return;
    }
    if (method === 'POST' && action === '/otp') {
      const body = request.postDataJSON() as Readonly<Record<string, string>>;
      this.otpSends.push({ verificationId: verification.id, body });
      if (this.consent === null || !OTP_TYPES.has(verification.type)) {
        await problem(409, 'Conflict');
        return;
      }
      if (verification.status === 'confirmed') {
        await golden('otp_already_confirmed');
        return;
      }
      if (verification.status !== 'initiated') {
        await problem(409, 'Conflict');
        return;
      }
      const refusal = this.refusal('otp', verification);
      if (refusal !== undefined) {
        await golden(refusal.code, refusal.members);
        return;
      }
      const sends = verification.sends ?? 0;
      // C55.6: a send after the last one submits the verification, so its check fails.
      if (sends >= OTP.maxSends) {
        verification.status = 'submitted';
        await golden('otp_not_confirmed');
        return;
      }
      const resendAt = this.resendAvailableAt(verification);
      if (resendAt !== null && this.now() < resendAt) {
        await golden('otp_resend_too_soon', { 'resend-available-at': iso(resendAt) });
        return;
      }
      verification.sends = sends + 1;
      verification.otp = {
        destination: body['phone-number'] ?? body['email-address'] ?? '',
        sentAtMs: this.now(),
        attemptsRemaining: OTP.attemptsPerCode,
      };
      await reply(200, { data: this.resource(verification) });
      return;
    }

    if (method === 'POST' && action === '/otp/confirm') {
      const body = request.postDataJSON() as { readonly code: string };
      this.otpConfirms.push({ verificationId: verification.id, body });
      if (this.consent === null || !OTP_TYPES.has(verification.type)) {
        await problem(409, 'Conflict');
        return;
      }
      if (verification.status === 'confirmed') {
        await golden('otp_already_confirmed');
        return;
      }
      if (verification.status !== 'initiated') {
        await problem(409, 'Conflict');
        return;
      }
      const refusal = this.refusal('otp/confirm', verification);
      if (refusal !== undefined) {
        await golden(refusal.code, refusal.members);
        return;
      }
      const { otp } = verification;
      if (otp === undefined) {
        await golden('otp_not_sent');
        return;
      }
      if (this.now() >= otp.sentAtMs + OTP.codeTtlMs) {
        // C55.6: the last code expired with no send left, so the attempt is submitted.
        if ((verification.sends ?? 0) >= OTP.maxSends) {
          verification.status = 'submitted';
          await golden('otp_not_confirmed');
          return;
        }
        await golden('otp_expired');
        return;
      }
      if (otp.attemptsRemaining === 0) {
        await golden('otp_code_exhausted');
        return;
      }
      if (body.code === this.otpCode) {
        verification.status = 'confirmed';
        await reply(200, { data: this.resource(verification) });
        return;
      }
      otp.attemptsRemaining -= 1;
      verification.wrongEntries = (verification.wrongEntries ?? 0) + 1;
      // C55.5: the tenth wrong entry across the codes submits the verification.
      if (verification.wrongEntries >= OTP.maxWrongEntries) {
        verification.status = 'submitted';
        await golden('otp_attempts_exhausted');
        return;
      }
      await golden('otp_incorrect', { 'attempts-remaining': otp.attemptsRemaining });
      return;
    }

    if (method === 'POST' && action === '/inputs') {
      const body = request.postDataJSON() as Readonly<Record<string, unknown>>;
      this.enteredValues.push({ verificationId: verification.id, body });
      if (
        this.consent === null ||
        !INPUT_TYPES.has(verification.type) ||
        verification.status !== 'initiated'
      ) {
        await problem(409, 'Conflict');
        return;
      }
      const refusal = this.refusal('inputs', verification);
      if (refusal !== undefined) {
        await golden(refusal.code, refusal.members);
        return;
      }
      const pointers = this.refusedInputs.shift() ?? this.inputsRule(verification, body);
      if (pointers.length > 0) {
        // C52.3: one 422 with no `code`, a JSON Pointer per refused member, no value echoed.
        await problem(422, 'Unprocessable Content', {
          detail: 'The entered values were refused.',
          errors: pointers.map((pointer) => ({ location: 'body', pointer, detail: 'is invalid' })),
        });
        return;
      }
      // A new body replaces the earlier values (C52.3).
      verification.values = { ...body };
      verification.inputsReceived = true;
      await reply(200, { data: this.resource(verification) });
      return;
    }

    if (method === 'POST' && action === '/crypto-challenges') {
      const body = request.postDataJSON() as { 'chain-id': string; 'wallet-address': string };
      this.challengeRequests.push({ verificationId: verification.id, body });
      if (
        this.consent === null ||
        verification.type !== 'verification/crypto-wallet' ||
        verification.status !== 'initiated'
      ) {
        await problem(409, 'Conflict');
        return;
      }
      const refusal = this.refusal('crypto-challenges', verification);
      if (refusal !== undefined) {
        await golden(refusal.code, refusal.members);
        return;
      }
      const chainId = body['chain-id'];
      const address = body['wallet-address'];
      if (!(this.step('crypto_wallet')?.chains ?? []).includes(chainId)) {
        await golden('crypto_chain_not_offered');
        return;
      }
      if (chainId.startsWith('eip155:') && !EVM_ADDRESS.test(address)) {
        await golden('crypto_address_invalid');
        return;
      }
      if (
        this.expectedWalletAddress !== null &&
        this.expectedWalletAddress.toLowerCase() !== address.toLowerCase()
      ) {
        await golden('crypto_expected_address_mismatch');
        return;
      }
      const challenges = (verification.challenges ??= []);
      // C57.2: the eleventh challenge cancels the attempt (a retryable one).
      if (challenges.length >= CRYPTO.challengeLimit) {
        verification.status = 'canceled';
        await golden('crypto_challenge_invalid');
        return;
      }
      for (const open of challenges) {
        if (open.status === 'initiated') {
          open.status = 'superseded';
        }
      }
      const index = String(challenges.length).padStart(2, '0');
      const challenge: MockChallenge = {
        id: `cwc_01M5CK5AAB0000000000000C${index}`,
        chainId,
        walletAddress: address,
        message: [
          'flow.openverify.test wants you to sign in with your account:',
          address,
          '',
          'Prove you control this wallet. Signing is free and moves no funds.',
          '',
          'Version: 1',
          `Nonce: E2eSyntheticNo${index}`,
          `Issued At: ${iso(this.now())}`,
          `Expiration Time: ${iso(this.now() + CRYPTO.challengeTtlMs)}`,
          `Request ID: ${verification.id}`,
        ].join('\n'),
        expiresAtMs: this.now() + CRYPTO.challengeTtlMs,
        status: 'initiated',
      };
      challenges.push(challenge);
      await reply(201, {
        id: challenge.id,
        message: challenge.message,
        'expires-at': iso(challenge.expiresAtMs),
      });
      return;
    }

    if (method === 'POST' && action === '/submit') {
      const text = request.postData();
      const body = (
        text === null || text === '' ? null : JSON.parse(text)
      ) as RecordedSubmit['body'];
      if (verification.type === 'verification/selfie') {
        // C40.4, C40.7: a selfie names its open capture, complete, with the right nonce.
        const named = body?.capture;
        const capture = this.captures.find((candidate) => candidate.id === named?.id);
        if (
          capture === undefined ||
          capture.nonce !== named?.nonce ||
          capture.status !== 'initiated' ||
          capture.verificationId !== verification.id
        ) {
          await captureInvalid();
          return;
        }
        if (capture.prompts.some((pose) => !capture.uploaded.has(pose))) {
          await problem(409, 'Conflict', { code: 'selfie_capture_incomplete' });
          return;
        }
        if (this.invalidSubmits > 0) {
          this.invalidSubmits -= 1;
          await captureInvalid();
          return;
        }
        capture.status = 'submitted';
      }
      const refusal = this.refusal('submit', verification);
      if (refusal !== undefined) {
        await golden(refusal.code, refusal.members);
        return;
      }
      if (verification.type === 'verification/crypto-wallet') {
        // C57.3: a wallet submit names its open, unexpired challenge.
        const open = verification.challenges?.find(
          (challenge) =>
            challenge.id === body?.crypto?.['challenge-id'] &&
            challenge.status === 'initiated' &&
            this.now() < challenge.expiresAtMs,
        );
        if (open === undefined) {
          await golden('crypto_challenge_invalid');
          return;
        }
        open.status = 'submitted';
      }
      // C52.6: a form is submitted once its values arrived.
      if (INPUT_TYPES.has(verification.type) && verification.inputsReceived !== true) {
        await golden('inputs_required');
        return;
      }
      // C52.6: a document is submitted once its file was uploaded.
      if (
        verification.type === 'verification/document' &&
        !this.uploads.some((upload) => upload.verificationId === verification.id)
      ) {
        await problem(422, 'Unprocessable Content', {
          detail: 'Missing required files: document.',
        });
        return;
      }
      // C52.6, C55.6: a code is submitted once confirmed, or once a limit refused the user.
      if (
        OTP_TYPES.has(verification.type) &&
        verification.status !== 'confirmed' &&
        verification.limited !== true
      ) {
        await golden('otp_not_confirmed');
        return;
      }
      this.submits.push({ verificationId: verification.id, body });
      verification.status = 'submitted';
      await reply(200, { data: this.resource(verification) });
      return;
    }
    if (method === 'GET' && action === undefined) {
      if (verification.status === 'submitted') {
        if (this.pendingPolls > 0) {
          this.pendingPolls -= 1;
        } else {
          this.decide(verification);
        }
      }
      await reply(200, { data: this.resource(verification) });
      return;
    }
    await problem(405, 'Method Not Allowed');
  }

  /** `center` first, then the selfie step's other poses in its order. */
  private stepPrompts(): string[] {
    const step = this.flow.steps.find((candidate) => candidate.type === 'selfie');
    const poses = (step?.poses as string[] | undefined) ?? ['center'];
    return ['center', ...poses.filter((pose) => pose !== 'center')];
  }

  private decide(verification: Verification): void {
    const decision = this.decisions.shift() ?? { status: 'passed' };
    verification.status = decision.status;
    verification.hints = decision.status === 'failed' ? (decision.hints ?? []) : [];
    this.settle();
  }

  /**
   * C30.5 over the flow's verification steps: a step whose last attempt failed with none left
   * fails the inquiry; every step passed or skipped (C50.5) completes it, and one in review then
   * marks it for review in the same transaction.
   */
  private settle(): void {
    const outcomes = this.flow.steps.flatMap((step) => {
      const type = resourceTypeOfStep(String(step.type));
      if (type === undefined) {
        return [];
      }
      const attempts = this.verifications.filter((v) => v.type === type);
      const latest = attempts.at(-1)?.status;
      if (latest === 'passed' || latest === 'skipped') {
        return ['passed'];
      }
      if (latest === 'needs_review') {
        return ['needs_review'];
      }
      // A silent AAMVA step's attempt has no retry (C50.5, C59.6).
      const exhausted =
        attempts.length >= this.maxAttemptsOf(step) || step.source === 'government_id';
      return [latest === 'failed' && exhausted ? 'failed' : 'open'];
    });
    if (outcomes.includes('failed')) {
      this.inquiryStatus = 'failed';
    } else if (outcomes.every((outcome) => outcome === 'passed' || outcome === 'needs_review')) {
      this.inquiryStatus = outcomes.includes('needs_review') ? 'needs_review' : 'completed';
    }
  }

  /** C50.2 `stepMaxAttempts`: the step's own count, else its type's default. */
  private maxAttemptsOf(step: Readonly<Record<string, unknown>>): number {
    if (typeof step.maxAttempts === 'number') {
      return step.maxAttempts;
    }
    const type = resourceTypeOfStep(String(step.type))?.slice('verification/'.length);
    const key = type?.replaceAll('-', '_') ?? '';
    return (DEFAULT_MAX_ATTEMPTS as Readonly<Record<string, number>>)[key] ?? 1;
  }

  /** The flow's first step of `type`. */
  private step<Type extends FlowStep['type']>(
    type: Type,
  ): Extract<FlowStep, { type: Type }> | undefined {
    return this.flow.steps.find((step) => step.type === type) as
      Extract<FlowStep, { type: Type }> | undefined;
  }

  private nextVerificationId(): string {
    return `ver_01M5CK16P0D13FXHZSS4TCFB${String(this.verifications.length).padStart(2, '0')}`;
  }

  private now(): number {
    return this.clockMs ?? Date.now();
  }

  /**
   * The next queued refusal of `route`. It changes the verification as the server would (C55.6):
   * `otp_not_confirmed` and `otp_attempts_exhausted` submit it, `otp_rate_limited` records the
   * limit, so it may be submitted for review.
   */
  private refusal(route: RefusingRoute, verification: Verification): Refusal | undefined {
    const refusal = this.refusals[route]?.shift();
    if (refusal?.code === 'otp_not_confirmed' || refusal?.code === 'otp_attempts_exhausted') {
      verification.status = 'submitted';
    } else if (refusal?.code === 'otp_rate_limited') {
      verification.limited = true;
    }
    return refusal;
  }

  /** C55.6: when the next send is allowed, or `null` without a code or with no send left. */
  private resendAvailableAt(verification: Verification): number | null {
    const sends = verification.sends ?? 0;
    const cooldown = OTP.cooldownsSeconds[sends - 1];
    if (verification.otp === undefined || sends >= OTP.maxSends || cooldown === undefined) {
      return null;
    }
    return verification.otp.sentAtMs + cooldown * 1000;
  }

  /**
   * C52.3 as the server applies it to a database body: only the step's fields, and all of its
   * required ones (the step's and `DATABASE_REQUIRED_FIELDS`); the JSON Pointers of the others.
   */
  private inputsRule(
    verification: Verification,
    body: Readonly<Record<string, unknown>>,
  ): readonly string[] {
    if (verification.type === 'verification/database-business') {
      return this.businessRule(body);
    }
    const step = this.step('database');
    if (verification.type !== 'verification/database' || step === undefined) {
      return [];
    }
    const given = Object.keys(body);
    const collected = new Set(step.fields.map(bodyName));
    return [
      ...given.filter((name) => !collected.has(name)),
      ...this.requiredMembers().filter((name) => !given.includes(name)),
    ].map((name) => `/${name}`);
  }

  /**
   * C52.3 as the server applies it to a business body: associated persons only when the step
   * collects them, and every input each match group names; the JSON Pointers of the others.
   */
  private businessRule(body: Readonly<Record<string, unknown>>): readonly string[] {
    const collects = this.step('database_business')?.collectAssociatedPersons === true;
    return [
      ...(!collects && 'associated-persons' in body ? ['associated-persons'] : []),
      ...this.businessRequiredInputs.filter((name) => !(name in body)),
    ].map((name) => `/${name}`);
  }

  /** C52.2, C52.3: a database body's required members, in the step's order. */
  private requiredMembers(): string[] {
    const step = this.step('database');
    const required = new Set([...DATABASE_REQUIRED_FIELDS, ...(step?.requiredFields ?? [])]);
    return (step?.fields ?? []).filter((field) => required.has(field)).map(bodyName);
  }

  /** C59.6: the server's next move on a silent AAMVA step, at a session read. */
  private runSilentAamva(): void {
    if (this.silentAamva.length === 0) {
      return;
    }
    const status = this.silentAamva.shift() ?? null;
    if (status === null) {
      return;
    }
    const existing = this.verifications.find((v) => v.type === 'verification/aamva');
    if (existing === undefined) {
      this.verifications.push({
        type: 'verification/aamva',
        id: this.nextVerificationId(),
        status,
        hints: [],
      });
    } else {
      existing.status = status;
    }
    this.settle();
  }

  /** C52.2: a Phase 5 verification's guidance; nothing for a government ID or a selfie. */
  private guidance(verification: Verification): Readonly<Record<string, unknown>> {
    switch (verification.type) {
      case 'verification/phone-number': {
        const step = this.step('phone_otp');
        return {
          guidance: {
            'allowed-countries': step?.allowedCountries ?? ['US'],
            'code-length': step?.codeLength ?? OTP.codeLength,
            otp: this.otpGuidance(verification),
          },
        };
      }
      case 'verification/email-address':
        return {
          guidance: {
            'code-length': this.step('email_otp')?.codeLength ?? OTP.codeLength,
            otp: this.otpGuidance(verification),
          },
        };
      case 'verification/crypto-wallet': {
        const step = this.step('crypto_wallet');
        return {
          guidance: { chains: step?.chains ?? [], signing: step?.signing ?? ['paste'] },
        };
      }
      case 'verification/database':
        return {
          guidance: {
            fields: (this.step('database')?.fields ?? []).map(bodyName),
            'required-fields': this.requiredMembers(),
          },
          'inputs-received': verification.inputsReceived ?? false,
        };
      case 'verification/aamva':
        return {
          guidance: { source: this.step('aamva')?.source ?? 'form' },
          'inputs-received': verification.inputsReceived ?? false,
        };
      case 'verification/document':
        return {
          guidance:
            this.documentGuidance === undefined
              ? {
                  'accepted-types': this.step('document')?.documentTypes ?? ['utility_bill'],
                  'max-age-days': 90,
                  'max-pages': 50,
                  'accepted-mime-types': DOCUMENT_MIME_TYPES,
                }
              : this.documentGuidance,
        };
      case 'verification/database-business':
        return {
          guidance: {
            'collect-associated-persons':
              this.step('database_business')?.collectAssociatedPersons ?? false,
            'required-inputs': [...this.businessRequiredInputs],
          },
          'inputs-received': verification.inputsReceived ?? false,
        };
      case 'verification/business-website':
        return { guidance: {}, 'inputs-received': verification.inputsReceived ?? false };
      case 'verification/government-id':
      case 'verification/selfie':
        return {};
    }
  }

  /** C52.2 `guidance.otp`: the open code, never the code itself. */
  private otpGuidance(verification: Verification): Readonly<Record<string, unknown>> | null {
    const { otp } = verification;
    if (otp === undefined || verification.status !== 'initiated') {
      return null;
    }
    const resendAt = this.resendAvailableAt(verification);
    return {
      'masked-destination': maskDestination(otp.destination),
      'expires-at': iso(otp.sentAtMs + OTP.codeTtlMs),
      'resend-available-at': resendAt === null ? null : iso(resendAt),
      'sends-remaining': OTP.maxSends - (verification.sends ?? 0),
      'attempts-remaining': otp.attemptsRemaining,
    };
  }

  private resource(verification: Verification) {
    return {
      type: verification.type,
      id: verification.id,
      attributes: {
        status: verification.status,
        'retry-hints': verification.hints,
        ...this.guidance(verification),
        'created-at': AT,
        'updated-at': AT,
      },
    };
  }
}

/** The resource a step's verifications are (C50.2), or `undefined` for a step that makes none. */
function resourceTypeOfStep(stepType: string): ResourceType | undefined {
  return (Object.keys(STEP_OF_TYPE) as ResourceType[]).find(
    (type) => STEP_OF_TYPE[type] === stepType,
  );
}
