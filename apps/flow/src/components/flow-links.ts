/**
 * C162.3 (Workflow 9B, api-flow-carry; 9A Stage 3 amendment 47, B43): the version's help and privacy
 * links, which the session serves as `links`. The renderer reports each session's links
 * (`useReportSessionLinks`); the layout's help slot, after every step's content, shows them (3.2.6),
 * and a screen's `link` button names one (`FlowLinksContext`). A link is kept only when it is an
 * `https:` URL, so nothing else is ever put in an `href`, whatever a server sends (fail closed).
 */
import type { FlowSessionResponse } from '@openverify/contracts';
import { createContext, use, useCallback } from 'react';

export type FlowLinkName = 'help-url' | 'privacy-url';

/** The session's links, by name; a link the version sets none of (or not an `https:` one) is absent. */
export type FlowLinks = Readonly<Partial<Record<FlowLinkName, string>>>;

export const NO_FLOW_LINKS: FlowLinks = Object.freeze({});

/** The links in the order the help slot shows them. */
export const FLOW_LINK_NAMES: readonly FlowLinkName[] = Object.freeze(['help-url', 'privacy-url']);

function httpsUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

/** The links of a session, each only when it is an `https:` URL. */
export function sessionLinksOf(links: FlowSessionResponse['links']): FlowLinks {
  const kept: Partial<Record<FlowLinkName, string>> = {};
  for (const name of FLOW_LINK_NAMES) {
    const url = httpsUrl(links?.[name]);
    if (url !== null) {
      kept[name] = url;
    }
  }
  return kept;
}

/** Whether two sets of links name the same URLs. */
export function sameFlowLinks(a: FlowLinks, b: FlowLinks): boolean {
  return FLOW_LINK_NAMES.every((name) => a[name] === b[name]);
}

/** Reports the links of the session just read. */
export type ReportFlowLinks = (links: FlowLinks) => void;

/** The links the layout knows, for the screens' `link` buttons. */
export const FlowLinksContext = createContext<FlowLinks>(NO_FLOW_LINKS);

/** The layout's reporter, which the renderer calls with each session (`useReportSessionLinks`). */
export const ReportFlowLinksContext = createContext<ReportFlowLinks>(() => undefined);

/** The renderer's hook: report the links of each session it reads. */
export function useReportSessionLinks(): (session: Pick<FlowSessionResponse, 'links'>) => void {
  const report = use(ReportFlowLinksContext);
  return useCallback(
    (session: Pick<FlowSessionResponse, 'links'>) => {
      report(sessionLinksOf(session.links));
    },
    [report],
  );
}
