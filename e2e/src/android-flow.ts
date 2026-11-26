/**
 * C224.3, C224.4 (Phase 10, Workflow 10A integration-10a): the 10A flow, which the API-driven spec
 * (`tests/flow-android.spec.ts`) and the SDK's own client (`:openverify-sdk:stackTest`) both drive.
 * It is committed as JSON at `fixtures/android-10a/flow.json`, so the Kotlin test reads the same
 * template without TypeScript; `android-flow.test.ts` holds the file to this builder and writes it
 * only under `UPDATE_CONTRACT_FIXTURES=1` (rule 21).
 *
 * The flow: consent, a database verification (a version needs a verification step, and the sandbox
 * database decides it with no camera), a content screen, then a branch on `session.locale`, which
 * the consent's `locale` sets (D2): Spanish takes a second screen before the completion, anything
 * else goes straight to it. Every value is synthetic.
 */
import path from 'node:path';
import {
  DEFAULT_DATABASE_CHECKS,
  defaultInquiryTemplateAttributes,
  PLAY_INTEGRITY_NOTICE_TEXT_KEY,
  type DefaultChecks,
} from '@openverify/contracts';
import { E2E_DIR } from './paths.js';

/** The committed copy of {@link androidFlowFixture}'s output. */
export const ANDROID_FLOW_FILE = path.join(E2E_DIR, 'fixtures', 'android-10a', 'flow.json');

/** The database step's fields: a name, a birth date and a street address. */
export const ANDROID_FLOW_DATABASE_FIELDS = [
  'name_first',
  'name_last',
  'birthdate',
  'address_street_1',
  'address_city',
  'address_postal_code',
  'address_country_code',
] as const;

/** The step ids the clients see, in the order a Spanish session meets them. */
export const ANDROID_FLOW_STEPS = {
  consent: 'consent',
  records: 'records',
  hello: 'hello',
  branch: 'by_language',
  hola: 'hola',
  done: 'done',
} as const;

/** Every check of a type at its registry default (the e2e specs' `typeConfig`). */
function typeConfigOf(defaults: DefaultChecks) {
  const checks: Record<string, { enabled: boolean; required: boolean }> = {};
  for (const id of defaults.required) {
    checks[id] = { enabled: true, required: true };
  }
  for (const id of defaults.advisory) {
    checks[id] = { enabled: true, required: false };
  }
  for (const id of defaults.disabled) {
    checks[id] = { enabled: false, required: false };
  }
  return { checks };
}

const edge = (id: string, from: string, port: string, to: string) => ({ id, from, port, to });

const screen = (id: string) => ({
  id,
  type: 'screen',
  components: [
    { id: 'heading', kind: 'text', variant: 'title', copyKey: `${id}.heading.title` },
    { id: 'go', kind: 'button', labelKey: 'screen.continue', action: 'submit' },
  ],
});

export interface AndroidFlowFixture {
  description: string;
  /** `POST /inquiry-templates` attributes without `name` (the template's first version is v1). */
  template: Record<string, unknown>;
  /** The v2 draft's attributes without `inquiry-template-id`, published by an operator. */
  version: Record<string, unknown>;
}

/** The fixture: the default template to create, and the 10A version to draft and publish on it. */
export function androidFlowFixture(): AndroidFlowFixture {
  const defaults = defaultInquiryTemplateAttributes();
  const consent = defaults.flow.steps.find((step) => step.type === 'consent');
  if (consent?.type !== 'consent') {
    throw new Error('The default template has no consent step');
  }
  const template: Record<string, unknown> = { ...defaults };
  delete template.name;
  const ids = ANDROID_FLOW_STEPS;
  return {
    description:
      'C224.3, C224.4 (Workflow 10A): the 10A flow (consent, a sandbox database step, a screen, a branch on session.locale, a Spanish screen, a completion), driven by e2e/tests/flow-android.spec.ts and :openverify-sdk:stackTest. Written by e2e/src/android-flow.test.ts under UPDATE_CONTRACT_FIXTURES=1; synthetic.',
    template,
    version: {
      flow: {
        metadata: { specVersion: 2, id: 'e2e-android-10a', version: 1, name: 'Android renderer' },
        entry: ids.consent,
        steps: [
          // C211.9 (Workflow 10B): the stack binds the sandbox deviceIntegrity provider, so the
          // consent shows notice.play-integrity beside the session-integrity notice.
          {
            id: ids.consent,
            type: 'consent',
            textKeys: [...consent.textKeys, PLAY_INTEGRITY_NOTICE_TEXT_KEY],
            required: true,
          },
          { id: ids.records, type: 'database', fields: [...ANDROID_FLOW_DATABASE_FIELDS] },
          screen(ids.hello),
          {
            id: ids.branch,
            type: 'branch',
            routes: [
              {
                key: 'spanish',
                label: 'Spanish',
                condition: { '===': [{ var: 'session.locale' }, 'es'] },
                onNull: 'else',
              },
            ],
          },
          screen(ids.hola),
          { id: ids.done, type: 'completion' },
        ],
        edges: [
          edge('e1', ids.consent, 'next', ids.records),
          edge('e2', ids.records, 'next', ids.hello),
          edge('e3', ids.hello, 'next', ids.branch),
          edge('e4', ids.branch, 'route:spanish', ids.hola),
          edge('e5', ids.branch, 'else', ids.done),
          edge('e6', ids.hola, 'next', ids.done),
        ],
      },
      'verification-config': { database: typeConfigOf(DEFAULT_DATABASE_CHECKS) },
      'signal-config': { collect: 'default' },
      copy: {
        messages: {
          en: { 'hello.heading.title': 'Almost done', 'hola.heading.title': 'One more screen' },
          es: { 'hello.heading.title': 'Casi listo', 'hola.heading.title': 'Una pantalla más' },
        },
      },
      'enabled-locales': ['en', 'es'],
      'default-locale': 'en',
    },
  };
}
