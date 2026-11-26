/**
 * C157.2, C158 (Workflow 9A): the embedding rules on the API. Owner: `flow-server-embed`; the
 * signatures, the frozen internal route that calls {@link embedPolicyFor}, the settings route that
 * calls {@link embeddingSettingsProblems} and the inquiry create path that calls
 * {@link checkInquiryRedirectUri} were placed by `foundation-9a` (Stage 1b (F)).
 *
 * - {@link embedPolicyFor}: the flow server's lookup (C157.2): the origins that may frame an
 *   inquiry, the version's narrowed to the environment's current list (C158.2), `null` for an
 *   unknown inquiry and an inactive template alike (review F03).
 * - {@link redirectUriRefusal}, {@link checkInquiryRedirectUri}, {@link redirectUrlFor} and
 *   {@link completionRedirectUrl}: a redirect URI matches an allowed redirect origin exactly, or a
 *   wildcard entry through `matchesOriginPattern`, or names a custom scheme the version lists and the
 *   denylist leaves (C158.4); the completion redirect carries only `inquiry-id`, and `status` when
 *   the version opts in, and is checked again against the current lists on every answer (C158.5).
 * - {@link embeddingSettingsProblems} (foundation-9a's): every origin in the grammar of
 *   `@openverify/contracts/origin-pattern` for the environment's kind and a production wildcard held
 *   to its acknowledgement (C158.1, V17).
 *
 * Nothing here echoes a stored or requested origin or URI into a problem: refusals name the
 * position and the rule only.
 */
import {
  checkOriginEntry,
  isWildcardOriginEntry,
  matchesOriginPattern,
  MAX_ORIGIN_ENTRIES,
  REDIRECT_SCHEME_DENYLIST,
  type DashboardUpdateSettingsBody,
  type EmbedPolicyAnswerDocument,
  type OriginEnvironmentKind,
} from '@openverify/contracts';
import {
  environments,
  inquiries,
  inquiryTemplates,
  inquiryTemplateVersions,
  type Db,
  type EnvironmentSettings,
  type Inquiry,
} from '@openverify/db';
import { and, eq } from 'drizzle-orm';
import { TemplateProblemError } from '../errors.js';

/**
 * C157.2: the embed policy of `inquiryId` for the flow server: the inquiry's template, environment
 * and the origins that may frame it ({@link allowedEmbedOrigins} of the pinned version and the
 * environment), or `null` for an unknown inquiry or an inactive template (one answer for both,
 * review F03). An empty list is an answer: the flow server sends `frame-ancestors 'none'` for it.
 */
export async function embedPolicyFor(
  db: Db,
  inquiryId: string,
): Promise<EmbedPolicyAnswerDocument | null> {
  const [row] = await db
    .select({
      environmentId: inquiries.environmentId,
      templateId: inquiries.inquiryTemplateId,
      templateStatus: inquiryTemplates.status,
      versionOrigins: inquiryTemplateVersions.embedOrigins,
      environmentKind: environments.kind,
      settings: environments.settings,
    })
    .from(inquiries)
    .innerJoin(
      inquiryTemplates,
      and(
        eq(inquiryTemplates.id, inquiries.inquiryTemplateId),
        eq(inquiryTemplates.environmentId, inquiries.environmentId),
      ),
    )
    .innerJoin(
      inquiryTemplateVersions,
      and(
        eq(inquiryTemplateVersions.id, inquiries.inquiryTemplateVersionId),
        eq(inquiryTemplateVersions.environmentId, inquiries.environmentId),
      ),
    )
    .innerJoin(environments, eq(environments.id, inquiries.environmentId))
    .where(eq(inquiries.id, inquiryId))
    .limit(1);
  if (row?.templateStatus !== 'active') {
    return null;
  }
  return {
    'inquiry-id': inquiryId,
    'template-id': row.templateId,
    'environment-id': row.environmentId,
    'frame-ancestors': allowedEmbedOrigins(
      row.environmentKind,
      row.settings['allowed-embed-origins'] ?? [],
      row.versionOrigins,
    ),
  };
}

