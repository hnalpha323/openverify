import type { FlowDecisionContestRoute, FlowSessionResponse } from '@openverify/contracts';
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { withFinalOutcomes, type FinalOutcome } from '../api/final-outcome';
import type { FlowApiClient } from '../api/flow-api-client';
import { ApiError } from '../components/api-error';
import { FlowLanguagesContext } from '../components/flow-languages';
import { useReportSessionLinks } from '../components/flow-links';
import { LinkError } from '../components/link-error';
import { LoadingCard } from '../components/loading-card';
import { SandboxBanner } from '../components/sandbox-banner';
import { ConfirmedStep } from '../steps/confirmed-step';
import { ConsentStep } from '../steps/consent-step';
import { CryptoWalletStep } from '../steps/crypto-wallet/crypto-wallet-step';
import { DeviceHandoffStep } from '../steps/device-handoff/device-handoff-step';
import { DocumentStep } from '../steps/document/document-step';
import { FinalizingStep } from '../steps/finalizing-step';
import { EnteredValuesStep } from '../steps/forms/entered-values-step';
import { OneTimeCodeStep } from '../steps/otp/one-time-code-step';
import { CompletionScreen, ExpiredScreen, FailureScreen } from '../steps/outcome-screens';
import { negotiateLanguage, type SupportedLanguage } from '../i18n/languages';
import { LiveScreenStep } from '../screens/live-screen-step';
import { RequestedLanguagesContext } from '../session/requested-languages';
import { applySessionCopy, copyLanguage, copyText } from '../session/session-copy';
import { HaltedScreen, StoppedScreen, WaitingStep } from '../steps/position-screens';
import { reportEmbedCancel } from '../embed/bridge';
import { ProcessingStep } from '../steps/processing-step';
import { SelfieCaptureStep } from '../steps/selfie-capture-step';
import { SessionEndedScreen } from '../steps/session-ended-screen';
import { ShareConsentStep } from '../steps/share-consent/share-consent-step';
import { WithdrawableShareConsents } from '../steps/share-consent/withdrawable-share-consents';
import { SilentStep } from '../steps/silent-step';
import { NfcStep } from '../steps/nfc/nfc-step';
import { UnsupportedStep } from '../steps/unsupported-step';
import { VerificationCaptureStep } from '../steps/verification-capture-step';
import { useApplySessionTheme } from '../theme/session-theme';
import { resolveFlowPosition, type FlowPosition } from './flow-position';
import { useScreenFocus } from './use-screen-focus';
import { useSignalCollection } from './use-signal-collection';

export interface FlowRendererProps {
  readonly client: FlowApiClient;
  /** The inquiry the link was issued for; the session must belong to it. */
  readonly inquiryId: string;
}

type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly session: FlowSessionResponse }
  | { readonly status: 'mismatch' }
  /**
   * Load `attempt` failed and can be retried. While the retry runs (`retrying`), this screen
   * stays, so focus stays on Try again (2E follow-up, as Workflow 2D F016 did for one-time links).
   */
  | {
      readonly status: 'error';
      readonly error: unknown;
      readonly attempt: number;
      readonly retrying: boolean;
    };

/** The error state after `current`: each failure in a row is a new attempt, with a new screen. */
function failedLoad(current: LoadState, error: unknown): LoadState {
  const attempt = current.status === 'error' ? current.attempt + 1 : 0;
  return { status: 'error', error, attempt, retrying: false };
}

/** Identifies a screen without a flow position: each failed attempt is a screen of its own. */
function loadKey(state: LoadState): string {
  return state.status === 'error' ? `error:${String(state.attempt)}` : state.status;
}

/** Identifies the screen, so a new step (or a new attempt) starts fresh and gets focus. */
function screenKey(position: FlowPosition): string {
  switch (position.kind) {
    case 'capture':
      return `capture:${position.step.id}:${String(position.attempt)}`;
    case 'processing':
      return `processing:${position.verificationId}`;
    case 'expired':
    case 'halted':
      return position.kind;
    // C150.5: one waiting screen polls until the server moves on, whatever each poll answers.
    case 'waiting':
      return `waiting:${position.stepId ?? ''}`;
    default:
      return `${position.kind}:${position.step?.id ?? ''}`;
  }
}

