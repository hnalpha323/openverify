import { Card } from '@openverify/ui';
import { useTranslation } from 'react-i18next';
import { Link, Route, Routes } from 'react-router';
import type { FlowApiClient } from './api/flow-api-client';
import type { FlowTransportOptions } from './api/flow-transport';
import { FlowLayout } from './components/flow-layout';
import { LinkError, type LinkErrorReason } from './components/link-error';
import { EmbedEntry } from './embed/embed-entry';
import { FlowRenderer } from './flow/flow-renderer';
import { HandoffRedeemFlow } from './handoff';
import { OneTimeLinkFlow } from './flow/one-time-link-flow';

const HOME_PATH = '/';

/**
 * What the flow starts from: a usable session, a one-time link to redeem first (C19), or the
 * reason the link cannot be used.
 */
export type FlowStart =
  | { readonly status: 'ready'; readonly inquiryId: string; readonly client: FlowApiClient }
  | {
      readonly status: 'one-time-link';
      readonly inquiryId: string;
      readonly redeem: () => Promise<{ readonly sessionToken: string }>;
      readonly connect: (sessionToken: string) => FlowApiClient;
    }
  /** C96.3 (Workflow 7A): a handoff link on the phone, redeemed on Continue only. */
  | {
      readonly status: 'handoff';
      readonly inquiryId: string;
      readonly handoffToken: string;
      readonly transport: FlowTransportOptions;
      readonly connect: (sessionToken: string) => FlowApiClient;
    }
  | { readonly status: 'error'; readonly reason: LinkErrorReason };

function Start({ start }: { readonly start: FlowStart }) {
  switch (start.status) {
    case 'ready':
      return <FlowRenderer client={start.client} inquiryId={start.inquiryId} />;
    case 'one-time-link':
      return (
        <OneTimeLinkFlow
          inquiryId={start.inquiryId}
          redeem={start.redeem}
          connect={start.connect}
        />
      );
    // C96.3 (Workflow 7A; P15): the phone's preview, context, consent and redemption.
    case 'handoff':
      return (
        <HandoffRedeemFlow
          inquiryId={start.inquiryId}
          handoffToken={start.handoffToken}
          transport={start.transport}
          connect={start.connect}
        />
      );
    case 'error':
      return <LinkError reason={start.reason} />;
  }
}

function NotFound() {
  const { t } = useTranslation();

  return (
    <Card title={t('notFound.title')} headingLevel={1}>
      <Link
        to={HOME_PATH}
        className="font-medium text-primary underline underline-offset-4 hover:text-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {t('notFound.back')}
      </Link>
    </Card>
  );
}

/**
 * The flow's routes, in React Router's declarative mode (see docs/adr/0003-web-routing.md).
 * The step on screen comes from the server (`GET /flow/session`), not from the URL, so a
 * reload or the back button always lands on the step the user is really on.
 * Render inside a router: BrowserRouter when hosted, MemoryRouter in tests (and later
 * when embedded or inline, so the flow never rewrites the customer page's URL).
 */
export function FlowRoutes({ start }: { readonly start: FlowStart }) {
  return (
    <Routes>
      <Route element={<FlowLayout />}>
        <Route index element={<Start start={start} />} />
        {/* C157.1, C159.4 (Workflow 9A): the embedded flow, built by flow-server-embed. */}
        <Route
          path="embed/:inquiryId"
          element={<EmbedEntry flow={<Start start={start} />} fallback={<NotFound />} />}
        />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
