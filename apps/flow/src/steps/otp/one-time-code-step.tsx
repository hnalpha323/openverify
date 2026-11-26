import { OTP_CODE_LENGTH, OTP_MAX_SENDS, type FlowOtpSendBody } from '@openverify/contracts';
import { Alert, Button, Card } from '@openverify/ui';
import { useEffect, useRef, useState } from 'react';
import { normalizeDigits } from '@openverify/flow-spec';
import { useTranslation } from 'react-i18next';
import { entryErrorMessageKey } from '../../api/error-message';
import type { FlowApiClient } from '../../api/flow-api-client';
import { countMember, isConflict, problemCode, timeMember } from '../../api/problem-members';
import { RetryHints } from '../../components/retry-hints';
import type { FlowPosition, OtpStep } from '../../flow/flow-position';
import { ensureVerification, newSubmissionProgress } from '../../flow/submit-verification';
import { useScreenFocus } from '../../flow/use-screen-focus';
import { ConfirmedStep } from '../confirmed-step';
import { CodeEntry, type CodeError } from './code-entry';
import {
  EmailEntry,
  PhoneEntry,
  RequestFailure,
  type EntryError,
  type PhoneEntryValue,
} from './destination-entry';
import { emailProblem, parsePhoneEntry } from './destinations';
import { codeGuidanceOf, type OpenCode } from './open-code';

export interface OneTimeCodeStepProps {
  /** A phone or email step (C55, C64.1). */
  readonly position: Extract<FlowPosition, { kind: 'capture' }> & { readonly step: OtpStep };
  readonly client: FlowApiClient;
  /** Reloads the session once the verification is submitted, or moved on at the server. */
  readonly onSubmitted: () => Promise<void>;
  /**
   * C148.7 (Workflow 9A; 3.3.7): the session's `values`, a field the person entered earlier that this
   * step prefills from (`prefillFrom`), shown filled and editable.
   */
  readonly prefill?: Readonly<Record<string, unknown>>;
}

type View =
  /** The phone number or email address. */
  | 'entry'
  /** The code sent to it. */
  | 'code'
  /** A C55.7 limit refused the user: continue, and the verification goes to review (C55.6). */
  | 'limited'
  /** The code was confirmed: it is submitted at once. */
  | 'confirmed';

/** A request that failed for a reason the screen cannot name, and the view it was made from. */
interface Failure {
  readonly error: unknown;
  readonly view: View;
}

const ENTRY_ERRORS: Readonly<Record<string, EntryError>> = {
  otp_destination_invalid: 'destinationInvalid',
  otp_destination_not_allowed: 'notAllowed',
  // C64.1: a delivery failure goes back to the destination.
  otp_delivery_failed: 'deliveryFailed',
  otp_not_sent: 'notSent',
};

const CODE_ERRORS: Readonly<Record<string, CodeError>> = {
  otp_incorrect: 'incorrect',
  otp_expired: 'expired',
  otp_code_exhausted: 'exhausted',
};

/** C55.5, C55.6: the server submitted the verification, so the session moves on. */
const SUBMITTED_BY_SERVER: ReadonlySet<string> = new Set([
  'otp_not_confirmed',
  'otp_attempts_exhausted',
]);

/** Spaces and dashes a user may type or paste between the digits. */
const SEPARATORS = /[\s-]/gu;

/**
 * One attempt of a phone or email step (C55, C64.1): the destination, then the code sent to it.
 * The verification is created with the first send and reused for every later send and confirm;
 * a confirmed code is submitted at once. Each C55 refusal is said where the user can act on it:
 * a delivery failure or a refused destination back at the destination, a wrong or expired code
 * at the code, a cooldown at the resend, and a limit refusal as a way to continue for review.
 */
/** C148.7: the one value a `prefillFrom` step gets from the session (the client view names no key). */
function prefilledText(prefill: Readonly<Record<string, unknown>> | undefined): string {
  const [value] = Object.values(prefill ?? {}).filter(
    (candidate): candidate is string => typeof candidate === 'string',
  );
  return value ?? '';
}

