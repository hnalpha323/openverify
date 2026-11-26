/**
 * Synthetic Have I Been Pwned API v3 `breachedaccount` answers (C82.1) for the `hibp` adapter's
 * tests against a local stub: fictional breaches of `.example` services, the truncated and full
 * shapes, 404 for an address in no breach, 401 and a 429 with `retry-after`. Messages are our own.
 */
import { jsonAnswer, type StubAnswer } from '../stub-answer.js';

/** The sandbox local-part token: an address holding it has a recent breach (C82.4). */
export const HIBP_SANDBOX_TOKEN = 'sandbox-breached';

/** A breach in HIBP's full (untruncated) model. */
export interface HibpBreach {
  readonly Name: string;
  readonly Title: string;
  readonly Domain: string;
  readonly BreachDate: string;
  readonly AddedDate: string;
  readonly ModifiedDate: string;
  readonly PwnCount: number;
  readonly Description: string;
  readonly LogoPath: string;
  readonly DataClasses: readonly string[];
  readonly IsVerified: boolean;
  readonly IsFabricated: boolean;
  readonly IsSensitive: boolean;
  readonly IsRetired: boolean;
  readonly IsSpamList: boolean;
  readonly IsMalware: boolean;
  readonly IsSubscriptionFree: boolean;
  readonly IsStealerLog: boolean;
}

export function hibpBreach(options: {
  readonly name: string;
  readonly breachDate: string;
  readonly dataClasses?: readonly string[];
}): HibpBreach {
  return {
    Name: options.name,
    Title: `${options.name} (synthetic)`,
    Domain: `${options.name.toLowerCase()}.example`,
    BreachDate: options.breachDate,
    AddedDate: `${options.breachDate}T00:00:00Z`,
    ModifiedDate: `${options.breachDate}T00:00:00Z`,
    PwnCount: 1000,
    Description: 'A synthetic breach for tests.',
    LogoPath: `https://logos.example/${options.name}.png`,
    DataClasses: options.dataClasses ?? ['Email addresses', 'Passwords'],
    IsVerified: true,
    IsFabricated: false,
    IsSensitive: false,
    IsRetired: false,
    IsSpamList: false,
    IsMalware: false,
    IsSubscriptionFree: false,
    IsStealerLog: false,
  };
}

export function hibpBreachedAccountAnswer(
  breaches: readonly HibpBreach[],
  options: { readonly truncate?: boolean } = {},
): StubAnswer {
  return jsonAnswer(
    200,
    options.truncate === false ? breaches : breaches.map(({ Name }) => ({ Name })),
  );
}

export function hibpNotFoundAnswer(): StubAnswer {
  return { status: 404, headers: {}, body: '' };
}

export function hibpUnauthorizedAnswer(): StubAnswer {
  return jsonAnswer(401, {
    statusCode: 401,
    message: 'The API key is missing or not valid. (synthetic)',
  });
}

export function hibpRateLimitedAnswer(retryAfterSeconds: number): StubAnswer {
  return jsonAnswer(
    429,
    {
      statusCode: 429,
      message: `Too many requests; try again in ${String(retryAfterSeconds)} seconds. (synthetic)`,
    },
    { 'retry-after': String(retryAfterSeconds) },
  );
}

/** A breach 3 months before `now` for an address holding the sandbox token, else 404. */
export function hibpScenarioAnswer(emailAddress: string, now: Date): StubAnswer {
  const local = emailAddress.slice(0, emailAddress.lastIndexOf('@'));
  if (!local.includes(HIBP_SANDBOX_TOKEN)) {
    return hibpNotFoundAnswer();
  }
  const breached = new Date(now);
  breached.setUTCMonth(breached.getUTCMonth() - 3);
  return hibpBreachedAccountAnswer(
    [hibpBreach({ name: 'SyntheticForum', breachDate: breached.toISOString().slice(0, 10) })],
    { truncate: false },
  );
}
