/**
 * C171.4 (WCAG 2.2.1; decision 57; review H11): a selfie capture lives 180 s
 * (`SELFIE_CAPTURE_TTL_SECONDS`, a server rule). 20 s before its limit the flow says so in a live
 * region and offers more time in one simple action; each extension asks the server to move the
 * capture's `expires-at` by 180 s (`POST /flow/selfie-captures/:id/extend`), which it allows at least
 * ten times and never counts towards the cap of captures. The limit is followed on this client's
 * monotonic clock from the moment the capture was opened, moved by what each extension added to the
 * server's `expires-at`, so the two clocks never need to agree.
 */
import { SELFIE_CAPTURE_TTL_SECONDS } from '@openverify/contracts';
import { Button } from '@openverify/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FlowApiClient } from '../api/flow-api-client';
import { useFlowEnvironment } from '../flow/flow-environment';
import { useIntlLocale } from '../session/use-intl-locale';
import type { OpenCapture } from './capture-protocol';

/** How long before the limit the person is warned (WCAG 2.2.1's "at least 20 seconds"). */
export const CAPTURE_WARNING_MS = 20_000;

export interface CaptureTimeWarningProps {
  readonly capture: Pick<OpenCapture, 'id' | 'expiresAt' | 'openedAt'>;
  readonly client: Pick<FlowApiClient, 'extendSelfieCapture'>;
}

type Extension =
  | { readonly status: 'idle' }
  | { readonly status: 'extending' }
  | { readonly status: 'extended' }
  | { readonly status: 'failed' };

export function CaptureTimeWarning({ capture, client }: CaptureTimeWarningProps) {
  const { t } = useTranslation();
  const intlTag = useIntlLocale();
  const { now, countdownIntervalMs } = useFlowEnvironment();
  const [time, setTime] = useState(() => now());
  // What the extensions added to the server's expiry, and its latest value.
  const [extra, setExtra] = useState({ ms: 0, expiresAt: capture.expiresAt });
  const [extension, setExtension] = useState<Extension>({ status: 'idle' });

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(now());
    }, countdownIntervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [now, countdownIntervalMs]);

  const deadline = capture.openedAt + SELFIE_CAPTURE_TTL_SECONDS * 1000 + extra.ms;
  const left = deadline - time;
  const warning = left > 0 && left <= CAPTURE_WARNING_MS;

  const extend = async () => {
    setExtension({ status: 'extending' });
    try {
      const extended = await client.extendSelfieCapture(capture.id);
      const moved = Date.parse(extended.attributes['expires-at']) - Date.parse(extra.expiresAt);
      setExtra((current) => ({
        ms: current.ms + Math.max(moved, 0),
        expiresAt: extended.attributes['expires-at'],
      }));
      setExtension({ status: 'extended' });
    } catch {
      setExtension({ status: 'failed' });
    }
  };

  if (extension.status === 'failed') {
    return (
      <p role="alert" className="text-sm font-medium text-danger">
        {t('screen.extend.failed')}
      </p>
    );
  }
  if (!warning) {
    return extension.status === 'extended' ? (
      <p role="status" className="text-sm text-ink-muted">
        {t('screen.extend.extended')}
      </p>
    ) : null;
  }
  const seconds = new Intl.NumberFormat(intlTag).format(Math.ceil(left / 1000));
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
      <p>{t('screen.extend.warning', { seconds })}</p>
      <Button
        variant="secondary"
        disabled={extension.status === 'extending'}
        onClick={() => {
          void extend();
        }}
      >
        {t('screen.extend.button')}
      </Button>
    </div>
  );
}