export function OneTimeCodeStep({ position, client, onSubmitted, prefill }: OneTimeCodeStepProps) {
  const { t } = useTranslation();
  const { step, attempt, maxAttempts, hints, verificationId, verification } = position;
  const channel = step.type === 'phone_otp' ? 'phone' : 'email';
  const resumed = codeGuidanceOf(verification);
  const codeLength = resumed.codeLength ?? step.codeLength ?? OTP_CODE_LENGTH.default;

  const [view, setView] = useState<View>(resumed.openCode === null ? 'entry' : 'code');
  const [openCode, setOpenCode] = useState<OpenCode | null>(resumed.openCode);
  // C148.7 (3.3.7): a value entered earlier is shown filled and editable.
  const [phone, setPhone] = useState<PhoneEntryValue>(() => ({
    country: step.type === 'phone_otp' ? (step.allowedCountries[0] ?? '') : '',
    number: step.type === 'phone_otp' ? prefilledText(prefill) : '',
  }));
  const [email, setEmail] = useState(() =>
    step.type === 'email_otp' ? prefilledText(prefill) : '',
  );
  const [entryError, setEntryError] = useState<EntryError | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<CodeError | null>(null);
  const [tooSoon, setTooSoon] = useState(false);
  const [busy, setBusy] = useState<'send' | 'confirm' | 'continue' | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  /** C55.6: continuing after a limit was refused (a 409: the server would not take it yet). */
  const [continueRefused, setContinueRefused] = useState(false);
  const progress = useRef(newSubmissionProgress(verificationId));
  /** The attempt's verification once created (or the initiated one resumed). */
  const [activeId, setActiveId] = useState<string | null>(verificationId);
  /** Bumped with each refused value, so focus moves to its field once rendered (WCAG 3.3.1). */
  const [focusRequest, setFocusRequest] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const container = useScreenFocus(view);

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  // A field's error is its description, not a live region: the field takes focus, so a screen
  // reader reads the error with it. This runs after `useScreenFocus` moved focus to a new view's
  // heading, so a refusal that changes the view still ends on its field.
  useEffect(() => {
    if (focusRequest > 0) {
      container.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
  }, [container, focusRequest]);

  const requestFocus = () => {
    setFocusRequest((count) => count + 1);
  };

  /**
   * A fresh signal for the next request, the previous one aborted, and whether it has been
   * aborted since: a function, because the signal can abort during any await.
   */
  const nextRequest = () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    return { signal: current.signal, aborted: () => current.signal.aborted };
  };

  const showEntry = (error: EntryError | null) => {
    setEntryError(error);
    setView('entry');
    if (error !== null) {
      requestFocus();
    }
  };

  const showCodeError = (error: CodeError) => {
    setCodeError(error);
    requestFocus();
  };

  /** Shows a refusal where the user can act on it; anything else is said as a failure. */
  const refused = async (error: unknown, from: View, aborted: () => boolean) => {
    const code = problemCode(error) ?? '';
    const entry = ENTRY_ERRORS[code];
    const wrongCode = CODE_ERRORS[code];
    if (entry !== undefined) {
      showEntry(entry);
    } else if (wrongCode !== undefined) {
      showCodeError(wrongCode);
      const remaining =
        code === 'otp_code_exhausted' ? 0 : countMember(error, 'attempts-remaining');
      if (remaining !== null) {
        setOpenCode((open) => (open === null ? open : { ...open, attemptsRemaining: remaining }));
      }
    } else if (code === 'otp_resend_too_soon') {
      const resendAt = timeMember(error, 'resend-available-at');
      setOpenCode((open) => (open === null || resendAt === null ? open : { ...open, resendAt }));
      if (from === 'entry') {
        showEntry('tooSoon');
      } else {
        setTooSoon(true);
      }
    } else if (code === 'otp_rate_limited') {
      setView('limited');
    } else if (code === 'otp_already_confirmed') {
      setView('confirmed');
    } else if (SUBMITTED_BY_SERVER.has(code)) {
      await onSubmitted();
    } else {
      if (isConflict(error)) {
        // The verification or the inquiry moved on, perhaps in another window.
        await onSubmitted();
      }
      if (!aborted()) {
        setFailure({ error, view: from });
      }
    }
  };

  const sendBody = (): FlowOtpSendBody | null => {
    if (step.type === 'phone_otp') {
      const parsed = parsePhoneEntry(phone.number, phone.country, step.allowedCountries);
      if (!parsed.ok) {
        showEntry(parsed.problem);
        return null;
      }
      return { 'phone-number': parsed.e164 };
    }
    const problem = emailProblem(email);
    if (problem !== null) {
      showEntry(problem);
      return null;
    }
    return { 'email-address': email.trim() };
  };

  /** Whether the user entered the destination in this screen; a resumed code has none. */
  const destinationEntered = () => (step.type === 'phone_otp' ? phone.number : email).trim() !== '';

  /** Sends a code, from the destination or as a resend from the code entry. */
  const send = async (from: View) => {
    if (from === 'code' && !destinationEntered()) {
      // Resumed with a code open: the server serves the destination masked (C52.2), so only the
      // user knows it. The entry asks for it, as nothing was refused (Workflow 5C review P027).
      showEntry(null);
      return;
    }
    const body = sendBody();
    if (body === null) {
      return;
    }
    const { signal, aborted } = nextRequest();
    setBusy('send');
    setFailure(null);
    setTooSoon(false);
    setEntryError(null);
    try {
      const id = await ensureVerification(client, apiType(step), progress.current, signal);
      setActiveId(id);
      const sent = codeGuidanceOf(await client.sendOtp(id, body, signal)).openCode;
      if (sent === null) {
        // A send that opened no code: only the session can say where the attempt is.
        await onSubmitted();
        return;
      }
      setOpenCode(sent);
      setCode('');
      setCodeError(null);
      setView('code');
    } catch (error: unknown) {
      if (!aborted()) {
        await refused(error, from, aborted);
      }
    } finally {
      if (!aborted()) {
        setBusy(null);
      }
    }
  };

  const confirm = async (id: string) => {
    const digits = code.replace(SEPARATORS, '');
    if (digits === '') {
      showCodeError('required');
      return;
    }
    if (digits.length !== codeLength || !/^[0-9]+$/u.test(digits)) {
      showCodeError('format');
      return;
    }
    const { signal, aborted } = nextRequest();
    setBusy('confirm');
    setFailure(null);
    setCodeError(null);
    try {
      // Confirmed: submitted at once (a verification the server had moved on answers 409 there).
      await client.confirmOtp(id, { code: digits }, signal);
      setView('confirmed');
    } catch (error: unknown) {
      if (!aborted()) {
        await refused(error, 'code', aborted);
      }
    } finally {
      if (!aborted()) {
        setBusy(null);
      }
    }
  };

  /** C55.6: after a limit refusal, the user may submit the verification for review. */
  const continueForReview = async (id: string) => {
    const { signal, aborted } = nextRequest();
    setBusy('continue');
    setFailure(null);
    setContinueRefused(false);
    try {
      await client.submitVerification(id, signal);
    } catch (error: unknown) {
      if (aborted()) {
        return;
      }
      if (isConflict(error)) {
        // Not taken yet (or already taken): the session is read again in case it moved on.
        await onSubmitted();
        if (!aborted()) {
          setContinueRefused(true);
        }
      } else {
        setFailure({ error, view: 'limited' });
      }
      return;
    } finally {
      if (!aborted()) {
        setBusy(null);
      }
    }
    await onSubmitted();
  };

  const failureMessage = (from: View) =>
    failure?.view === from ? t(entryErrorMessageKey(failure.error)) : null;

  const header = (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p>{t(`otp.${channel}.intro`)}</p>
        <p className="text-sm font-medium text-ink-muted">
          {t('attempt', { current: attempt, max: maxAttempts })}
        </p>
      </div>
      <RetryHints hints={hints} photos={false} />
    </div>
  );

  let content;
  if (view === 'confirmed' && activeId !== null) {
    content = <ConfirmedStep verificationId={activeId} client={client} onSubmitted={onSubmitted} />;
  } else if (view === 'limited' && activeId !== null) {
    content = (
      <Card title={t('otp.limited.title')} headingLevel={1}>
        <div className="flex flex-col gap-4">
          <p>{t('otp.limited.message')}</p>
          {continueRefused && <Alert tone="error">{t('otp.limited.failed')}</Alert>}
          <RequestFailure message={failureMessage('limited')} />
          {busy === 'continue' && <p role="status">{t('otp.limited.continuing')}</p>}
          <Button
            className="aria-disabled:cursor-progress sm:self-end"
            aria-disabled={busy === null ? undefined : true}
            onClick={() => {
              if (busy === null) {
                void continueForReview(activeId);
              }
            }}
          >
            {t('otp.limited.continue')}
          </Button>
        </div>
      </Card>
    );
  } else if (view === 'code' && openCode !== null && activeId !== null) {
    content = (
      <CodeEntry
        channel={channel}
        openCode={openCode}
        codeLength={codeLength}
        resent={OTP_MAX_SENDS - openCode.sendsRemaining > 1}
        code={code}
        // C161.4: a code typed on an Arabic keyboard is still a code.
        onCodeChange={(typed) => {
          setCode(normalizeDigits(typed));
        }}
        error={codeError}
        tooSoon={tooSoon}
        busy={busy === 'send' || busy === 'confirm' ? busy : null}
        failure={<RequestFailure message={failureMessage('code')} />}
        onConfirm={() => {
          void confirm(activeId);
        }}
        onResend={() => {
          void send('code');
        }}
        onChangeDestination={() => {
          showEntry(null);
        }}
      />
    );
  } else {
    const entry = {
      error: entryError,
      sending: busy === 'send',
      onSend: () => {
        void send('entry');
      },
      header,
      failure: <RequestFailure message={failureMessage('entry')} />,
    };
    content =
      step.type === 'phone_otp' ? (
        <PhoneEntry
          {...entry}
          allowedCountries={step.allowedCountries}
          value={phone}
          onChange={(next) => {
            setPhone({ ...next, number: normalizeDigits(next.number) });
          }}
        />
      ) : (
        <EmailEntry {...entry} value={email} onChange={setEmail} />
      );
  }

  return <div ref={container}>{content}</div>;
}

function apiType(step: OtpStep): 'phone-number' | 'email-address' {
  return step.type === 'phone_otp' ? 'phone-number' : 'email-address';
}
