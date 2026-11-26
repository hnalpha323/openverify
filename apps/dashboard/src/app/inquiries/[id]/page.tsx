import type { Permission } from '@openverify/core';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EVENTS_CURSOR_PARAM } from '../../../components/lifecycle/inquiry-timeline';
import { ObjectConnectSection } from '../../../components/connect/object-connect-section';
import { InquiryView } from '../../../components/lifecycle/inquiry-view';
import { ObjectPrintButton, ObjectPrintFooter } from '../../../components/print/object-print';
import { recordObjectPrint } from '../../../components/print/print-actions';
import { loadSection } from '../../../components/lifecycle/section-data';
import { InquiryDecisionsSection } from '../../../components/workflows/inquiry-decisions-section';
import { getInquiry, listInquiryEvents } from '../../../lib/api/inquiries';
import { loadLinkedReports } from '../../../lib/api/reports';
import { hasPermission } from '../../../lib/api/me';
import { renderPage } from '../../../lib/api/page';
import { isInquiryId } from '../../../lib/inquiry-query';
import { cursorFromNextLink, parseCursor } from '../../../lib/list-query';
import {
  addInquiryTag,
  expireAllInquirySessions,
  expireInquirySession,
  generateOneTimeLink,
  redactInquiry,
  removeInquiryTag,
  setInquiryTags,
  simulateInquiry,
  transitionInquiry,
  updateInquiryFields,
  updateInquiryNote,
} from '../actions';
import { setDeviceTrust } from '../../devices/actions';
import { dismissListMatch } from '../../list-matches/actions';
import './print.css';

export const metadata: Metadata = { title: 'Inquiry' };

/** Sessions shown per inquiry: an inquiry rarely has more than a few. */
const SESSION_PAGE_SIZE = 100;
/** List matches shown per inquiry, newest first. */
const LIST_MATCH_PAGE_SIZE = 100;

export interface InquiryPageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const ACTIONS = {
  transition: transitionInquiry,
  redact: redactInquiry,
  addTag: addInquiryTag,
  removeTag: removeInquiryTag,
  setTags: setInquiryTags,
  updateNote: updateInquiryNote,
  updateFields: updateInquiryFields,
  generateLink: generateOneTimeLink,
  expireSession: expireInquirySession,
  expireAllSessions: expireAllInquirySessions,
  simulate: simulateInquiry,
  dismissListMatch,
  trustDevice: setDeviceTrust,
};

/**
 * One inquiry (C23): decisions, redaction, details, fields, tags, note, one-time link, sessions,
 * verifications, timeline and sandbox simulation, each shown only with the permission it needs.
 * The inquiry, its sessions and its events load at once.
 */
export default async function InquiryPage({ params, searchParams }: InquiryPageProps) {
  const { id } = await params;
  if (!isInquiryId(id)) {
    notFound();
  }
  const timelineAfter = parseCursor((await searchParams)[EVENTS_CURSOR_PARAM], 'evt');
  return renderPage({ permissions: ['inquiries:read'] }, async ({ session, api }) => {
    const can = (permission: Permission) => hasPermission(session, permission);
    const inquiry = getInquiry(id);
    const [document, decisions, sessions, timeline, reports, listMatches, connect] =
      await Promise.all([
        inquiry,
        // C128.1, C142.4, F32: the decision records slot, read with the inquiry's own scope, once
        // the inquiry's status says whether reopen is offered.
        inquiry.then(({ data }) =>
          loadSection(true, () =>
            InquiryDecisionsSection({
              inquiryId: id,
              status: data.attributes.status,
              redacted: (data.attributes['redacted-at'] ?? null) !== null,
              permissions: session.permissions,
            }),
          ),
        ),
        loadSection(can('inquiry-sessions:read'), async () => {
          const page = await api.inquirySessions.list({
            filter: { 'inquiry-id': id },
            page: { size: SESSION_PAGE_SIZE },
          });
          // C91.1, C108: each session with its device and network, as the API masks them.
          const documents = await Promise.all(
            page.data.map((each) =>
              api.inquirySessions.retrieve(each.id, { include: ['device', 'network'] }),
            ),
          );
          return {
            sessions: documents.map((document) => document.data),
            included: documents.flatMap((document) => document.included ?? []),
          };
        }),
        loadSection(can('events:read'), async () => {
          const page = await listInquiryEvents(id, timelineAfter);
          return { events: page.data, nextCursor: cursorFromNextLink(page.links.next, 'evt') };
        }),
        // C86: the inquiry's reports, as the masked dashboard list answers them.
        loadSection(can('reports:read'), () => loadLinkedReports({ inquiryId: id })),
        // C108: the inquiry's list matches; the dashboard inquiry read does not include them.
        loadSection(can('lists:read'), async () => {
          const page = await api.listMatches.list({
            filter: { 'inquiry-id': id },
            page: { size: LIST_MATCH_PAGE_SIZE },
          });
          return page.data;
        }),
        // C242.3, C242.4 (Workflow 11A console-connect, a named borrowed edit): the Connect slot,
        // with the inquiry's provenance and the verifications its read included.
        inquiry.then(({ data, included }) =>
          loadSection(true, () =>
            ObjectConnectSection({
              subjectId: id,
              permissions: session.permissions,
              provenance: data.attributes.provenance,
              verifications: included
                .filter((resource) => resource.type.startsWith('verification/'))
                .map((resource) => ({
                  id: resource.id,
                  type: resource.type,
                  status: (resource.attributes as { readonly status: string }).status,
                })),
            }),
          ),
        ),
      ]);
    return (
      <div data-inquiry-print="">
        <InquiryView
          document={document}
          abilities={{
            write: can('inquiries:write'),
            redact: can('inquiries:redact'),
            piiView: can('pii:view'),
            verificationsRead: can('verifications:read'),
            accountsRead: can('accounts:read'),
            templatesRead: can('inquiry-templates:read'),
            sessionsWrite: can('inquiry-sessions:write'),
            sandbox: session.environment.kind === 'sandbox',
            reportTemplatesRead: can('report-templates:read'),
            listsRead: can('lists:read'),
            listsWrite: can('lists:write'),
            devicesWrite: can('devices:write'),
          }}
          actions={ACTIONS}
          sessions={sessions}
          timeline={timeline}
          timelineAfter={timelineAfter}
          reports={reports}
          listMatches={listMatches}
          decisions={decisions}
          connect={connect}
          print={{
            button: <ObjectPrintButton objectId={id} action={recordObjectPrint} />,
            footer: (
              <ObjectPrintFooter
                kind="inquiry"
                environment={session.environment.kind}
                objectId={id}
                operatorId={session.user.id}
                personalData={can('pii:view')}
              />
            ),
          }}
        />
      </div>
    );
  });
}
