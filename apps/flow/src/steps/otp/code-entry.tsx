import { Alert, Button, Card, Field, Input } from '@openverify/ui';
import { useId, type ReactNode, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../../session/use-intl-locale';
import { useIsolatedT } from '../../i18n/bidi';
import { formatWait, useNow } from '../../flow/use-now';
import type { OpenCode } from './open-code';

/** Why a code was not taken: the browser's own checks, then the server's (C52.7). */
export type CodeError = 'required' | 'format' | 'incorrect' | 'expired' | 'exhausted';

export interface CodeEntryProps {
  readonly channel: 'phone' | 'email';
  readonly openCode: OpenCode;
  readonly codeLength: number;
  /** Whether this code replaced an earlier one, for the wording of the notice. */
  readonly resent: boolean;
  readonly code: string;
  readonly onCodeChange: (code: string) => void;
  readonly error: CodeError | null;
  /** The server refused a new code as too soon (C55.6). */
  readonly tooSoon: boolean;
  readonly busy: 'confirm' | 'send' | null;
  /** A request that failed for another reason, said above Confirm. */
  readonly failure: ReactNode;
  readonly onConfirm: () => void;
  readonly onResend: () => void;
  /** Back to the destination: to change it, or to start again once no code is left. */
  readonly onChangeDestination: () => void;
}

/**
 * C64.1: the code entry, with the tries left for this code, its expiry, and the next code counted
 * down on the wall clock. The countdown is not a live region (it would speak every second); the
 * moment a new code may be asked for is announced once.
 */
export function CodeEntry({
  channel,
  openCode,
  codeLength,
  resent,
  code,
  onCodeChange,
  error,
  tooSoon,
  busy,
  failure,
  onConfirm,
  onResend,
  onChangeDestination,
}: CodeEntryProps) {
  const { t } = useTranslation();
  const intlTag = useIntlLocale();
  // C161.3 (Workflow 9A): every interpolated value in its own <bdi>.
  const tb = useIsolatedT();
  const now = useNow();
  const waitId = useId();
  const triesId = useId();
  const { maskedDestination, expiresAt, resendAt, attemptsRemaining } = openCode;
  const expired = now >= expiresAt;
  const waiting = resendAt !== null && now < resendAt;
  const errorText =
    error === null
      ? undefined
      : error === 'format'
        ? t('otp.code.errors.format', { length: codeLength })
        : t(`otp.code.errors.${error}`);
  const expiry = new Intl.DateTimeFormat(intlTag, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(expiresAt));

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy === null) {
      onConfirm();
    }
  };

  return (
    <Card title={t('otp.code.title')} headingLevel={1}>
      <div className="flex flex-col gap-6">
        <Alert tone="info">
          {tb(resent ? 'otp.code.sentAgain' : 'otp.code.sentTo', {
            destination: maskedDestination,
          })}
        </Alert>
        {expired && resendAt === null && (
          <div className="flex flex-col gap-3">
            <Alert tone="warning">{t('otp.code.expiredFinal')}</Alert>
            <Button className="sm:self-start" onClick={onChangeDestination}>
              {t('otp.code.startAgain')}
            </Button>
          </div>
        )}
        {expired && resendAt !== null && (
          <Alert tone="warning">{t('otp.code.errors.expired')}</Alert>
        )}
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          <Field
            label={t('otp.code.label')}
            description={t('otp.code.hint', { length: codeLength })}
            error={errorText}
          >
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              autoCapitalize="none"
              spellCheck={false}
              // In error, the field (which then has focus) also says the tries left (WCAG 4.1.3).
              aria-describedby={errorText === undefined ? undefined : triesId}
              value={code}
              onChange={(event) => {
                onCodeChange(event.target.value);
              }}
            />
          </Field>
          <div className="flex flex-col gap-1 text-sm text-ink-muted">
            <p id={triesId}>{t('otp.code.attemptsLeft', { remaining: attemptsRemaining })}</p>
            <p>{t('otp.code.expiresAt', { time: expiry })}</p>
          </div>
          {failure}
          {busy === 'confirm' && <p role="status">{t('otp.code.checking')}</p>}
          {busy === 'send' && <p role="status">{t('otp.sending')}</p>}
          <Button
            type="submit"
            className="aria-disabled:cursor-progress sm:self-end"
            aria-disabled={busy === null ? undefined : true}
          >
            {t('otp.code.confirm')}
          </Button>
        </form>
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          {resendAt === null ? (
            <p className="text-sm">{t('otp.code.noResend')}</p>
          ) : (
            <>
              {waiting && (
                <p id={waitId} className="text-sm text-ink-muted">
                  {t('otp.code.resendIn', { time: formatWait((resendAt - now) / 1000) })}
                </p>
              )}
              <Button
                variant="secondary"
                className="sm:self-start"
                aria-disabled={waiting || busy !== null ? true : undefined}
                aria-describedby={waiting ? waitId : undefined}
                onClick={() => {
                  if (!waiting && busy === null) {
                    onResend();
                  }
                }}
              >
                {t('otp.code.resend')}
              </Button>
            </>
          )}
          <p role="status" className="text-sm">
            {resendAt !== null && !waiting ? t('otp.code.resendReady') : ''}
          </p>
          {tooSoon && <Alert tone="warning">{t('otp.code.errors.tooSoon')}</Alert>}
          <Button variant="secondary" className="sm:self-start" onClick={onChangeDestination}>
            {t(`otp.${channel}.change`)}
          </Button>
        </div>
      </div>
    </Card>
  );
}
