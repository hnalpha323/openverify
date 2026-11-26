/**
 * C96.3, C96.5 (Workflow 7A; P01, P15): the phone's side of a handoff link. `routes.tsx` renders it
 * for a `#inquiry-id=…&handoff-token=ovh_…` link.
 *
 * 1. **The context screen**, from `POST /flow/handoffs/preview`, which consumes nothing (a link
 *    scanner or a mail sandbox that opens the link uses nothing up): the organisation's display
 *    name, what will be verified, when the flow started (and in which country, with the attribution
 *    of the source that placed it, when network data is configured), and advice that depends on the
 *    method. Decline has the same weight as Continue.
 * 2. Where the step asks for one, **the six digits** the desktop shows. For an email or SMS to a
 *    destination the inquiry never confirmed, the context follows the correct code (V16).
 * 3. **Continue** redeems the token, once, never at boot; the new session token lives in this
 *    component's memory only. The flow then runs on the new session, whose first screen is its own
 *    consent: nothing is collected or captured before it (P01).
 *
 * Every refusal of the link is the same 410, shown as one "not valid, expired or used" screen.
 */
import type { PreviewHandoffResponse } from '@openverify/contracts';
import { Alert, Button, Card, Field, Input } from '@openverify/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../session/use-intl-locale';
import { useIsolatedT } from '../i18n/bidi';
import type { FlowApiClient } from '../api/flow-api-client';
import { FlowApiError } from '../api/flow-api-client';
import type { FlowTransportOptions } from '../api/flow-transport';
import { problemCode } from '../api/problem-members';
import { ApiError } from '../components/api-error';
import { LoadingCard } from '../components/loading-card';
import { FlowRenderer } from '../flow/flow-renderer';
import { useScreenFocus } from '../flow/use-screen-focus';
import { declineHandoff, previewHandoff, redeemHandoff } from './handoff-client';
import { handoffEn } from './locales/en';

export interface HandoffRedeemFlowProps {
  /** The inquiry the link was issued for; the redeemed session must belong to it. */
  readonly inquiryId: string;
  /** The `ovh_` token from the link fragment; kept in memory only, never logged or stored. */
  readonly handoffToken: string;
  /** The API base and fetch for the unauthenticated preview, decline and redeem. */
  readonly transport: FlowTransportOptions;
  /** The flow client for the redeemed session token. */
  readonly connect: (sessionToken: string) => FlowApiClient;
}

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'context'; readonly preview: PreviewHandoffResponse }
  | { readonly kind: 'ready'; readonly client: FlowApiClient }
  | { readonly kind: 'declined' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'limit' }
  | { readonly kind: 'error'; readonly error: unknown; readonly retry: () => void };

const CODE = /^[0-9]{6}$/;

const isGone = (error: unknown): boolean =>
  error instanceof FlowApiError && error.kind === 'http' && error.status === 410;

/** A step type the context screen has words for (every verifying type). */
type WordedStep = keyof typeof handoffEn.steps;
const isWorded = (step: string): step is WordedStep => Object.hasOwn(handoffEn.steps, step);

