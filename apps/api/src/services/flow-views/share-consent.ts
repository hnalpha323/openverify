/**
 * C238.3, C237.6 (Workflow 11A, `api-consent`): what the session serves for the `share_consent` step,
 * composed by the server (`clientViewOf` answers `null` for the type, since the view needs the
 * connection, the token and the texts): the recipient and source names, the categories, the text with
 * its digest and, when the share carries `biometric`, the separate tick's text with its own digest. No
 * token, connection or source object id is ever in it (C238.3, C238.5). Also the session's
 * `withdrawable-share-consents` (C237.6, verification V02) and the template preview's labelled sample.
 *
 * The composition is `connect-logic`'s `composeShareConsentText` (the closed placeholders filled in one
 * pass, parts joined by a blank line, NFC) over the version's operator copy for the key when it has
 * one (`{name}` placeholders) or the released built-in text (`{{name}}`, the flow's export under
 * `contracts/fixtures/i18n/<locale>.json`, as the API reads every built-in text). The digest is the
 * logical form's SHA-256 (`consentTextDigest(body, {}, false)`, Stage 1a amendment 20). Its inputs
 * hold still between the serve and the accept (the expiry is a duration, never a date), so the exit
 * recomposes the same text and compares the digests (C238.4).
 *
 * - Source side: the step's connection must be an outbound connection of the inquiry's organisation;
 *   the recipient is its destination; the categories are the upper bound the connection's current
 *   policy can carry from an inquiry (`policyShareCategories`), so the consent covers the token made
 *   later.
 * - Destination side: the share token reserved for this inquiry (C238.5), read through
 *   `cross-tenant.ts`; the categories are the token's stored ones (C230.4); the retention term is the
 *   template's `retention-days`, else the environment's (C238.9). An inquiry without a token is served
 *   no view (the engine skips the step, checkpoint 5).
 *
 * Honesty: the digest records which text the server served and that the client reported showing it;
 * it does not prove that the person read it.
 */
import { readFileSync } from 'node:fs';
import type { EnvironmentKind, FlowWithdrawableShareConsent } from '@openverify/contracts';
import {
  composeShareConsentText,
  policyShareCategories,
  SHARE_CATEGORIES,
  SHARE_CONSENT_TEXT_KEYS,
  type ShareCategory,
  type SharePolicyRules,
  type ShareTextTemplate,
} from '@openverify/core';
import {
  getConnectionOfOrganization,
  getEnvironment,
  getInquirySession,
  getInquiryTemplateVersion,
  getSharePoliciesOfConnection,
  listSessionShareConsents,
  type ConnectShareToken,
  type Db,
  type Inquiry,
  type InquiryTemplateVersion,
} from '@openverify/db';
import {
  COPY_KEYS,
  safeParseAnyFlow,
  SHARE_CONSENT_VALID_SECONDS,
  shareConsentClientViewOf,
  isFlowV2,
  type FlowV2Step,
  type ShareConsentClientView,
} from '@openverify/flow-spec';
import { consentTextDigest } from '../templates/consent-texts.js';
import { storedCopy, storedFieldSchemas } from '../templates/versions.js';
import { crossTenant, type CrossTenantCaller } from '../connect/cross-tenant.js';

type ShareConsentStep = Extract<FlowV2Step, { type: 'share_consent' }>;

/** What the view's composition reads. */
export interface ShareConsentViewInput {
  inquiry: Inquiry;
  step: FlowV2Step;
  sessionId: string | null;
  environmentKind: EnvironmentKind | null;
  now: Date;
}

/** C237.6: at most this many withdrawable consents (the member's own bound). */
const WITHDRAWABLE_MAX = 20;

/** A released catalog: the flow's export of one locale. */
interface ReleasedCatalog {
  messages: Record<string, unknown>;
}

const catalogs = new Map<string, ReleasedCatalog | null>();

/** The flow's export of `locale` (`contracts/fixtures/i18n/<locale>.json`), read once, or `null`. */
function releasedCatalog(locale: string): ReleasedCatalog | null {
  if (!/^[a-z]{2,3}$/.test(locale)) {
    return null;
  }
  if (!catalogs.has(locale)) {
    try {
      catalogs.set(
        locale,
        JSON.parse(
          readFileSync(
            new URL(`../../../../../contracts/fixtures/i18n/${locale}.json`, import.meta.url),
            'utf8',
          ),
        ) as ReleasedCatalog,
      );
    } catch {
      catalogs.set(locale, null);
    }
  }
  return catalogs.get(locale) ?? null;
}

