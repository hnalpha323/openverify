/**
 * C238.6 (Phase 11, Workflow 11A; `clients-connect`): the web flow at a `share_consent` step. Owned
 * by `clients-connect`; `flow/flow-position.ts` and `flow/flow-renderer.tsx` (shared) dispatch the
 * step here.
 *
 * The person is shown what the server composed (C238.3) and nothing composed here: the text as it
 * was served, in paragraphs and in its own language, the recipient and the source by name, the
 * categories in words, and, when the share carries biometric data, the separate biometric text as
 * the label of its own box, unticked. "I agree" sends the SHA-256 of each text this screen displayed
 * and the tick; "Do not share" sends nothing else, and the flow goes on either way (consent is free,
 * C238.1). Before it reports a digest, the screen takes it over the text it displayed: a text whose
 * digest is not the one served is never reported shown, and the screen becomes the unsupported one
 * (as on Android, C238.7). A category this client has no words for is the unsupported screen too,
 * since the person could not be told what is shared. The digest records which text was served and
 * reported shown; it does not prove that the person read it (C238.8).
 *
 * The wait and a refusal are announced (C171); a missing tick is said at the box, which takes focus.
 * It writes no inline style (C160.9).
 */
import type { FlowShareConsentAcceptBody } from '@openverify/contracts';
import type { ShareConsentClientView } from '@openverify/flow-spec';
import { Alert, Button, Card, Checkbox } from '@openverify/ui';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessageKey, type ErrorMessageKey } from '../../api/error-message';
import type { FlowApiClient } from '../../api/flow-api-client';
import { useIsolatedT } from '../../i18n/bidi';
import { textSha256 } from '../../lib/text-digest';
import { UnsupportedStep } from '../unsupported-step';
import { WaitingStatus } from '../waiting';

export interface ShareConsentStepProps {
  /** The step's client view, composed by the server (C238.3). */
  readonly step: ShareConsentClientView;
  readonly client: FlowApiClient;
  /** Reads the session again once the server recorded the choice. */
  readonly onDone: () => Promise<void>;
}

/** The words of each share category (C230.4), as `share.categories.<category>`. */
const CATEGORY_KEYS = {
  'identity-fields': 'share.categories.identity-fields',
  'contact-fields': 'share.categories.contact-fields',
  'other-fields': 'share.categories.other-fields',
  'document-images': 'share.categories.document-images',
  biometric: 'share.categories.biometric',
  'check-results': 'share.categories.check-results',
} as const;

type KnownCategory = keyof typeof CATEGORY_KEYS;

function isKnownCategory(category: string): category is KnownCategory {
  return Object.hasOwn(CATEGORY_KEYS, category);
}

/** The text's paragraphs, as the server separated them (a blank line between two). */
function paragraphsOf(body: string): string[] {
  return body.split(/\n{2,}/u).filter((paragraph) => paragraph.trim().length > 0);
}

/** The SHA-256 of `text` as displayed, or `null` when this browser cannot digest it. */
async function displayedDigest(text: string): Promise<string | null> {
  try {
    return await textSha256(text);
  } catch {
    return null;
  }
}

/**
 * The accept body for the texts as displayed, or `null` when a displayed text is not the one the
 * server served (or cannot be digested), which is never reported shown.
 */
async function acceptBody(
  step: ShareConsentClientView,
  ticked: boolean,
): Promise<FlowShareConsentAcceptBody | null> {
  const text = await displayedDigest(step.text.body);
  if (text === null || text !== step.text.sha256) {
    return null;
  }
  if (step.biometric === undefined) {
    return { 'text-sha256': text, 'explicit-biometric': false };
  }
  const biometric = await displayedDigest(step.biometric.body);
  if (biometric === null || biometric !== step.biometric.sha256) {
    return null;
  }
  return {
    'text-sha256': text,
    'biometric-text-sha256': biometric,
    'explicit-biometric': ticked,
  };
}

/** The share-consent step: the server's text, the choice, and nothing composed here. */
export function ShareConsentStep({ step, client, onDone }: ShareConsentStepProps) {
  const { t, i18n } = useTranslation();
  const tb = useIsolatedT();
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorMessageKey | null>(null);
  const [tickMissing, setTickMissing] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  const tickErrorId = useId();

  if (mismatch || !step.categories.every(isKnownCategory)) {
    return <UnsupportedStep step={step} reason="step" />;
  }

  const language = i18n.resolvedLanguage ?? i18n.language;
  const textLanguage = step.text.locale.split('-')[0] === language ? undefined : step.text.locale;

  const settle = async (send: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await send();
    } catch (failure: unknown) {
      setError(errorMessageKey(failure));
      setBusy(false);
      return;
    }
    await onDone();
  };

  const accept = async () => {
    if (step.biometric !== undefined && !ticked) {
      setTickMissing(true);
      box.current?.focus();
      return;
    }
    const body = await acceptBody(step, ticked);
    if (body === null) {
      setMismatch(true);
      return;
    }
    await settle(() => client.acceptShareConsent(step.id, body));
  };

  return (
    <Card title={tb('share.consent.title', { recipient: step.recipientName })} headingLevel={1}>
      <form
        className="flex flex-col gap-6"
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) {
            void accept();
          }
        }}
      >
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-semibold">{t('share.step.sharedBy')}</dt>
            <dd>
              <bdi>{step.sourceName}</bdi>
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-semibold">{t('share.step.sharedWith')}</dt>
            <dd>
              <bdi>{step.recipientName}</bdi>
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="font-semibold">{t('share.step.whatIsShared')}</dt>
            <dd>
              <ul className="list-disc ps-6">
                {step.categories.filter(isKnownCategory).map((category) => (
                  <li key={category}>{t(CATEGORY_KEYS[category])}</li>
                ))}
              </ul>
            </dd>
          </div>
        </dl>
        <div
          className="flex flex-col gap-3 whitespace-pre-line"
          dir="auto"
          data-share-consent-text={step.text.keys.join(' ')}
          {...(textLanguage === undefined ? {} : { lang: textLanguage })}
        >
          {paragraphsOf(step.text.body).map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
        {step.biometric !== undefined && (
          <div className="flex flex-col gap-2">
            <Checkbox
              ref={box}
              label={
                <span dir="auto" {...(textLanguage === undefined ? {} : { lang: textLanguage })}>
                  {step.biometric.body}
                </span>
              }
              checked={ticked}
              disabled={busy}
              aria-invalid={tickMissing && !ticked ? true : undefined}
              aria-describedby={tickMissing && !ticked ? tickErrorId : undefined}
              onChange={(event) => {
                setTicked(event.currentTarget.checked);
              }}
            />
            {tickMissing && !ticked && (
              <Alert tone="error" id={tickErrorId}>
                {t('share.step.biometricRequired')}
              </Alert>
            )}
          </div>
        )}
        {busy && <WaitingStatus message={t('share.step.saving')} />}
        {error !== null && <Alert tone="error">{t(error)}</Alert>}
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              void settle(() => client.declineShareConsent(step.id));
            }}
          >
            {t('share.consent.decline')}
          </Button>
          <Button type="submit" disabled={busy}>
            {t('share.consent.accept')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
