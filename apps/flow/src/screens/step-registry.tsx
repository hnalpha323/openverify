/**
 * C151.5, C156.3 (Workflow 9A, flow-renderer): which screen renders each client step type. The web
 * flow renders the server's current step through it, and the preview (`apps/flow/src/preview/`,
 * `flow-server-embed`) renders every renderable step of a preview document through it, with no
 * client: a step that needs the network or the camera (`PREVIEW_PLACEHOLDER_TYPES`) is drawn by the
 * preview as a still placeholder instead (C156.3), and everything else with these same components.
 */
import type { ClientStepView } from '@openverify/flow-spec';
import type { ReactNode } from 'react';
import { ConsentScreen } from '../components/consent-screen';
import { CompletionScreen, FailureScreen } from '../steps/outcome-screens';
import { ScreenStep, type ScreenStepProps } from './screen-step';

/** Every client step type (C151.5's allowlist), by how it renders. */
export type ClientStepType = ClientStepView['type'];

/**
 * The types whose screen needs the flow API or the camera: a capture, a code, a wallet, a form that
 * creates a verification, a handoff. The preview draws each as a placeholder (C156.3).
 */
export const PREVIEW_PLACEHOLDER_TYPES = [
  'government_id',
  'selfie',
  'document',
  'phone_otp',
  'email_otp',
  'database',
  'aamva',
  'nfc',
  'crypto_wallet',
  'database_business',
  'business_website',
  'device_handoff',
  // C238.6 (Workflow 11A): accept and decline post to the flow API.
  'share_consent',
] as const satisfies readonly ClientStepType[];

/** The types rendered without a client, by the same components as the live flow. */
export const PREVIEWABLE_TYPES = [
  'consent',
  'screen',
  'completion',
  'failure',
] as const satisfies readonly ClientStepType[];

export type PreviewableStep = Extract<ClientStepView, { type: (typeof PREVIEWABLE_TYPES)[number] }>;

export function isPreviewable(step: ClientStepView): step is PreviewableStep {
  return (PREVIEWABLE_TYPES as readonly string[]).includes(step.type);
}

export interface StaticStepProps {
  readonly step: PreviewableStep;
  /** The session's (or the preview document's) `values`. */
  readonly values?: ScreenStepProps['values'];
  readonly copy: ScreenStepProps['copy'];
  /** What a screen's submit or a consent's Continue does; the preview's does nothing. */
  readonly onSubmit?: ScreenStepProps['onSubmit'];
  readonly onConsent?: (optionalTextKeys: readonly string[]) => void;
  readonly links?: ScreenStepProps['links'];
  readonly asset?: ScreenStepProps['asset'];
}

const noSubmit = () => Promise.resolve();

/**
 * C156.3: a previewable step with the live flow's own components and no network: the consent
 * texts as shown, a screen and its components, the completion and failure screens.
 */
export function StaticStep({
  step,
  values,
  copy,
  onSubmit = noSubmit,
  onConsent,
  links,
  asset,
}: StaticStepProps): ReactNode {
  switch (step.type) {
    case 'screen':
      return (
        <ScreenStep
          step={step}
          values={values}
          copy={copy}
          onSubmit={onSubmit}
          {...(links === undefined ? {} : { links })}
          {...(asset === undefined ? {} : { asset })}
        />
      );
    case 'consent':
      return (
        <ConsentScreen
          textKeys={step.textKeys}
          onContinue={(optional) => {
            onConsent?.(optional);
          }}
        />
      );
    case 'completion':
      return <CompletionScreen step={step} />;
    case 'failure':
      return <FailureScreen step={step} />;
  }
}