/**
 * Loads the flow session and renders the step the user is on (see `resolveFlowPosition`).
 *
 * Whatever screen makes a call, an answer that ends the session (C19: an expired or canceled
 * session, or a redacted inquiry) replaces the flow with a final screen without a retry. A
 * sandbox session shows its banner on every screen (C19).
 *
 * Focus moves to the heading of each new screen. A failed load keeps its error screen, with focus
 * on Try again, while the retry runs, so focus never falls to the page (2E follow-up).
 */
export function FlowRenderer({ client: rawClient, inquiryId }: FlowRendererProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [final, setFinal] = useState<FinalOutcome | null>(null);
  const [sandbox, setSandbox] = useState(false);
  // C148.2: the person stopped for now (a confirmed cancel button); the inquiry stays resumable.
  const [stopped, setStopped] = useState(false);
  const { i18n } = useTranslation();
  const requested = use(RequestedLanguagesContext);
  const reportLanguages = use(FlowLanguagesContext);
  const reportLinks = useReportSessionLinks();
  const applyTheme = useApplySessionTheme();
  // C161.2: the language is negotiated against the version's locales once, on the first session;
  // afterwards the person's own choice in the selector stands.
  const negotiated = useRef(false);

  // The first final outcome wins: later calls of unmounting screens must not change it.
  const client = useMemo(
    () =>
      withFinalOutcomes(rawClient, (outcome) => {
        setFinal((current) => current ?? outcome);
      }),
    [rawClient],
  );

  // C160.6, C160.9 (Workflow 9B): the theme's font and logo are read with the session token.
  const themeOptions = useMemo(
    () => ({
      loadAsset: (assetId: string, signal?: AbortSignal) => client.getThemeAsset(assetId, signal),
    }),
    [client],
  );

  const accept = useCallback(
    (session: FlowSessionResponse): LoadState => {
      setSandbox(session.environment?.kind === 'sandbox');
      if (session.inquiry.id !== inquiryId) {
        return { status: 'mismatch' };
      }
      // C160.9: the theme, through api-themes' hook (a no-op until 9B).
      applyTheme(session, themeOptions);
      // C162.5: the operator's texts of built-in keys over the catalogs, before the step renders.
      applySessionCopy(i18n, session.copy);
      const enabled: readonly SupportedLanguage[] | null = session.locales?.enabled ?? null;
      reportLanguages(enabled);
      // C162.3: the version's help and privacy links, for the help slot and link buttons.
      reportLinks(session);
      let language = i18n.resolvedLanguage ?? i18n.language;
      if (enabled !== null && (!negotiated.current || !enabled.some((one) => one === language))) {
        negotiated.current = true;
        const candidates = requested.length > 0 ? requested : navigator.languages;
        language = negotiateLanguage(candidates, {
          available: enabled,
          ...(session.locales === undefined ? {} : { fallback: session.locales.default }),
        }).language;
      }
      // Also re-renders the screens that read a text the copy replaced.
      void i18n.changeLanguage(language);
      return { status: 'ready', session };
    },
    [applyTheme, i18n, inquiryId, reportLanguages, reportLinks, requested, themeOptions],
  );

  /** Loads the session; rejects when the request fails. Waiting screens poll with this. */
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState(accept(await client.getSession(signal)));
    },
    [accept, client],
  );

  /** Loads the session; a failure replaces the screen with an error and a retry. */
  const refresh = useCallback(async () => {
    try {
      await load();
    } catch (error: unknown) {
      setState((current) => failedLoad(current, error));
    }
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    client.getSession(controller.signal).then(
      (session) => {
        setState(accept(session));
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setState((current) => failedLoad(current, error));
        }
      },
    );
    return () => {
      controller.abort();
    };
  }, [accept, client]);

  const position = useMemo(
    () => (state.status === 'ready' ? resolveFlowPosition(state.session) : null),
    [state],
  );
  // C94.3, C94.6 (Workflow 7A): the signal collection, from consent on, screen by screen.
  // The steps submit through this client, which first sends the open screen's signals (C90.5).
  const stepClient = useSignalCollection(
    client,
    state.status === 'ready' ? state.session : null,
    position,
  );
  let key = position === null ? loadKey(state) : screenKey(position);
  if (stopped) {
    key = 'stopped';
  }
  if (final !== null) {
    key = `final:${final}`;
  }
  const session = state.status === 'ready' ? state.session : null;
  const language = i18n.resolvedLanguage ?? i18n.language;
  // C162.5: a copy key's text through the fallbacks, never a raw key.
  const copy = useCallback(
    (copyKey: string) =>
      copyText(i18n, session?.copy, copyKey, language, session?.locales?.default),
    [i18n, session, language],
  );
  // WCAG 3.1.2 (Workflow 9D): the language of a text the fallback took from the default locale.
  const textLanguage = useCallback(
    (copyKey: string) =>
      copyLanguage(i18n, session?.copy, copyKey, language, session?.locales?.default),
    [i18n, session, language],
  );

  // When the screen changes, move focus to its heading so screen readers announce it.
  const container = useScreenFocus(key);

  let content;
  if (final !== null) {
    content = <SessionEndedScreen outcome={final} />;
  } else if (stopped) {
    content = <StoppedScreen />;
  } else if (state.status === 'loading') {
    content = <LoadingCard />;
  } else if (state.status === 'mismatch') {
    content = <LinkError reason="mismatch" />;
  } else if (state.status === 'error') {
    content = (
      <ApiError
        error={state.error}
        retrying={state.retrying}
        onRetry={() => {
          setState({ ...state, retrying: true });
          void refresh();
        }}
      />
    );
  } else {
    content = (
      <Position
        key={key}
        position={position}
        client={stepClient}
        refresh={refresh}
        poll={load}
        sandbox={sandbox}
        retentionDays={state.session['face-template-retention-days'] ?? null}
        contestRoute={state.session['decision-contest-route'] ?? null}
        redirectUrl={state.session.completion?.['redirect-url'] ?? null}
        copy={copy}
        copyLanguage={textLanguage}
        sessionCopy={state.session.copy}
        sessionValues={state.session.values}
        onStop={() => {
          setStopped(true);
          // C159.4: an embedding page hears that the person stopped for now.
          reportEmbedCancel();
        }}
      />
    );
  }

  return (
    <div ref={container}>
      {sandbox && <SandboxBanner />}
      {content}
      {/* C237.6 (Workflow 11A, clients-connect): withdrawing an accepted share, on every later screen. */}
      {session !== null && final === null && !stopped && (
        <WithdrawableShareConsents
          consents={session['withdrawable-share-consents']}
          client={stepClient}
          onWithdrawn={refresh}
        />
      )}
    </div>
  );
}

