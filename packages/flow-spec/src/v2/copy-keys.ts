/**
 * C162.2 (owner of the contents `api-templates`; reviews P26, H14, F28): the built-in keys an
 * operator may override, each with its rules. The shape is frozen in Workflow 9A Stage 1a;
 * `api-templates` fills `COPY_KEYS`. Component copy keys (`<step id>.<component id>.<attribute>`)
 * have their own schema of at most `COMPONENT_COPY_MAX_LENGTH` characters.
 */

/** The texts with legal weight (C162.2): overriding one in production needs `legal-copy:<key>`. */
export const COPY_LEGAL_KINDS = ['consent', 'notice', 'decision', 'retention'] as const;
export type CopyLegalKind = (typeof COPY_LEGAL_KINDS)[number];

export interface CopyKeyDefinition {
  readonly maxLength: number;
  /** The closed list of `{name}` placeholders the text may use, such as `days`. */
  readonly placeholders: readonly string[];
  /** A consent text: required in every enabled locale once overridden (C162.4). */
  readonly consent: boolean;
  /** Line feeds allowed. */
  readonly multiline: boolean;
  readonly legal: CopyLegalKind | null;
}

/** The attributes of a component's copy key; an option is `option.<option key>`. */
export const COMPONENT_COPY_ATTRIBUTES = [
  'label',
  'hint',
  'title',
  'body',
  'button',
  'alt',
] as const;
export type ComponentCopyAttribute = (typeof COMPONENT_COPY_ATTRIBUTES)[number];

export const COMPONENT_COPY_MAX_LENGTH = 255;

/** One placeholder form, `{name}`, which both clients fill (C162.3). */
export const COPY_PLACEHOLDER_SOURCE = '\\{([a-z][a-z0-9_]{0,39})\\}';

const text = (
  maxLength: number,
  placeholders: readonly string[] = ['organization'],
  multiline = false,
): CopyKeyDefinition => ({ maxLength, placeholders, consent: false, multiline, legal: null });

/** A consent text (C162.4): legal weight, in every enabled locale once overridden. */
const consentText = (placeholders: readonly string[] = ['organization']): CopyKeyDefinition => ({
  maxLength: 2000,
  placeholders,
  consent: true,
  multiline: true,
  legal: 'consent',
});

/** A notice (Phase 7's `notice.*`): legal weight, shown in place of a consent on a screen. */
const noticeText = (): CopyKeyDefinition => ({
  maxLength: 2000,
  placeholders: ['organization'],
  consent: false,
  multiline: true,
  legal: 'notice',
});

/**
 * C238.3 (Phase 11, Workflow 11A): the closed placeholders of the `share.consent.*` texts, each
 * filled by the server: the source's and the recipient's names, the categories in words, the
 * consent's expiry, how to withdraw (the step's `withdrawalContact`) and, on the destination side,
 * the destination's retention term (C238.9).
 */
export const SHARE_CONSENT_PLACEHOLDERS = Object.freeze([
  'source',
  'recipient',
  'categories',
  'expires',
  'withdraw',
  'retention',
] as const);

/**
 * A `share.consent.*` text (C238.3, C238.10): legal weight (`consent`), composed by the server, and
 * not a consent step's text (`consent: false`), so Phase 9's consent-step rules do not apply to it.
 */
const shareConsentText = (
  maxLength: number,
  placeholders: readonly string[],
  multiline: boolean,
): CopyKeyDefinition => ({ maxLength, placeholders, consent: false, multiline, legal: 'consent' });

/**
 * Built-in key to its rules (ours; the public product does not publish its list). The texts an
 * operator may word for their own flow: the consent and notice texts, the terminal titles and the
 * flow's own buttons and states. A biometric consent text states the face-template retention
 * through `{days}`, which the server fills (P26); every other key takes `{organization}` only.
 * Maximums are provisional (ours): two screens of text for a legal text, a heading's length for a
 * title, a button's for a button.
 */
export const COPY_KEYS: Readonly<Record<string, CopyKeyDefinition>> = Object.freeze({
  'consent.title': text(120),
  'consent.biometric': consentText(['days', 'organization']),
  'consent.biometric-matching': consentText(['days', 'organization']),
  'consent.processing': consentText(),
  'consent.device-recognition': consentText(),
  'consent.automated-decision': consentText(),
  'consent.checkbox': consentText(),
  'consent.continue': text(40, []),
  'notice.session-integrity': noticeText(),
  'notice.device-recognition': noticeText(),
  // C211.9, decision 66 (Workflow 10B): the notice that names Google as a recipient of the Play
  // Integrity request; publish requires it beside the session-integrity notice when a
  // deviceIntegrity provider is bound (play_integrity_notice_missing).
  'notice.play-integrity': noticeText(),
  'completion.title': text(120),
  'failure.title': text(120),
  'screen.continue': text(40, []),
  'screen.help': text(80),
  'screen.helpLink': text(80),
  'screen.privacyLink': text(80),
  'screen.waiting.title': text(120),
  'screen.waiting.message': text(500, ['organization'], true),
  'screen.halted.title': text(120),
  'screen.halted.message': text(500, ['organization'], true),
  // C238.3, C238.9, C238.10 (Phase 11, Workflow 11A): the share-consent step's texts, each with
  // legal weight; the built-in ones are counsel-unreviewed (COUNSEL_REVIEW_STATUS).
  'share.consent.title': shareConsentText(120, ['recipient'], false),
  'share.consent.source': shareConsentText(
    4000,
    ['source', 'recipient', 'categories', 'expires', 'withdraw'],
    true,
  ),
  'share.consent.destination': shareConsentText(
    4000,
    ['source', 'recipient', 'categories', 'expires', 'withdraw', 'retention'],
    true,
  ),
  'share.consent.biometric-source': shareConsentText(2000, ['source', 'recipient'], true),
  'share.consent.biometric-destination': shareConsentText(
    2000,
    ['source', 'recipient', 'retention'],
    true,
  ),
  'share.consent.accept': shareConsentText(40, [], false),
  'share.consent.decline': shareConsentText(40, [], false),
  'share.consent.withdraw': shareConsentText(80, ['recipient'], false),
});

/** C162.2 (P26): the biometric consent texts, whose override must state `{days}`. */
export const BIOMETRIC_CONSENT_COPY_KEYS: readonly string[] = Object.freeze([
  'consent.biometric',
  'consent.biometric-matching',
]);
