/**
 * C287.4 (Workflow 11A integration-11a): the two flows of the client-side redemption that
 * `:openverify-sdk:stackTest`'s `AndroidConnectFlowStackTest` drives with the SDK's own client. The
 * source (the sample partner) runs consent, a one-sided government ID and the source-side
 * `share_consent`; the destination (the dev organisation) creates an inquiry with
 * `meta.share-token-id` and runs consent and the destination-side `share_consent`, whose accept asks
 * for the `fill-inquiry` redemption. The source step's `connectionId` is the run's own connection,
 * set by the test, so the fixture names none. Every value is synthetic.
 */
import path from 'node:path';
import {
  defaultInquiryTemplateAttributes,
  PLAY_INTEGRITY_NOTICE_TEXT_KEY,
} from '@openverify/contracts';
import { E2E_DIR } from './paths.js';

/** The committed copy of {@link androidConnectFlowFixture}'s output. */
export const ANDROID_CONNECT_FLOW_FILE = path.join(E2E_DIR, 'fixtures', 'android-11a', 'flow.json');

/** The step ids the SDK sees on each side. */
export const ANDROID_CONNECT_FLOW_STEPS = {
  consent: 'consent',
  idCard: 'id_card',
  shareOut: 'share_out',
  shareIn: 'share_in',
  done: 'done',
} as const;

interface SideFlow {
  /** `POST /inquiry-templates` attributes without `name`. */
  template: Record<string, unknown>;
  /** The v2 draft's attributes without `inquiry-template-id`, published by an operator. */
  version: Record<string, unknown>;
}

export interface AndroidConnectFlowFixture {
  description: string;
  /** The share policy of the connection the test creates (government ID data, no biometric). */
  'share-policy': Record<string, unknown>;
  source: SideFlow;
  destination: SideFlow;
  /** What the source's person uploads, from the repository root (`fixtures/generated/`). */
  inputs: { 'id-front': string };
}

const edge = (id: string, from: string, to: string) => ({ id, from, port: 'next', to });

/** The fixture of the client-side redemption (see the header). */
export function androidConnectFlowFixture(): AndroidConnectFlowFixture {
  const defaults = defaultInquiryTemplateAttributes();
  const consent = defaults.flow.steps.find((step) => step.type === 'consent');
  const governmentId = defaults.flow.steps.find((step) => step.type === 'government_id');
  const governmentIdConfig = defaults['verification-config']['government-id'];
  if (
    consent?.type !== 'consent' ||
    governmentId === undefined ||
    governmentIdConfig === undefined
  ) {
    throw new Error('The default template has no consent or government ID step');
  }
  const template: Record<string, unknown> = { ...defaults };
  delete template.name;
  const ids = ANDROID_CONNECT_FLOW_STEPS;
  // C211.9 (Workflow 10B): the stack binds the sandbox deviceIntegrity provider, so the consent
  // shows notice.play-integrity beside the session-integrity notice.
  const consentStep = {
    id: ids.consent,
    type: 'consent',
    textKeys: [...consent.textKeys, PLAY_INTEGRITY_NOTICE_TEXT_KEY],
    required: true,
  };
  const locales = { 'enabled-locales': ['en'], 'default-locale': 'en' };
  return {
    description:
      'C287.4 (Workflow 11A): the client-side redemption driven by :openverify-sdk:stackTest (AndroidConnectFlowStackTest): the source flow (consent, a one-sided government ID, the source-side share_consent, whose connectionId the test sets) and the destination flow (consent, the destination-side share_consent). Written by e2e/src/android-connect-flow.test.ts under UPDATE_CONTRACT_FIXTURES=1; synthetic.',
    'share-policy': {
      purpose: 'share.reuse-kyc',
      'source-types': ['inquiry'],
      verifications: {
        types: ['government-id'],
        'extracted-data': true,
        'check-results': true,
        files: false,
      },
      fields: { inquiry: [], account: [], transaction: [] },
      biometric: false,
      peek: { 'inquiry.status': 'full' },
      'attested-consent': 'non-biometric',
    },
    source: {
      template,
      version: {
        flow: {
          metadata: { specVersion: 2, id: 'e2e-android-11a-source', version: 1, name: 'Share out' },
          entry: ids.consent,
          steps: [
            consentStep,
            { ...governmentId, id: ids.idCard, sides: 'front', maxAttempts: 1 },
            {
              id: ids.shareOut,
              type: 'share_consent',
              side: 'source',
              withdrawalContact: 'Write to privacy@example.com',
            },
            { id: ids.done, type: 'completion' },
          ],
          edges: [
            edge('e1', ids.consent, ids.idCard),
            edge('e2', ids.idCard, ids.shareOut),
            edge('e3', ids.shareOut, ids.done),
          ],
        },
        'verification-config': { 'government-id': governmentIdConfig },
        ...locales,
      },
    },
    destination: {
      template,
      version: {
        flow: {
          metadata: {
            specVersion: 2,
            id: 'e2e-android-11a-destination',
            version: 1,
            name: 'Share in',
          },
          entry: ids.consent,
          steps: [
            consentStep,
            {
              id: ids.shareIn,
              type: 'share_consent',
              side: 'destination',
              withdrawalContact: 'Write to privacy@example.com',
            },
            // accept-cloned-results is off (H01): the ID step runs live beside the clone.
            { ...governmentId, id: ids.idCard, sides: 'front', maxAttempts: 1 },
            { id: ids.done, type: 'completion' },
          ],
          edges: [
            edge('e1', ids.consent, ids.shareIn),
            edge('e2', ids.shareIn, ids.idCard),
            edge('e3', ids.idCard, ids.done),
          ],
        },
        'verification-config': { 'government-id': governmentIdConfig },
        // C238.9: a destination text states the retention term.
        settings: { 'retention-days': 365 },
        ...locales,
      },
    },
    inputs: { 'id-front': 'fixtures/generated/nfc/td3-passport.jpg' },
  };
}
