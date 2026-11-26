import {
  VERIFICATION_RESOURCE_TYPES,
  inquiryTransitionMetaSchema,
  type EventResource,
  type VerificationResourceType,
} from '@openverify/contracts';
import Link from 'next/link';
import { VERIFICATION_EVENT_ACTION_WORDS, eventWords } from '../../lib/event-words';
import { INQUIRY_STATUS_LABELS, VERIFICATION_TYPE_LABELS } from '../../lib/labels';
import { CAPTURE_ERROR_TEXT } from '../../lib/selfie-words';
import { listHref } from '../../lib/list-query';
import { LINK_CLASS } from '../link-styles';
import { Timestamp } from '../timestamp';

/** The page URL parameter of the timeline's cursor. */
export const EVENTS_CURSOR_PARAM = 'events-after';

const EVENT_LABELS: Readonly<Record<string, string>> = {
  'inquiry.created': 'Created',
  'inquiry.started': 'Started by the end user',
  'inquiry.completed': 'Completed',
  'inquiry.failed': 'Failed',
  'inquiry.expired': 'Expired',
  'inquiry.approved': 'Approved',
  'inquiry.declined': 'Declined',
  'inquiry.marked-for-review': 'Marked for review',
  'inquiry.updated-tags': 'Tags changed',
  'inquiry.redacted': 'Redacted',
  'inquiry-session.started': 'Session started',
  'inquiry-session.expired': 'Session expired',
  'inquiry-session.canceled': 'Session canceled',
};

/** What happened to a verification, after its type ("Government ID verification passed"). */
const verificationEventAction = (name: string): string | undefined =>
  Object.hasOwn(VERIFICATION_EVENT_ACTION_WORDS, name)
    ? VERIFICATION_EVENT_ACTION_WORDS[name as keyof typeof VERIFICATION_EVENT_ACTION_WORDS]
    : undefined;

const isVerificationResourceType = (type: string): type is VerificationResourceType =>
  (VERIFICATION_RESOURCE_TYPES as readonly string[]).includes(type);

/** The verification a verification event is about, or `null` for any other event. */
function verificationOf(event: EventResource): { id: string; label: string } | null {
  const { data } = event.attributes.payload;
  // A redacted event keeps its subject's type and id (C16), so it still names them. Every
  // verification type is one (C50.1, C54.5).
  return isVerificationResourceType(data.type)
    ? { id: data.id, label: VERIFICATION_TYPE_LABELS[data.type] }
    : null;
}

/**
 * The selfie capture a `selfie.*` event is about (C40.8): its verification and error code, both
 * `null` once the capture is redacted (the payload is then a stub); `null` for any other event.
 */
function captureOf(
  event: EventResource,
): { verificationId: string | null; errorCode: string | null } | null {
  const { data } = event.attributes.payload;
  if (data.type !== 'selfie') {
    return null;
  }
  return 'relationships' in data
    ? {
        verificationId: data.relationships.verification.data.id,
        errorCode: data.attributes['error-code'],
      }
    : { verificationId: null, errorCode: null };
}

/** The verification page an event links to: its verification's, or its capture's. */
function verificationHref(event: EventResource): string | null {
  const id = verificationOf(event)?.id ?? captureOf(event)?.verificationId ?? null;
  return id === null ? null : `/verifications/${id}`;
}

/** What an event says happened, in plain words. */
function describe(event: EventResource): string {
  const { name, payload } = event.attributes;
  const verification = verificationOf(event);
  const happened = verificationEventAction(name);
  if (verification !== null && happened !== undefined) {
    return `${verification.label} verification ${happened}`;
  }
  const capture = captureOf(event);
  const words = eventWords(name);
  if (capture !== null && words !== undefined) {
    const code = capture.errorCode;
    // C40.1: why the capture errored (superseded, expired, canceled, processing failed).
    return code !== null && Object.hasOwn(CAPTURE_ERROR_TEXT, code)
      ? `${words} (${CAPTURE_ERROR_TEXT[code as keyof typeof CAPTURE_ERROR_TEXT].words})`
      : words;
  }
  if (name === 'inquiry.transitioned') {
    const meta = inquiryTransitionMetaSchema.safeParse('meta' in payload ? payload.meta : null);
    return meta.success
      ? `Status changed from ${INQUIRY_STATUS_LABELS[meta.data.from]} to ${INQUIRY_STATUS_LABELS[meta.data.to]}`
      : 'Status changed';
  }
  return EVENT_LABELS[name] ?? name;
}

export interface InquiryTimelineProps {
  readonly inquiryId: string;
  /** Newest first, as the Events API lists them. */
  readonly events: readonly EventResource[];
  /** The event this page started after, or undefined on the newest page. */
  readonly after?: string | undefined;
  /** The cursor of older events, or `null` when there are none. */
  readonly nextCursor: string | null;
  /**
   * `verifications:read`: verification events, and selfie capture events, link their
   * verification's page (C26, C47).
   */
  readonly linkVerifications?: boolean;
}

/**
 * The events of the inquiry, its verifications and its sessions (C12 Events API,
 * `filter[inquiry-id]`, C25.7), newest first.
 */
export function InquiryTimeline({
  inquiryId,
  events,
  after,
  nextCursor,
  linkVerifications = false,
}: InquiryTimelineProps) {
  if (events.length === 0 && after === undefined) {
    return <p className="text-sm text-ink-muted">No events yet.</p>;
  }
  const path = `/inquiries/${inquiryId}`;
  return (
    <div className="flex flex-col gap-3">
      <ol aria-label="Timeline" className="flex flex-col gap-3 border-s-2 border-line ps-4">
        {events.map((event) => {
          const href = verificationHref(event);
          return (
            <li key={event.id} className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">
                {linkVerifications && href !== null ? (
                  <Link href={href} className={LINK_CLASS}>
                    {describe(event)}
                  </Link>
                ) : (
                  describe(event)
                )}
              </span>
              <span className="flex flex-wrap gap-x-3 text-xs text-ink-muted">
                <Timestamp value={event.attributes['created-at']} />
                <code className="font-mono">{event.attributes.name}</code>
              </span>
            </li>
          );
        })}
      </ol>
      {(after !== undefined || nextCursor !== null) && (
        <nav aria-label="Timeline pages" className="flex items-center gap-6 text-sm">
          {after !== undefined && (
            <Link href={path} className={LINK_CLASS}>
              Newest events
            </Link>
          )}
          {nextCursor !== null && (
            <Link
              href={listHref(path, { [EVENTS_CURSOR_PARAM]: nextCursor })}
              className={`ms-auto ${LINK_CLASS}`}
            >
              Older events
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
