/**
 * C96.1, C96.3, C96.5 (Workflow 7A): the desktop's `device_handoff` step. `FlowRenderer` renders it
 * for a handoff step that is not done (`pending`, `issued`, `rejected`, `declined`).
 *
 * - **On arrival** it issues a QR when the step offers one (`POST /flow/handoffs`) and draws it
 *   locally, with the link as its text alternative, a countdown, "get a new code" (which revokes
 *   the previous one), the six digits the phone will ask for where the step asks, the email and SMS
 *   options where offered, and "continue on this device" where allowed. A step without a QR starts
 *   with the email or SMS form.
 * - **Reloaded while the phone works** (`handed-off`, K7A-5) it issues nothing and opens on the
 *   waiting screen.
 * - **While a code is out** it reads `GET /flow/handoffs/current`: once the phone redeemed it waits,
 *   saying when and on what (the OS and browser names only) the phone continued, with "this was
 *   not me", which ends the phone's session and shows the step again. It reloads the session once
 *   the inquiry left its open states, or once the step is done some other way.
 * - **Accessibility:** the QR has a text alternative (the link, with a copy button); each screen
 *   moves focus to its heading, and every state change is announced in a live region (the
 *   countdown itself is not, so it is not read out every second).
 */
import type {
  CreateHandoffResponse,
  CurrentHandoffResponse,
  FlowHandoff,
  HandoffMethod,
} from '@openverify/contracts';
import { Alert, Button, Card, Field, Input } from '@openverify/ui';
import { useCallback, useEffect, useRef, useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../../session/use-intl-locale';
import { useIsolatedT } from '../../i18n/bidi';
import { errorMessageKey } from '../../api/error-message';
import type { FlowApiClient } from '../../api/flow-api-client';
import { problemCode } from '../../api/problem-members';
import { useFlowEnvironment } from '../../flow/flow-environment';
import type { HandoffStep } from '../../flow/flow-position';
import { formatWait, useNow } from '../../flow/use-now';
import { useScreenFocus } from '../../flow/use-screen-focus';
import { QrCode } from '../../handoff/qr-code';
import { WaitingStatus } from '../waiting';

export interface DeviceHandoffStepProps {
  readonly step: HandoffStep;
  /** The step's state from `GET /flow/session`, or `null` from a server that serves none. */
  readonly handoff: FlowHandoff | null;
  readonly client: FlowApiClient;
  /** Reloads the session (the step is done, or its state changed). */
  readonly onDone: () => Promise<void>;
}

type SendMethod = Exclude<HandoffMethod, 'qr'>;

type View =
  | { readonly kind: 'issuing' }
  /** A QR is out; its answer carries the fragment. */
  | { readonly kind: 'qr'; readonly issued: CreateHandoffResponse }
  /** The email or SMS form. */
  | { readonly kind: 'form'; readonly method: SendMethod }
  /** A link went by email or SMS. */
  | { readonly kind: 'sent'; readonly issued: CreateHandoffResponse; readonly method: SendMethod }
  /** K7A-5: a reloaded desktop, whose phone works on: reading when and on what it continued. */
  | { readonly kind: 'resuming' }
  /** The phone redeemed: wait for it. */
  | { readonly kind: 'waiting'; readonly current: CurrentHandoffResponse }
  /** Nothing out: after a decline, a rejection or a refusal. */
  | { readonly kind: 'choose' };

type Notice = 'declined' | 'rejected' | null;

/** Statuses after which the user's part of the inquiry is over. */
const OPEN_INQUIRY: ReadonlySet<string> = new Set(['created', 'pending']);

/** The link a phone opens: this page's address with the handoff fragment. */
function linkOf(fragment: string): string {
  return `${window.location.origin}${window.location.pathname}${fragment}`;
}

/**
 * Runs `poll` every `intervalMs` while `active`, the first time after `firstDelayMs`; a failed poll
 * is tried again at the next tick.
 */
function usePoll(
  poll: (signal: AbortSignal) => Promise<void>,
  active: boolean,
  intervalMs: number,
  firstDelayMs: number = intervalMs,
): void {
  const pollRef = useRef(poll);
  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);
  useEffect(() => {
    if (!active) {
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = (delayMs: number) => {
      timer = setTimeout(() => {
        pollRef.current(controller.signal).then(
          () => {
            if (!controller.signal.aborted) {
              tick(intervalMs);
            }
          },
          () => {
            if (!controller.signal.aborted) {
              tick(intervalMs);
            }
          },
        );
      }, delayMs);
    };
    tick(firstDelayMs);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [active, firstDelayMs, intervalMs]);
}

export function DeviceHandoffStep({ step, handoff, client, onDone }: DeviceHandoffStepProps) {
  const { t } = useTranslation();
  const intlTag = useIntlLocale();
  // C161.3 (Workflow 9A): every interpolated value in its own <bdi>.
  const tb = useIsolatedT();
  const { pollIntervalMs } = useFlowEnvironment();
  const now = useNow();
  const methods = step.methods ?? ['qr'];
  const offersQr = methods.includes('qr');
  const sendMethods = methods.filter((method): method is SendMethod => method !== 'qr');
  const allowContinueHere = step.allowContinueHere ?? true;

  const handedOff = handoff?.['handed-off'] === true;
  const [view, setView] = useState<View>(() => {
    if (handedOff) {
      return { kind: 'resuming' };
    }
    return offersQr ? { kind: 'issuing' } : { kind: 'form', method: sendMethods[0] ?? 'email' };
  });
  const [notice, setNotice] = useState<Notice>(
    handoff?.state === 'declined' || handoff?.state === 'rejected' ? handoff.state : null,
  );
  const [destination, setDestination] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [busy, setBusy] = useState<'send' | 'continue' | 'reject' | null>(null);
  const [copied, setCopied] = useState(false);
  const started = useRef(false);
  /** The request in flight, aborted when the screen goes away. */
  const request = useRef<AbortController | null>(null);
  const container = useScreenFocus(
    view.kind === 'waiting' || view.kind === 'resuming' ? 'waiting' : 'handoff',
  );

  const leave = useCallback(() => {
    void onDone();
  }, [onDone]);

  const issue = useCallback(
    async (method: HandoffMethod, to?: string) => {
      setFailure(null);
      setFormError(null);
      setCopied(false);
      if (method === 'qr') {
        setView({ kind: 'issuing' });
      } else {
        setBusy('send');
      }
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      try {
        const issued = await client.createHandoff(
          method === 'qr' ? { method } : { method, destination: to ?? '' },
          controller.signal,
        );
        if (controller.signal.aborted) {
          return;
        }
        setView(method === 'qr' ? { kind: 'qr', issued } : { kind: 'sent', issued, method });
      } catch (error: unknown) {
        if (controller.signal.aborted) {
          return;
        }
        const code = problemCode(error);
        if (code === 'handoff_not_available') {
          leave();
          return;
        }
        if (method !== 'qr' && code === 'destination_not_confirmed') {
          setFormError(t('handoff.desktop.errors.destinationNotConfirmed'));
          setView({ kind: 'form', method });
        } else if (code === 'handoff_send_limited') {
          setFormError(t('handoff.desktop.errors.sendLimited'));
          setView(method === 'qr' ? { kind: 'choose' } : { kind: 'form', method });
        } else {
          setFailure(error);
          setView(method === 'qr' ? { kind: 'choose' } : { kind: 'form', method });
        }
      } finally {
        setBusy(null);
      }
    },
    [client, leave, t],
  );

  useEffect(
    () => () => {
      request.current?.abort();
    },
    [],
  );

  // While a code is out: has the phone redeemed it, or declined it?
  const watchCode = useCallback(
    async (signal: AbortSignal) => {
      const current = await client.getCurrentHandoff(signal);
      if (signal.aborted) {
        return;
      }
      switch (current.status) {
        case 'redeemed':
          setView({ kind: 'waiting', current });
          break;
        case 'declined':
          setNotice('declined');
          setView({ kind: 'choose' });
          break;
        case 'continued_here':
        case 'skipped':
          leave();
          break;
        default:
          // A reloaded desktop whose phone left in the meantime has nothing to wait for.
          setView((shown) => (shown.kind === 'resuming' ? { kind: 'choose' } : shown));
          break;
      }
    },
    [client, leave],
  );

  useEffect(() => {
    if (!started.current && offersQr && !handedOff) {
      started.current = true;
      void issue('qr');
    }
  }, [handedOff, issue, offersQr]);

  // A reloaded desktop asks at once what its phone is doing.
  const watchingCode = view.kind === 'qr' || view.kind === 'sent' || view.kind === 'resuming';
  usePoll(watchCode, watchingCode, pollIntervalMs, view.kind === 'resuming' ? 0 : pollIntervalMs);

  // While the phone works: is the inquiry finished?
  usePoll(
    async (signal) => {
      const session = await client.getSession(signal);
      if (!signal.aborted && !OPEN_INQUIRY.has(session.inquiry.status)) {
        leave();
      }
    },
    view.kind === 'waiting',
    pollIntervalMs,
  );

  const reject = async () => {
    setBusy('reject');
    setFailure(null);
    try {
      await client.rejectHandoff(undefined);
      setNotice('rejected');
      setView({ kind: 'choose' });
    } catch (error: unknown) {
      setFailure(error);
    } finally {
      setBusy(null);
    }
  };

  const continueHere = async () => {
    setBusy('continue');
    setFailure(null);
    try {
      await client.continueHandoffHere(undefined);
      await onDone();
    } catch (error: unknown) {
      if (problemCode(error) === 'handoff_not_available') {
        leave();
        return;
      }
      setFailure(error);
      setBusy(null);
    }
  };

  const submit = (method: SendMethod) => (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (destination.trim() === '') {
      setFormError(t('handoff.desktop.errors.required'));
      return;
    }
    void issue(method, destination.trim());
  };

  const copy = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  if (view.kind === 'resuming') {
    return (
      <div ref={container}>
        <Card title={t('handoff.desktop.waitingTitle')} headingLevel={1}>
          <div className="flex flex-col gap-4" data-step={step.id}>
            <WaitingStatus message={t('handoff.desktop.waitingTitle')} />
          </div>
        </Card>
      </div>
    );
  }

  if (view.kind === 'waiting') {
    const at = view.current['redeemed-at'];
    const time =
      at === null
        ? ''
        : new Intl.DateTimeFormat(intlTag, { hour: '2-digit', minute: '2-digit' }).format(
            new Date(at),
          );
    const device = [view.current['os-name'], view.current['browser-name']]
      .filter((part): part is string => part !== null)
      .join(', ');
    return (
      <div ref={container}>
        <Card title={t('handoff.desktop.waitingTitle')} headingLevel={1}>
          <div className="flex flex-col gap-4" data-step={step.id}>
            <WaitingStatus message={t('handoff.desktop.waiting', { time })} />
            {device !== '' && <p>{tb('handoff.desktop.waitingDevice', { device })}</p>}
            {failure !== null && <Alert tone="error">{t(errorMessageKey(failure))}</Alert>}
            <Button
              variant="danger"
              className="sm:self-start"
              disabled={busy !== null}
              onClick={() => {
                void reject();
              }}
            >
              {busy === 'reject' ? t('handoff.desktop.rejecting') : t('handoff.desktop.notMe')}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const expiresAt =
    view.kind === 'qr' || view.kind === 'sent' ? Date.parse(view.issued['expires-at']) : 0;
  const expired = (view.kind === 'qr' || view.kind === 'sent') && now >= expiresAt;
  const code =
    (view.kind === 'qr' || view.kind === 'sent') && !expired
      ? view.issued['confirmation-code']
      : undefined;
  const fragment = view.kind === 'qr' ? view.issued['url-fragment'] : undefined;

  return (
    <div ref={container}>
      <Card title={t('handoff.desktop.title')} headingLevel={1}>
        <div className="flex flex-col gap-4" data-step={step.id}>
          {notice !== null && <Alert tone="info">{t(`handoff.desktop.${notice}`)}</Alert>}
          {view.kind === 'issuing' && <WaitingStatus message={t('handoff.desktop.issuing')} />}

          {view.kind === 'qr' && fragment !== undefined && !expired && (
            <>
              <p>{t('handoff.desktop.intro')}</p>
              <QrCode value={linkOf(fragment)} label={t('handoff.desktop.qrLabel')} />
              <Field label={t('handoff.desktop.linkLabel')}>
                <Input readOnly value={linkOf(fragment)} />
              </Field>
              <Button
                variant="secondary"
                className="sm:self-start"
                onClick={() => {
                  void copy(linkOf(fragment));
                }}
              >
                {t('handoff.desktop.copy')}
              </Button>
              {copied && <p role="status">{t('handoff.desktop.copied')}</p>}
            </>
          )}

          {view.kind === 'sent' && !expired && (
            <p role="status">
              {t(
                view.method === 'email' ? 'handoff.desktop.sentEmail' : 'handoff.desktop.sentSms',
                {
                  minutes: String(Math.max(1, Math.round((expiresAt - now) / 60_000))),
                },
              )}
            </p>
          )}

          {(view.kind === 'qr' || view.kind === 'sent') &&
            (expired ? (
              <Alert tone="warning">{t('handoff.desktop.expired')}</Alert>
            ) : (
              <p>
                {t('handoff.desktop.expiresIn', { time: formatWait((expiresAt - now) / 1000) })}
              </p>
            ))}

          {code !== undefined && (
            <p className="text-lg font-semibold">
              {t('handoff.desktop.confirmationCode', { code })}
            </p>
          )}

          {view.kind === 'form' && (
            <form className="flex flex-col gap-4" noValidate onSubmit={submit(view.method)}>
              <Field
                label={
                  view.method === 'email'
                    ? t('handoff.desktop.emailLabel')
                    : t('handoff.desktop.smsLabel')
                }
                description={view.method === 'sms' ? t('handoff.desktop.smsHint') : undefined}
                error={formError ?? undefined}
              >
                <Input
                  type={view.method === 'email' ? 'email' : 'tel'}
                  autoComplete={view.method === 'email' ? 'email' : 'tel'}
                  value={destination}
                  onChange={(event) => {
                    setDestination(event.target.value);
                  }}
                />
              </Field>
              <Button type="submit" className="sm:self-start" disabled={busy !== null}>
                {busy === 'send' ? t('handoff.desktop.sending') : t('handoff.desktop.send')}
              </Button>
            </form>
          )}

          {view.kind !== 'form' && formError !== null && <Alert tone="error">{formError}</Alert>}
          {failure !== null && <Alert tone="error">{t(errorMessageKey(failure))}</Alert>}

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {offersQr && view.kind !== 'issuing' && (
              <Button
                variant={view.kind === 'qr' && !expired ? 'secondary' : 'primary'}
                disabled={busy !== null}
                onClick={() => {
                  void issue('qr');
                }}
              >
                {view.kind === 'qr' || view.kind === 'choose'
                  ? t('handoff.desktop.newCode')
                  : t('handoff.desktop.showQr')}
              </Button>
            )}
            {sendMethods
              .filter((method) => !(view.kind === 'form' && view.method === method))
              .map((method) => (
                <Button
                  key={method}
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => {
                    setFormError(null);
                    setDestination('');
                    setView({ kind: 'form', method });
                  }}
                >
                  {method === 'email'
                    ? t('handoff.desktop.emailOption')
                    : t('handoff.desktop.smsOption')}
                </Button>
              ))}
            {allowContinueHere && (
              <Button
                variant="secondary"
                disabled={busy !== null}
                onClick={() => {
                  void continueHere();
                }}
              >
                {busy === 'continue'
                  ? t('handoff.desktop.continuing')
                  : t('handoff.desktop.continueHere')}
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
