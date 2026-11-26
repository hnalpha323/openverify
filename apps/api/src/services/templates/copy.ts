/**
 * C162.5, C162.6 (Workflow 9A): the operator copy a session carries: for the version's enabled
 * locales, the built-in-key overrides and the component texts of the **current** step only, never
 * another step's (review P14). Owner: `api-templates`; the call in the session builder
 * (`getFlowSession`, `services/flow.ts`) was placed by `foundation-9a` (Stage 1b (T)). The texts are
 * sent unfilled: each client fills `{name}` from the session; the fallbacks of C162.5 (the person's
 * locale, its built-in text, the default locale) are the client's, so no raw key is ever shown.
 */
import { COPY_KEYS } from '@openverify/flow-spec';
import type { TemplateCopy } from '@openverify/contracts';
import type { Db, Inquiry, InquiryTemplateVersion } from '@openverify/db';
import { storedCopy } from './versions.js';

/** What the session's copy is resolved for. */
export interface SessionCopyRequest {
  inquiry: Inquiry;
  version: InquiryTemplateVersion;
  /** The step the position names; `null` before the position starts. */
  stepId: string | null;
}

/** The copy the session carries, or `null` for none (the member is left out). */
export function resolveCopyForSession(
  _db: Db,
  request: SessionCopyRequest,
): Promise<TemplateCopy | null> {
  const { version, stepId } = request;
  const copy = storedCopy(version);
  const enabled = new Set<string>(version.enabledLocales);
  const prefix = stepId === null ? null : `${stepId}.`;
  const messages: TemplateCopy['messages'] = {};
  for (const [locale, texts] of Object.entries(copy.messages)) {
    if (!enabled.has(locale)) continue;
    const kept = Object.fromEntries(
      Object.entries(texts).filter(
        ([key]) => COPY_KEYS[key] !== undefined || (prefix !== null && key.startsWith(prefix)),
      ),
    );
    if (Object.keys(kept).length > 0) {
      messages[locale as keyof TemplateCopy['messages']] = kept;
    }
  }
  return Promise.resolve(Object.keys(messages).length === 0 ? null : { messages });
}