function countryName(code: string, language: string): string {
  try {
    return new Intl.DisplayNames([language], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function HandoffRedeemFlow({
  inquiryId,
  handoffToken,
  transport,
  connect,
}: HandoffRedeemFlowProps) {
  const { t } = useTranslation();
  const intlTag = useIntlLocale();
  // C161.3 (Workflow 9A): every interpolated value in its own <bdi>.
  const tb = useIsolatedT();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'check' | 'continue' | 'decline' | null>(null);
  const [attempt, setAttempt] = useState(0);
  const credentials = useRef({ inquiryId, handoffToken });
  const container = useScreenFocus(state.kind);

  useEffect(() => {
    const controller = new AbortController();
    previewHandoff(transport, credentials.current, undefined, controller.signal).then(
      (preview) => {
        setState({ kind: 'context', preview });
      },
      (error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setState(
          isGone(error) || error instanceof TypeError
            ? { kind: 'invalid' }
            : {
                kind: 'error',
                error,
                retry: () => {
                  setState({ kind: 'loading' });
                  setAttempt((value) => value + 1);
                },
              },
        );
      },
    );
    return () => {
      controller.abort();
    };
  }, [transport, attempt]);

  /** A refusal of the link, the session limit, or an error the user may retry from here. */
  const refused = (error: unknown, retry: () => void) => {
    if (isGone(error)) {
      setState({ kind: 'invalid' });
    } else if (problemCode(error) === 'session_limit_reached') {
      setState({ kind: 'limit' });
    } else {
      setState({ kind: 'error', error, retry });
    }
  };

  const enteredCode = (preview: PreviewHandoffResponse): string | undefined | null => {
    if (!preview['confirmation-code-required']) {
      return undefined;
    }
    const value = code.trim();
    if (!CODE.test(value)) {
      setCodeError(t('handoff.phone.codeRequired'));
      return null;
    }
    setCodeError(null);
    return value;
  };

  const checkCode = async (preview: PreviewHandoffResponse) => {
    const value = enteredCode(preview);
    if (value === null) {
      return;
    }
    setBusy('check');
    try {
      setState({
        kind: 'context',
        preview: await previewHandoff(transport, credentials.current, value),
      });
    } catch (error: unknown) {
      refused(error, () => {
        setState({ kind: 'context', preview });
      });
    } finally {
      setBusy(null);
    }
  };

  const redeem = async (preview: PreviewHandoffResponse) => {
    const value = enteredCode(preview);
    if (value === null) {
      return;
    }
    setBusy('continue');
    try {
      const { sessionToken } = await redeemHandoff(transport, credentials.current, value);
      setState({ kind: 'ready', client: connect(sessionToken) });
    } catch (error: unknown) {
      setBusy(null);
      refused(error, () => {
        setState({ kind: 'context', preview });
      });
    }
  };

  const decline = async (preview: PreviewHandoffResponse) => {
    setBusy('decline');
    try {
      await declineHandoff(transport, credentials.current);
      setState({ kind: 'declined' });
    } catch (error: unknown) {
      setBusy(null);
      refused(error, () => {
        setState({ kind: 'context', preview });
      });
    }
  };

  let content;
  switch (state.kind) {
    case 'loading':
      content = <LoadingCard />;
      break;
    case 'ready':
      return <FlowRenderer client={state.client} inquiryId={inquiryId} />;
    case 'declined':
      content = (
        <Card title={t('handoff.phone.declinedTitle')} headingLevel={1}>
          <p>{t('handoff.phone.declined')}</p>
        </Card>
      );
      break;
    case 'invalid':
      content = (
        <Card title={t('link.title')} headingLevel={1}>
          <Alert tone="error">{t('handoff.phone.invalid')}</Alert>
        </Card>
      );
      break;
    case 'limit':
      content = (
        <Card title={t('handoff.phone.limitTitle')} headingLevel={1}>
          <Alert tone="error">{t('handoff.phone.limit')}</Alert>
        </Card>
      );
      break;
    case 'error':
      content = <ApiError error={state.error} retrying={false} onRetry={state.retry} />;
      break;
    case 'context': {
      const { preview } = state;
      const organization = preview['organization-display-name'];
      const { context } = preview;
      const steps = (context?.steps ?? []).filter(isWorded);
      const startedAt =
        context === null
          ? null
          : new Intl.DateTimeFormat(intlTag, {
              hour: '2-digit',
              minute: '2-digit',
            }).format(new Date(context['started-at']));
      const country =
        context?.['issuing-country-code'] == null || context.attribution === null
          ? null
          : countryName(context['issuing-country-code'], intlTag);
      content = (
        <Card title={t('handoff.phone.title')} headingLevel={1}>
          <div className="flex flex-col gap-4">
            <p>{tb('handoff.phone.requester', { organization })}</p>
            {steps.length > 0 && (
              <div>
                <p>{t('handoff.phone.verifies')}</p>
                <ul className="list-disc ps-6">
                  {steps.map((step) => (
                    <li key={step}>{t(`handoff.steps.${step}`)}</li>
                  ))}
                </ul>
              </div>
            )}
            {startedAt !== null && (
              <p>
                {country === null
                  ? t('handoff.phone.started', { time: startedAt })
                  : t('handoff.phone.startedIn', { time: startedAt, country })}
              </p>
            )}
            {country !== null && context?.attribution != null && (
              <p className="text-xs text-ink-muted">{context.attribution}</p>
            )}
            <Alert tone="warning">
              {t(preview.method === 'qr' ? 'handoff.phone.adviceQr' : 'handoff.phone.adviceLink', {
                organization,
              })}
            </Alert>
            {preview['confirmation-code-required'] && (
              <Field
                label={t('handoff.phone.codeLabel')}
                description={t('handoff.phone.codeHint')}
                error={codeError ?? undefined}
              >
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value);
                  }}
                />
              </Field>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              {context === null ? (
                <Button
                  disabled={busy !== null}
                  onClick={() => {
                    void checkCode(preview);
                  }}
                >
                  {busy === 'check' ? t('handoff.phone.checking') : t('handoff.phone.checkCode')}
                </Button>
              ) : (
                <Button
                  disabled={busy !== null}
                  onClick={() => {
                    void redeem(preview);
                  }}
                >
                  {busy === 'continue'
                    ? t('handoff.phone.continuing')
                    : t('handoff.phone.continue')}
                </Button>
              )}
              <Button
                disabled={busy !== null}
                onClick={() => {
                  void decline(preview);
                }}
              >
                {busy === 'decline' ? t('handoff.phone.declining') : t('handoff.phone.decline')}
              </Button>
            </div>
          </div>
        </Card>
      );
      break;
    }
  }

  return <div ref={container}>{content}</div>;
}
