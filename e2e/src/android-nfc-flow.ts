/**
 * C224.3, C224.4 (Phase 10, Workflow 10C integration-10c): the 10C flow, which the API-driven spec
 * (`tests/flow-nfc-android.spec.ts`) and the SDK's own client (`:openverify-sdk:stackTest`,
 * `AndroidNfcFlowStackTest`) both drive. It is committed as JSON at `fixtures/android-10c/flow.json`,
 * so the Kotlin test reads the same template without TypeScript; `android-nfc-flow.test.ts` holds
 * the file to this builder and writes it only under `UPDATE_CONTRACT_FIXTURES=1` (rule 27). The 10A
 * flow (`android-flow.ts`) stays as it is.
 *
 * The flow: consent, a one-sided government ID (the Utopia TD3 passport page), a selfie, then the
 * chip. The `nfc` step's `exhausted` edge leads to a proof-of-address document, the author's
 * fallback for a client that cannot read a chip (C207.9); both paths end at the completion. The
 * fixture also names the generated inputs a client uploads (paths from the repository root; the
 * files are generated, never committed) and the inquiry's fields, the synthetic holder the bill and
 * the passport share. Every value is synthetic.
 */
import path from 'node:path';
import {
  DEFAULT_DOCUMENT_CHECKS,
  DEFAULT_GOVERNMENT_ID_NFC_CHECKS,
  defaultInquiryTemplateAttributes,
  PLAY_INTEGRITY_NOTICE_TEXT_KEY,
  type DefaultChecks,
} from '@openverify/contracts';
import { E2E_DIR } from './paths.js';

/** The committed copy of {@link androidNfcFlowFixture}'s output. */
export const ANDROID_NFC_FLOW_FILE = path.join(E2E_DIR, 'fixtures', 'android-10c', 'flow.json');

/** The step ids the clients see: the chip path, then the fallback. */
export const ANDROID_NFC_FLOW_STEPS = {
  consent: 'consent',
  idCard: 'id_card',
  face: 'face',
  chip: 'chip',
  papers: 'papers',
  done: 'done',
} as const;

export interface AndroidNfcFlowFixture {
  description: string;
  /** `POST /inquiry-templates` attributes without `name` (the template's first version is v1). */
  template: Record<string, unknown>;
  /** The v2 draft's attributes without `inquiry-template-id`, published by an operator. */
  version: Record<string, unknown>;
  /** The inquiry's prefilled fields: the holder of the passport page and of the bill. */
  'inquiry-fields': Record<string, string>;
  /** What a client uploads, as paths from the repository root (`fixtures/generated/`, C36, C65). */
  inputs: {
    'id-front': string;
    selfie: { center: string; left: string; right: string };
    document: string;
  };
}

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

const GENERATED = 'fixtures/generated';

/** The fixture: the default template to create, the 10C version to publish on it, and its inputs. */
export function androidNfcFlowFixture(): AndroidNfcFlowFixture {
  const defaults = defaultInquiryTemplateAttributes();
  const consent = defaults.flow.steps.find((step) => step.type === 'consent');
  const governmentId = defaults.flow.steps.find((step) => step.type === 'government_id');
  const selfie = defaults.flow.steps.find((step) => step.type === 'selfie');
  const governmentIdConfig = defaults['verification-config']['government-id'];
  const selfieConfig = defaults['verification-config'].selfie;
  if (
    consent?.type !== 'consent' ||
    governmentId === undefined ||
    selfie === undefined ||
    governmentIdConfig === undefined ||
    selfieConfig === undefined
  ) {
    throw new Error('The default template has no consent, government ID or selfie step');
  }
  const template: Record<string, unknown> = { ...defaults };
  delete template.name;
  const ids = ANDROID_NFC_FLOW_STEPS;
  return {
    description:
      "C224.3, C224.4 (Workflow 10C): the 10C flow (consent, a one-sided government ID, a selfie, the chip, and a proof-of-address document on the chip step's exhausted edge), driven by e2e/tests/flow-nfc-android.spec.ts and :openverify-sdk:stackTest. Written by e2e/src/android-nfc-flow.test.ts under UPDATE_CONTRACT_FIXTURES=1; synthetic.",
    template,
    version: {
      flow: {
        metadata: { specVersion: 2, id: 'e2e-android-10c', version: 1, name: 'Android chip' },
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
          { ...governmentId, id: ids.idCard, sides: 'front' },
          { ...selfie, id: ids.face },
          { id: ids.chip, type: 'nfc', androidOnly: true },
          {
            id: ids.papers,
            type: 'document',
            documentTypes: ['utility_bill', 'bank_statement'],
            captureMethods: ['upload'],
          },
          { id: ids.done, type: 'completion' },
        ],
        edges: [
          edge('e1', ids.consent, 'next', ids.idCard),
          edge('e2', ids.idCard, 'next', ids.face),
          edge('e3', ids.face, 'next', ids.chip),
          edge('e4', ids.chip, 'next', ids.done),
          edge('e5', ids.chip, 'exhausted', ids.papers),
          edge('e6', ids.papers, 'next', ids.done),
        ],
      },
      'verification-config': {
        'government-id': governmentIdConfig,
        // The clients here upload stills (the sandbox fallback, C19), which liveness cannot judge
        // (`capture_not_live`): advisory, so an uploaded selfie passes on its other checks and the
        // inquiry's outcome is the chip step's.
        selfie: {
          ...selfieConfig,
          checks: {
            ...selfieConfig.checks,
            selfie_liveness_detection: { enabled: true, required: false },
          },
        },
        'government-id-nfc': typeConfigOf(DEFAULT_GOVERNMENT_ID_NFC_CHECKS),
        document: typeConfigOf(DEFAULT_DOCUMENT_CHECKS),
      },
      'signal-config': { collect: 'default' },
      'enabled-locales': ['en'],
      'default-locale': 'en',
    },
    // The synthetic holder of `fixtures/generated/nfc/td3-passport.jpg` and of the bill (C65.2).
    'inquiry-fields': {
      name_first: 'Nora',
      name_last: 'Calderwood',
      address_street_1: '27 Harbour Road',
      address_city: 'Meridale',
      address_postal_code: '00041',
      address_country_code: 'US',
      address_subdivision: 'UT',
    },
    inputs: {
      'id-front': `${GENERATED}/nfc/td3-passport.jpg`,
      selfie: {
        center: `${GENERATED}/selfie/head-turn-a-center.jpg`,
        left: `${GENERATED}/selfie/head-turn-a-left.jpg`,
        right: `${GENERATED}/selfie/head-turn-a-right.jpg`,
      },
      document: `${GENERATED}/poa/en/utility-bill/happy.pdf`,
    },
  };
}