/** A dotted key of a released catalog (`share.consent.source`), or `undefined`. */
function releasedText(locale: string, key: string): string | undefined {
  let node: unknown = releasedCatalog(locale)?.messages;
  for (const part of key.split('.')) {
    node =
      typeof node === 'object' && node !== null
        ? (node as Record<string, unknown>)[part]
        : undefined;
  }
  return typeof node === 'string' ? node : undefined;
}

/** The locale's words for every category (`share.categories.<category>`), or `null` when any lacks one. */
function categoryWordsOf(locale: string): Record<ShareCategory, string> | null {
  const words = {} as Record<ShareCategory, string>;
  for (const category of SHARE_CATEGORIES) {
    const word = releasedText(locale, `share.categories.${category}`);
    if (word === undefined) {
      return null;
    }
    words[category] = word;
  }
  return words;
}

/** One part to compose: the version's operator copy for the key, else the released built-in text. */
function templateOf(
  version: InquiryTemplateVersion,
  locale: string,
  key: string,
): ShareTextTemplate | null {
  const placeholders = COPY_KEYS[key]?.placeholders ?? [];
  const messages = storedCopy(version).messages as Readonly<
    Record<string, Readonly<Record<string, string>> | undefined>
  >;
  const custom = messages[locale]?.[key];
  if (custom !== undefined) {
    return { key, text: custom, builtIn: false, placeholders };
  }
  const builtIn = releasedText(locale, key);
  return builtIn === undefined ? null : { key, text: builtIn, builtIn: true, placeholders };
}

/** The locale the view is composed in: the session's consent locale when enabled, else the default. */
function localeOf(version: InquiryTemplateVersion, preferred: string | null): string {
  const enabled = version.enabledLocales as readonly string[];
  const short = preferred?.split('-')[0] ?? null;
  return short !== null && enabled.includes(short) ? short : version.defaultLocale;
}

/** What a share consent's view and record rest on, beyond the step. */
export interface ShareConsentFacts {
  step: ShareConsentStep;
  connectionId: string;
  /** The token reserved for this inquiry (destination side only). */
  token: ConnectShareToken | null;
  recipientOrganizationId: string;
  view: ShareConsentClientView;
  /** The composed bodies, for the stored copy of a `flow` text (C236.3). */
  bodies: { text: string; biometric: string | null };
  validSeconds: number;
}

/** The token reserved for `inquiry` (C238.5), read through the cross-tenant module, or `null`. */
export async function reservedShareToken(
  db: Db,
  caller: CrossTenantCaller,
  inquiryId: string,
): Promise<ConnectShareToken | null> {
  const touching = await crossTenant.listSharesTouching(db, caller.environmentId, [inquiryId]);
  return (
    touching.tokens.find(
      (token) =>
        token.reservedInquiryId === inquiryId &&
        token.destinationEnvironmentId === caller.environmentId,
    ) ?? null
  );
}

/**
 * C238.3: the facts of a `share_consent` step on this inquiry, with its composed view, or `null` when
 * no view can be composed (no outbound connection, no reserved token, a text that cannot be filled).
 */