interface PositionProps {
  readonly position: FlowPosition | null;
  readonly client: FlowApiClient;
  readonly refresh: () => Promise<void>;
  readonly poll: (signal: AbortSignal) => Promise<void>;
  readonly sandbox: boolean;
  /** C128.7: the route a declined inquiry names, which the completion screen shows. */
  readonly contestRoute: FlowDecisionContestRoute | null;
  /** The session's `face-template-retention-days` (C42.6), or `null`. */
  readonly retentionDays: number | null;
  /** C158.5: the session's `completion.redirect-url`, or `null`. */
  readonly redirectUrl: string | null;
  /** C162.5: a copy key's text, or `null`. */
  readonly copy: (key: string) => string | null;
  /** WCAG 3.1.2: the language of a copy key's text when the fallback took it from another locale. */
  readonly copyLanguage: (key: string) => string | null;
  /** C162.9: the session's operator copy, for the consent's `copy-source`. */
  readonly sessionCopy: FlowSessionResponse['copy'];
  /** C148.7: the session's `values`, which a `prefillFrom` step shows filled. */
  readonly sessionValues: FlowSessionResponse['values'];
  /** C148.2: a confirmed cancel button. */
  readonly onStop: () => void;
}

function Position({
  position,
  client,
  refresh,
  poll,
  sandbox,
  retentionDays,
  contestRoute,
  redirectUrl,
  copy,
  copyLanguage: textLanguageOf,
  sessionCopy,
  sessionValues,
  onStop,
}: PositionProps) {
  const prefill = sessionValues === undefined ? {} : { prefill: sessionValues };
  switch (position?.kind) {
    // C148 (Workflow 9A): a screen of components, submitted to the server, which decides what follows.
    case 'screen':
      return (
        <LiveScreenStep
          position={position}
          client={client}
          onSubmitted={refresh}
          onCancel={onStop}
          copy={copy}
          copyLanguage={textLanguageOf}
        />
      );
    // C150.5, C152.2: the server waits for facts or a workflow; read the session until it moves on.
    case 'waiting':
      return <WaitingStep intervalMs={position.retryAfterMs} onPoll={poll} />;
    // C151.2: the flow's caps stopped it.
    case 'halted':
      return <HaltedScreen />;
    case 'consent':
      return (
        <ConsentStep
          step={position.step}
          client={client}
          onAccepted={refresh}
          retentionDays={retentionDays}
          {...(sessionCopy === undefined ? {} : { copy: sessionCopy })}
        />
      );
    case 'capture': {
      const { step } = position;
      switch (step.type) {
        // C46.1: a selfie speaks the C40 capture protocol with the guided camera.
        case 'selfie':
          return (
            <SelfieCaptureStep
              position={{ ...position, step }}
              client={client}
              onSubmitted={refresh}
              sandbox={sandbox}
            />
          );
        case 'government_id':
          return (
            <VerificationCaptureStep
              position={{ ...position, step }}
              client={client}
              onSubmitted={refresh}
            />
          );
        // C55, C64.1: a code sent to the phone number or email address.
        case 'phone_otp':
        case 'email_otp':
          return (
            <OneTimeCodeStep
              position={{ ...position, step }}
              client={client}
              onSubmitted={refresh}
              {...prefill}
            />
          );
        // C57, C64.1: a signed challenge from a browser wallet, or pasted.
        case 'crypto_wallet':
          return (
            <CryptoWalletStep
              position={{ ...position, step }}
              client={client}
              onSubmitted={refresh}
            />
          );
        // C52.3, C61, C64.1: a database step, the AAMVA form (a silent AAMVA step is `silent`),
        // a business registry step or a business website step.
        case 'database':
        case 'aamva':
        case 'database_business':
        case 'business_website':
          return (
            <EnteredValuesStep
              position={{ ...position, step }}
              client={client}
              onSubmitted={refresh}
              {...prefill}
            />
          );
        // C60, C64.1: a document uploaded as a PDF or a photo.
        case 'document':
          return (
            <DocumentStep position={{ ...position, step }} client={client} onSubmitted={refresh} />
          );
        // C64.1: the Phase 5 screens land one by one; until then the step is named, not skipped.
        default:
          return <UnsupportedStep step={step} reason="step" />;
      }
    }
    // C64.1: resuming on a confirmed code submits it at once.
    case 'confirmed':
      return (
        <ConfirmedStep
          verificationId={position.verificationId}
          client={client}
          onSubmitted={refresh}
        />
      );
    // C59.6: the server creates and decides a silent AAMVA attempt; the flow waits on it.
    case 'silent':
      return <SilentStep step={position.step} onPoll={poll} />;
    case 'processing':
      return (
        <ProcessingStep
          client={client}
          verificationId={position.verificationId}
          attempt={position.attempt}
          maxAttempts={position.maxAttempts}
          onSettled={refresh}
          photos={position.step.type === 'government_id' || position.step.type === 'selfie'}
        />
      );
    case 'finalizing':
      return <FinalizingStep onPoll={poll} />;
    case 'completion':
      return (
        <CompletionScreen
          step={position.step}
          contestRoute={contestRoute}
          redirectUrl={redirectUrl}
        />
      );
    // C150.7: a failure on an adverse path shows its contest route as a decline does.
    case 'failure':
      return (
        <FailureScreen step={position.step} contestRoute={contestRoute} redirectUrl={redirectUrl} />
      );
    case 'expired':
      return <ExpiredScreen />;
    case 'unsupported':
      return <UnsupportedStep step={position.step} reason={position.reason} />;
    // C238.6 (Workflow 11A): the share-consent step's screen (`clients-connect`'s, `steps/share-consent/`).
    case 'share-consent':
      return <ShareConsentStep step={position.step} client={client} onDone={refresh} />;
    // C207.10 (Workflow 10C): the nfc step's screen in a browser (`api-nfc`'s, `steps/nfc/`).
    case 'nfc':
      return <NfcStep step={position.step} client={client} onDone={refresh} />;
    // C96.1, C96.3 (Workflow 7A; F01): the desktop's handoff step, `flow-handoff`'s screen.
    case 'handoff':
      return (
        <DeviceHandoffStep
          step={position.step}
          handoff={position.handoff}
          client={client}
          onDone={refresh}
        />
      );
    case undefined:
      return null;
  }
}
