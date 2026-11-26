/**
 * C162.2 (Workflow 9C, `dashboard-themes-copy`): the texts a template version's copy may hold, with
 * the rules of each, read on the server from `@openverify/flow-spec` (the definitions the API
 * checks against) and handed to the translations editor as plain data. Built-in keys come from
 * `COPY_KEYS`; component keys (`<step id>.<component id>.<attribute>`, an option by its key) from the
 * version's v2 screens, nested containers included. The rules themselves are the API's: the console
 * shows them and says a refusal in words, and never decides one.
 */
import 'server-only';
import { createHash } from 'node:crypto';
import type { TranslationRow } from '@openverify/contracts';
import {
  BIOMETRIC_CONSENT_COPY_KEYS,
  COMPONENT_COPY_ATTRIBUTES,
  COMPONENT_COPY_MAX_LENGTH,
  COPY_KEYS,
  BUILT_IN_LOCALES,
  LOCALE_REVIEW_STATUS,
  servedReviewStatus,
  type BuiltInLocale,
  type CopyLegalKind,
  type LocaleReviewStatus,
  type MessageTree,
} from '@openverify/flow-spec';
// R004: the catalogs as the flow exports them (its export test holds them to the flow's own).
import ar from '../../../../../contracts/fixtures/i18n/ar.json';
import de from '../../../../../contracts/fixtures/i18n/de.json';
import en from '../../../../../contracts/fixtures/i18n/en.json';
import es from '../../../../../contracts/fixtures/i18n/es.json';
import fr from '../../../../../contracts/fixtures/i18n/fr.json';
import type { LocaleReviewStatuses } from './locale-review';

const EXPORTED_CATALOGS: Readonly<Record<BuiltInLocale, MessageTree>> = {
  en: en.messages,
  es: es.messages,
  fr: fr.messages,
  de: de.messages,
  ar: ar.messages,
};

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** One text the editor offers, with the rules the API applies to it. */
export interface CopyKeyView {
  readonly key: string;
  readonly kind: 'built-in' | 'component';
  readonly step: string | null;
  readonly stepName: string | null;
  readonly component: string | null;
  /** A component's attribute (`label`, `option.<key>`), or the built-in key itself. */
  readonly attribute: string;
  readonly maxLength: number;
  readonly placeholders: readonly string[];
  readonly multiline: boolean;
  readonly consent: boolean;
  readonly legal: CopyLegalKind | null;
  /** A biometric consent text, whose override must state `{days}`. */
  readonly biometric: boolean;
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** The component keys of a v2 flow's screens, walked as stored JSON (any other shape: none). */
function componentKeys(flow: unknown): CopyKeyView[] {
  const keys: CopyKeyView[] = [];
  for (const rawStep of list(record(flow)?.steps)) {
    const step = record(rawStep);
    const stepId = text(step?.id);
    if (step === null || stepId === null || step.type !== 'screen') {
      continue;
    }
    const stepName = text(step.name);
    const add = (componentId: string, attribute: string) => {
      keys.push({
        key: `${stepId}.${componentId}.${attribute}`,
        kind: 'component',
        step: stepId,
        stepName,
        component: componentId,
        attribute,
        maxLength: COMPONENT_COPY_MAX_LENGTH,
        placeholders: ['organization'],
        multiline: false,
        consent: false,
        legal: null,
        biometric: false,
      });
    };
    const walk = (components: unknown[]) => {
      for (const rawComponent of components) {
        const component = record(rawComponent);
        const componentId = text(component?.id);
        if (component === null || componentId === null) {
          continue;
        }
        for (const attribute of COMPONENT_COPY_ATTRIBUTES) {
          add(componentId, attribute);
        }
        for (const option of list(component.options)) {
          const key = text(record(option)?.key);
          if (key !== null) {
            add(componentId, `option.${key}`);
          }
        }
        walk(list(component.children));
      }
    };
    walk(list(step.components));
  }
  return keys;
}

/** Every built-in key with its rules, then the version's component keys. */
export function copyKeyCatalog(flow: unknown): CopyKeyView[] {
  const builtIn = Object.entries(COPY_KEYS).map(([key, definition]): CopyKeyView => ({
    key,
    kind: 'built-in',
    step: null,
    stepName: null,
    component: null,
    attribute: key,
    maxLength: definition.maxLength,
    placeholders: definition.placeholders,
    multiline: definition.multiline,
    consent: definition.consent,
    legal: definition.legal,
    biometric: BIOMETRIC_CONSENT_COPY_KEYS.includes(key),
  }));
  return [...builtIn, ...componentKeys(flow)];
}

/** The API's translation rows as `{ <copy key>: { <locale>: text } }`. */
export function editorRowsOf(
  rows: readonly TranslationRow[],
): Record<string, Partial<Record<string, string>>> {
  return Object.fromEntries(
    rows.map((row) => [
      row.step === null || row.component === null
        ? row['attribute-name']
        : `${row.step}.${row.component}.${row['attribute-name']}`,
      Object.fromEntries(row['locale-values'].map(({ locale, value }) => [locale, value])),
    ]),
  );
}

/**
 * C161.5: the review status each built-in locale is served with, as plain data (R004: held by
 * `servedReviewStatus` to the exported catalog, as the API holds it); `declared` is the record
 * table (the built-in one by default).
 */
export function localeReviewStatuses(
  declared: Readonly<Record<BuiltInLocale, LocaleReviewStatus>> = LOCALE_REVIEW_STATUS,
): LocaleReviewStatuses {
  return Object.fromEntries(
    BUILT_IN_LOCALES.map((locale) => [
      locale,
      servedReviewStatus(locale, EXPORTED_CATALOGS[locale], sha256, declared),
    ]),
  );
}