export async function shareConsentFacts(
  db: Db,
  input: { inquiry: Inquiry; step: FlowV2Step; locale: string | null },
): Promise<ShareConsentFacts | null> {
  const { inquiry } = input;
  if (input.step.type !== 'share_consent') {
    return null;
  }
  const step = input.step;
  const [environment, version] = await Promise.all([
    getEnvironment(db, inquiry.environmentId),
    getInquiryTemplateVersion(db, inquiry.environmentId, inquiry.inquiryTemplateVersionId),
  ]);
  if (environment === null || version === null) {
    return null;
  }
  const caller: CrossTenantCaller = {
    organizationId: environment.organizationId,
    environmentId: environment.id,
    environmentKind: environment.kind,
  };
  let token: ConnectShareToken | null = null;
  let connectionId: string;
  if (step.side === 'source') {
    if (step.connectionId === undefined) return null;
    connectionId = step.connectionId;
  } else {
    token = await reservedShareToken(db, caller, inquiry.id);
    // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
    if (token === null) return null;
    connectionId = token.connectionId;
  }
  const connection = await getConnectionOfOrganization(db, caller.organizationId, connectionId);
  if (
    connection === null ||
    connection.status === 'archived' ||
    (step.side === 'source' && connection.sourceOrganizationId !== caller.organizationId) ||
    (step.side === 'destination' && connection.destinationOrganizationId !== caller.organizationId)
  ) {
    return null;
  }
  const names = await crossTenant.connectionOrganizationNames(db, caller, connection);
  let categories: ShareCategory[];
  // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
  if (token !== null) {
    categories = SHARE_CATEGORIES.filter((category) => token.dataCategories.includes(category));
  } else {
    const [policy] = await getSharePoliciesOfConnection(db, connection.id, [
      connection.currentPolicyId ?? '',
    ]);
    if (policy === undefined) return null;
    const fieldTypes = Object.fromEntries(
      storedFieldSchemas(version).map(({ key, type }) => [key, type]),
    );
    categories = policyShareCategories(
      policy.body as unknown as SharePolicyRules,
      'inquiry',
      fieldTypes,
    );
  }
  if (categories.length === 0) {
    return null;
  }
  const locale = localeOf(version, input.locale);
  const categoryWords = categoryWordsOf(locale);
  const keys = SHARE_CONSENT_TEXT_KEYS[step.side];
  const main = templateOf(version, locale, keys.main);
  if (categoryWords === null || main === null) {
    return null;
  }
  const templateRetention = (version.settings as Record<string, unknown>)['retention-days'];
  const environmentRetention = environment.settings['inquiry-retention-days'];
  const retentionDays =
    typeof templateRetention === 'number'
      ? templateRetention
      : typeof environmentRetention === 'number'
        ? environmentRetention
        : null;
  const validSeconds = step.consentValidSeconds ?? SHARE_CONSENT_VALID_SECONDS.default;
  const values = {
    locale,
    source: names.source,
    recipient: names.destination,
    categories,
    categoryWords,
    validSeconds,
    withdraw: step.withdrawalContact ?? '',
    retention: retentionDays === null ? null : { days: retentionDays },
  };
  const text = composeShareConsentText([main], values);
  if (!text.ok) {
    return null;
  }
  let biometric: { body: string; sha256: string } | null = null;
  if (categories.includes('biometric')) {
    const part = templateOf(version, locale, keys.biometric);
    const composed = part === null ? null : composeShareConsentText([part], values);
    if (!composed?.ok) {
      return null;
    }
    biometric = { body: composed.body, sha256: consentTextDigest(composed.body, {}, false) };
  }
  const view = shareConsentClientViewOf(step, {
    recipientName: names.destination,
    sourceName: names.source,
    categories,
    text: {
      locale,
      body: text.body,
      sha256: consentTextDigest(text.body, {}, false),
      keys: [...text.keys],
    },
    ...(biometric === null ? {} : { biometric }),
  });
  return {
    step,
    connectionId: connection.id,
    token,
    recipientOrganizationId:
      step.side === 'source' ? connection.destinationOrganizationId : caller.organizationId,
    view,
    bodies: { text: text.body, biometric: biometric?.body ?? null },
    validSeconds,
  };
}

/** The locale the session consented in, if it recorded one. */
async function sessionLocale(
  db: Db,
  inquiry: Inquiry,
  sessionId: string | null,
): Promise<string | null> {
  if (sessionId === null) return null;
  const session = await getInquirySession(db, inquiry.environmentId, sessionId);
  return session?.consent?.locale ?? null;
}

/** C238.3: the session's view of a `share_consent` step, or `null` when none can be composed. */
export async function shareConsentSessionView(
  db: Db,
  input: ShareConsentViewInput,
): Promise<ShareConsentClientView | null> {
  const facts = await shareConsentFacts(db, {
    inquiry: input.inquiry,
    step: input.step,
    locale: await sessionLocale(db, input.inquiry, input.sessionId),
  });
  return facts?.view ?? null;
}

/** The locale an exit recomposes the view in: the one the session served. */
export const shareConsentSessionLocale = sessionLocale;

/**
 * C237.6 (verification V02): the `share_consent` step a session's record was accepted at: the step of
 * the record's side, on a source side the one naming the record's connection.
 */