/** What a session's completion redirect is computed from (C158.4, C158.5). */
export interface RedirectRequest {
  inquiry: Inquiry;
  /** The environment's kind, for the sandbox's `http://localhost` rule. */
  environmentKind: OriginEnvironmentKind;
  /** The final status the redirect may carry when the version opts in (`redirect-include-status`). */
  status: string;
}

/** The pinned version's redirect members and its environment's settings. */
interface RedirectContext {
  redirectUri: string | null;
  schemes: readonly string[];
  includeStatus: boolean;
  settings: EnvironmentSettings;
}

async function redirectContext(
  db: Db,
  environmentId: string,
  versionId: string,
): Promise<RedirectContext | null> {
  const [row] = await db
    .select({
      redirectUri: inquiryTemplateVersions.redirectUri,
      schemes: inquiryTemplateVersions.redirectUriSchemes,
      includeStatus: inquiryTemplateVersions.redirectIncludeStatus,
      settings: environments.settings,
    })
    .from(inquiryTemplateVersions)
    .innerJoin(environments, eq(environments.id, inquiryTemplateVersions.environmentId))
    .where(
      and(
        eq(inquiryTemplateVersions.id, versionId),
        eq(inquiryTemplateVersions.environmentId, environmentId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** C158.4: the environment's redirect origins: `allowed-redirect-origins`, else the embed origins. */
function redirectOriginsOf(settings: EnvironmentSettings): readonly string[] {
  return settings['allowed-redirect-origins'] ?? settings['allowed-embed-origins'] ?? [];
}

/**
 * C158.4, C158.5: the session's `completion.redirect-url`: the inquiry's `redirect-uri` (else the
 * version's) with only `inquiry-id` appended, and `status` when the version opts in, checked again
 * against the environment's current lists, so removing an origin also stops the redirects of
 * inquiries already created; `null` for none or a mismatch.
 */
export async function redirectUrlFor(db: Db, request: RedirectRequest): Promise<string | null> {
  const { inquiry } = request;
  if (
    typeof inquiry.environmentId !== 'string' ||
    typeof inquiry.inquiryTemplateVersionId !== 'string'
  ) {
    return null;
  }
  const context = await redirectContext(
    db,
    inquiry.environmentId,
    inquiry.inquiryTemplateVersionId,
  );
  const uri = inquiry.redirectUri ?? context?.redirectUri ?? null;
  if (context === null || uri === null) {
    return null;
  }
  const refusal = redirectUriRefusal(uri, {
    environmentKind: request.environmentKind,
    allowedOrigins: redirectOriginsOf(context.settings),
    schemes: context.schemes,
  });
  return refusal === null
    ? completionRedirectUrl(uri, {
        inquiryId: inquiry.id,
        status: context.includeStatus ? request.status : null,
      })
    : null;
}

/**
 * C158.2: the origins that may frame an inquiry of a version: the version's `embed-origins` that
 * the environment still allows, or, when the version names none, the environment's own list. Every
 * entry is held to the grammar for the environment's kind again, so an entry stored before a rule
 * tightened (or written past the settings route) never reaches a header; at most
 * `MAX_ORIGIN_ENTRIES`, each once.
 */
export function allowedEmbedOrigins(
  environmentKind: OriginEnvironmentKind,
  environmentOrigins: readonly string[],
  versionOrigins: readonly string[],
): string[] {
  const allowed = new Set(
    environmentOrigins.filter((entry) => checkOriginEntry(entry, environmentKind) === null),
  );
  const chosen =
    versionOrigins.length === 0
      ? [...allowed]
      : versionOrigins.filter((entry) => allowed.has(entry));
  return [...new Set(chosen)].slice(0, MAX_ORIGIN_ENTRIES);
}

/** What a redirect URI is checked against (C158.4). */
export interface RedirectRules {
  environmentKind: OriginEnvironmentKind;
  /** The environment's redirect origins (its `allowed-redirect-origins`, else its embed origins). */
  allowedOrigins: readonly string[];
  /** The version's `redirect-uri-schemes`: custom schemes only. */
  schemes: readonly string[];
}

/** Why a redirect URI is refused (never echoed to a caller). */
export type RedirectRefusal = 'not_a_uri' | 'userinfo' | 'scheme' | 'origin';

/** C158.4: a redirect URI is at most this long (the inquiry's and the version's column). */
const REDIRECT_URI_MAX_LENGTH = 2048;
/** C158.4: the grammar of a custom scheme (`redirectSchemeSchema`'s). */
const CUSTOM_SCHEME = /^[a-z][a-z0-9+.-]*$/;

/**
 * C158.4: why `uri` is not an allowed redirect under `rules`, or `null`. An `http(s)` URI's origin
 * must match an allowed origin that is itself valid for the environment's kind: exactly (scheme,
 * host and the port with its default) for a plain entry, on a dot boundary for a wildcard, both
 * through `matchesOriginPattern` (OWASP's exact match; review P09). Any other scheme must be one
 * the version lists and the denylist leaves (`javascript`, `data`, `file` and the rest never pass).
 * Userinfo is refused.
 */
export function redirectUriRefusal(uri: string, rules: RedirectRules): RedirectRefusal | null {
  if (uri.length > REDIRECT_URI_MAX_LENGTH) {
    return 'not_a_uri';
  }
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return 'not_a_uri';
  }
  if (url.username !== '' || url.password !== '') {
    return 'userinfo';
  }
  const scheme = url.protocol.slice(0, -1);
  if (scheme === 'http' || scheme === 'https') {
    const matched = rules.allowedOrigins.some(
      (entry) =>
        checkOriginEntry(entry, rules.environmentKind) === null &&
        matchesOriginPattern(url.origin, entry),
    );
    return matched ? null : 'origin';
  }
  const custom =
    CUSTOM_SCHEME.test(scheme) &&
    !(REDIRECT_SCHEME_DENYLIST as readonly string[]).includes(scheme) &&
    rules.schemes.includes(scheme);
  return custom ? null : 'scheme';
}

/**
 * C158.5 (decision 15, review P32): `uri` with only `inquiry-id` appended, and `status` when the
 * version opts in (`null` otherwise). A value of either the URI already carried is replaced: a
 * landing page must never read an inquiry id or status the URI's author chose.
 */
export function completionRedirectUrl(
  uri: string,
  appended: { inquiryId: string; status: string | null },
): string {
  const url = new URL(uri);
  url.searchParams.delete('inquiry-id');
  url.searchParams.delete('status');
  url.searchParams.append('inquiry-id', appended.inquiryId);
  if (appended.status !== null) {
    url.searchParams.append('status', appended.status);
  }
  return url.toString();
}

/** A `redirect-uri` on `POST /inquiries` (C158.4). */
export interface InquiryRedirectCheck {
  environmentId: string;
  environmentKind: OriginEnvironmentKind;
  /** The version the inquiry pins: its `redirect-uri-schemes` widen the allowed schemes. */
  versionId: string;
  redirectUri: string;
}

/**
 * C158.4: refuses a `redirect-uri` outside the environment's `allowed-redirect-origins` (default the
 * embed origins) and the version's `redirect-uri-schemes`, with 422 `redirect_uri_not_allowed` at
 * its pointer, never echoing the URI.
 */
export async function checkInquiryRedirectUri(db: Db, check: InquiryRedirectCheck): Promise<void> {
  const context = await redirectContext(db, check.environmentId, check.versionId);
  const refusal =
    context === null
      ? 'origin'
      : redirectUriRefusal(check.redirectUri, {
          environmentKind: check.environmentKind,
          allowedOrigins: redirectOriginsOf(context.settings),
          schemes: context.schemes,
        });
  if (refusal !== null) {
    throw new TemplateProblemError(
      'redirect_uri_not_allowed',
      'The redirect URI is not on the allowed redirect origins or schemes.',
      [
        {
          location: 'body',
          pointer: '/data/attributes/redirect-uri',
          detail: REDIRECT_REFUSAL_DETAIL[refusal],
        },
      ],
    );
  }
}

/** What each redirect refusal says, never echoing the URI. */
const REDIRECT_REFUSAL_DETAIL: Readonly<Record<RedirectRefusal, string>> = {
  not_a_uri: 'Is not an absolute URI of at most 2,048 characters.',
  userinfo: 'Must not carry a user name or password.',
  scheme: 'Uses a scheme the template version does not allow.',
  origin: 'Is not on the allowed redirect origins.',
};

type OriginSetting = 'allowed-embed-origins' | 'allowed-redirect-origins';
const ORIGIN_SETTINGS: readonly OriginSetting[] = [
  'allowed-embed-origins',
  'allowed-redirect-origins',
];

/** C158.1 (V17): what each refusal of the origin grammar says, never echoing the entry. */
const REFUSAL_DETAIL: Readonly<Record<string, string>> = {
  not_an_origin: 'Is not an origin of the form https://host[:port].',
  scheme: 'Must use https (http only for localhost or 127.0.0.1 in sandbox).',
  userinfo: 'Must not carry a user name or password.',
  path: 'Must not carry a path, query or fragment.',
  ip_literal: 'Must name a host, not an IP address.',
  bare_wildcard: 'A bare * is not allowed.',
  wildcard_port: 'A wildcard port is not allowed.',
  wildcard_too_short: 'A wildcard needs two labels after it.',
  shared_hosting_suffix: 'A wildcard may not cover a shared-hosting suffix.',
  not_lowercase_ascii: 'Must be lower case, with an IDN in its xn-- form.',
  localhost_in_production: 'localhost is allowed in sandbox only.',
};

/**
 * C158.1, C158.4 (V17): the problem of an embedding settings change, or `null`: each origin in the
 * grammar for the environment's kind (422 `embed_origin_invalid` naming each refused position), and
 * in production a wildcard only with `meta.acknowledge-wildcards: true` (422
 * `embed_wildcard_unacknowledged`).
 */
export function embeddingSettingsProblems(
  environmentKind: OriginEnvironmentKind,
  changes: DashboardUpdateSettingsBody,
): TemplateProblemError | null {
  const refused = ORIGIN_SETTINGS.flatMap((setting) =>
    (changes[setting] ?? []).flatMap((entry, index) => {
      const refusal = checkOriginEntry(entry, environmentKind);
      return refusal === null
        ? []
        : [
            {
              location: 'body',
              pointer: `/${setting}/${String(index)}`,
              detail: REFUSAL_DETAIL[refusal] ?? 'Is not an allowed origin.',
            },
          ];
    }),
  );
  if (refused.length > 0) {
    return new TemplateProblemError(
      'embed_origin_invalid',
      'An origin is outside the allowed grammar.',
      refused,
    );
  }
  if (environmentKind === 'production' && changes.meta?.['acknowledge-wildcards'] !== true) {
    const wildcards = ORIGIN_SETTINGS.flatMap((setting) =>
      (changes[setting] ?? []).flatMap((entry, index) =>
        isWildcardOriginEntry(entry)
          ? [
              {
                location: 'body',
                pointer: `/${setting}/${String(index)}`,
                detail: 'A production wildcard needs meta.acknowledge-wildcards.',
              },
            ]
          : [],
      ),
    );
    if (wildcards.length > 0) {
      return new TemplateProblemError(
        'embed_wildcard_unacknowledged',
        'A wildcard origin in production needs its acknowledgement.',
        wildcards,
      );
    }
  }
  return null;
}
