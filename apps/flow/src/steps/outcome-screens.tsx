import type { FlowDecisionContestRoute } from '@openverify/contracts';
import { Card } from '@openverify/ui';
import { useTranslation } from 'react-i18next';
import type { CompletionStep, FailureStep } from '../flow/flow-position';
import { useIsolatedT } from '../i18n/bidi';
import { translateKey } from '../i18n/translate-key';

/** The step's own message when this version has it, otherwise the default one. */
function useStepMessage(
  messageKey: string | undefined,
  fallback: 'flow.completion' | 'flow.failure',
): string {
  const { t, i18n } = useTranslation();
  return (messageKey === undefined ? null : translateKey(i18n, messageKey)) ?? t(fallback);
}

/**
 * C128.7 (P40): how to contest a decline, with a URL's host shown before the link. The framing
 * words are the built-in catalogs' `contest.*` (K9-33); the route is the operator's text, shown as
 * written, with the host and the contact each isolated in `<bdi>` (C161.3).
 */
function ContestRoute({ route }: { readonly route: FlowDecisionContestRoute }) {
  const { t } = useTranslation();
  const tb = useIsolatedT();

  return (
    <section aria-label={t('contest.heading')}>
      <p>{t('contest.intro')}</p>
      {route.url === null ? null : (
        <>
          <p>{tb('contest.host', { host: route.host ?? '' })}</p>
          <p>
            <a href={route.url} target="_blank" rel="noopener noreferrer">
              {t('contest.link')}
            </a>
          </p>
        </>
      )}
      {route.contact === null ? null : <p>{tb('contest.contact', { contact: route.contact })}</p>}
    </section>
  );
}

/**
 * C158.5 (decision 15; review H13): the way back to the customer's site. The outcome is announced
 * in a live region and the person goes back with "Continue", a link to the URL the server built
 * (`inquiry-id`, and `status` only when the version opts in); the flow never navigates on a timer,
 * which would be a time limit the person cannot control (WCAG 2.2.1, failure F41).
 */
function Redirect({ url }: { readonly url: string }) {
  const { t } = useTranslation();

  return (
    <div className="mt-4 flex flex-col gap-4">
      <p role="status">{t('screen.redirect.announce')}</p>
      <a
        href={url}
        referrerPolicy="no-referrer"
        className="inline-flex min-h-11 items-center justify-center self-start rounded-md bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {t('screen.redirect.continue')}
      </a>
    </div>
  );
}

export interface OutcomeScreenProps<Step> {
  readonly step: Step | null;
  /** C128.7, C150.7: how to contest a decision, when the decision record names one. */
  readonly contestRoute?: FlowDecisionContestRoute | null;
  /** C158.5: the session's `completion.redirect-url`, or `null` when none is allowed. */
  readonly redirectUrl?: string | null;
}

/**
 * The user's part is done. A declined inquiry whose decision names a contest route shows it: nothing
 * else tells the person that they can ask for a review (C128.7). The screen never says why.
 */
export function CompletionScreen({
  step,
  contestRoute = null,
  redirectUrl = null,
}: OutcomeScreenProps<CompletionStep>) {
  const { t } = useTranslation();
  const message = useStepMessage(step?.messageKey, 'flow.completion');

  return (
    <Card title={t('completion.title')} headingLevel={1}>
      <p>{message}</p>
      {contestRoute === null ? null : <ContestRoute route={contestRoute} />}
      {redirectUrl === null ? null : <Redirect url={redirectUrl} />}
    </Card>
  );
}

/**
 * The inquiry failed; no details about why are ever shown. C150.7: a failure on an adverse path
 * shows its contest route, as the completion screen does for a decline.
 */
export function FailureScreen({
  step,
  contestRoute = null,
  redirectUrl = null,
}: OutcomeScreenProps<FailureStep>) {
  const { t } = useTranslation();
  const message = useStepMessage(step?.messageKey, 'flow.failure');

  return (
    <Card title={t('failure.title')} headingLevel={1}>
      <p>{message}</p>
      {contestRoute === null ? null : <ContestRoute route={contestRoute} />}
      {redirectUrl === null ? null : <Redirect url={redirectUrl} />}
    </Card>
  );
}

/** The inquiry expired before the user finished. */
export function ExpiredScreen() {
  const { t } = useTranslation();

  return (
    <Card title={t('expired.title')} headingLevel={1}>
      <p>{t('expired.message')}</p>
    </Card>
  );
}
