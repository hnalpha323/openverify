/**
 * C207.10 (Phase 10, Workflow 10C): the web flow at an `nfc` step. Owned by `api-nfc`;
 * `flow/flow-position.ts` and `flow/flow-renderer.tsx` (shared) dispatch the step here. A browser
 * cannot read a document chip, so this screen says so: "reading a document chip needs the
 * organisation's app; a browser cannot read it" (never "a phone with NFC", which would send the
 * person to the same web page on another phone; review H11).
 *
 * When the step's client view has `fallbackAvailable`, it offers "use another way": the step's
 * verification is created (or the open one is reused), the client-unable route is told
 * `platform_unsupported` (C207.9), and the session is read again for the server's position. The
 * person is never told where the other way leads or how the inquiry is then judged: the server
 * decides both. Without a fallback there is nothing to offer but the organisation's app.
 *
 * Nothing is asked of the server until the person chooses. It writes no inline style (C160.9).
 */
import { Alert, Button, Card } from '@openverify/ui';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessageKey, type ErrorMessageKey } from '../../api/error-message';
import type { FlowApiClient } from '../../api/flow-api-client';
import type { NfcStepView } from '../../flow/flow-position';
import { WaitingStatus } from '../waiting';

export interface NfcStepProps {
  /** The `nfc` step: the projection's, or (spec 2) the client view with `fallbackAvailable`. */
  readonly step: NfcStepView;
  readonly client: FlowApiClient;
  /** Reads the session again, once the server took the report and moved the position. */
  readonly onDone: () => Promise<void>;
}

/** The reason a browser gives: the platform cannot read a chip at all (C207.9). */
const WEB_REASON = 'platform_unsupported';

/** Whether the step, as served, has a fallback the person may take. */
function hasFallback(step: NfcStepView): boolean {
  return 'fallbackAvailable' in step && step.fallbackAvailable === true;
}

/** The `nfc` step in a browser. */
export function NfcStep({ step, client, onDone }: NfcStepProps) {
  const { t } = useTranslation();
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<ErrorMessageKey | null>(null);
  // The verification the report names, kept across a failed report so a retry reuses it.
  const verificationId = useRef<string | null>(null);

  const takeOtherWay = useCallback(async () => {
    setSwitching(true);
    setError(null);
    try {
      verificationId.current ??= (
        await client.createVerification({ type: 'government-id-nfc' })
      ).id;
      await client.reportClientUnable(verificationId.current, WEB_REASON);
      await onDone();
    } catch (failure: unknown) {
      setError(errorMessageKey(failure));
    } finally {
      setSwitching(false);
    }
  }, [client, onDone]);

  return (
    <Card title={t('nfc.title')} headingLevel={1}>
      <div className="flex flex-col gap-4">
        <p>{t('nfc.needsApp')}</p>
        {hasFallback(step) ? (
          <>
            <p>{t('nfc.otherWay')}</p>
            {error !== null && <Alert tone="error">{t(error)}</Alert>}
            {switching && <WaitingStatus message={t('nfc.switching')} />}
            <Button
              className="sm:self-end"
              disabled={switching}
              onClick={() => {
                void takeOtherWay();
              }}
            >
              {t('nfc.useAnotherWay')}
            </Button>
          </>
        ) : (
          <p>{t('nfc.noOtherWay')}</p>
        )}
      </div>
    </Card>
  );
}