export function shareConsentStepOf(
  steps: readonly FlowV2Step[],
  record: { side: 'source' | 'destination'; connectionId: string },
): ShareConsentStep | undefined {
  return steps.find(
    (step): step is ShareConsentStep =>
      step.type === 'share_consent' &&
      step.side === record.side &&
      (record.side === 'destination' || step.connectionId === record.connectionId),
  );
}

/** C237.6: this session's accepted, unwithdrawn share consents (at most 20). */
export async function withdrawableShareConsents(
  db: Db,
  input: { inquiry: Inquiry; sessionId: string | null },
): Promise<FlowWithdrawableShareConsent[]> {
  if (input.sessionId === null) {
    return [];
  }
  const records = (
    await listSessionShareConsents(
      db,
      input.inquiry.environmentId,
      input.sessionId,
      WITHDRAWABLE_MAX,
    )
  ).filter((record) => record.subjectType === 'inquiry' && record.subjectId === input.inquiry.id);
  if (records.length === 0) {
    return [];
  }
  const version = await getInquiryTemplateVersion(
    db,
    input.inquiry.environmentId,
    input.inquiry.inquiryTemplateVersionId,
  );
  const parsed = version === null ? null : safeParseAnyFlow(version.flow);
  const steps = parsed?.success === true && isFlowV2(parsed.data) ? parsed.data.steps : [];
  const listed: FlowWithdrawableShareConsent[] = [];
  for (const record of records) {
    const step = shareConsentStepOf(steps, record);
    if (step !== undefined && !listed.some((entry) => entry['step-id'] === step.id)) {
      listed.push({
        'step-id': step.id,
        side: record.side,
        'recipient-name': record.recipientName,
      });
    }
  }
  return listed;
}

/** The labelled sample names and text of the template preview (no connection exists there). */
const PREVIEW = Object.freeze({
  source: 'Example Source (sample)',
  recipient: 'Example Partner (sample)',
  categories: ['identity-fields', 'check-results'] as ShareCategory[],
});

/**
 * The template preview's labelled sample view of a `share_consent` step (no connection, no token): the
 * built-in English text with sample names, so a preview never shows an uncomposed text.
 */
export function shareConsentPreviewView(step: FlowV2Step): ShareConsentClientView | null {
  if (step.type !== 'share_consent') {
    return null;
  }
  const key = SHARE_CONSENT_TEXT_KEYS[step.side].main;
  const text = releasedText('en', key);
  const categoryWords = categoryWordsOf('en');
  if (text === undefined || categoryWords === null) {
    return null;
  }
  const composed = composeShareConsentText(
    [{ key, text, builtIn: true, placeholders: COPY_KEYS[key]?.placeholders ?? [] }],
    {
      locale: 'en',
      source: PREVIEW.source,
      recipient: PREVIEW.recipient,
      categories: PREVIEW.categories,
      categoryWords,
      validSeconds: step.consentValidSeconds ?? SHARE_CONSENT_VALID_SECONDS.default,
      withdraw: step.withdrawalContact ?? 'contact us',
      retention: { days: 365 },
    },
  );
  if (!composed.ok) {
    return null;
  }
  return shareConsentClientViewOf(step, {
    recipientName: PREVIEW.recipient,
    sourceName: PREVIEW.source,
    categories: PREVIEW.categories,
    text: {
      locale: 'en',
      body: composed.body,
      sha256: consentTextDigest(composed.body, {}, false),
      keys: [...composed.keys],
    },
  });
}

/**
 * C238.1: whether a destination-side `share_consent` step is skipped on this inquiry: it was not
 * created with a share token, so there is nothing to accept (the engine leaves the step through
 * `next` with the outcome `skipped`).
 */
export async function destinationShareConsentSkipped(
  db: Db,
  inquiry: { id: string; environmentId: string },
  step: { type: string; side?: string } | undefined,
): Promise<boolean> {
  if (step?.type !== 'share_consent' || step.side !== 'destination') {
    return false;
  }
  const environment = await getEnvironment(db, inquiry.environmentId);
  if (environment === null) {
    return true;
  }
  const token = await reservedShareToken(
    db,
    {
      organizationId: environment.organizationId,
      environmentId: environment.id,
      environmentKind: environment.kind,
    },
    inquiry.id,
  );
  return token === null;
}
