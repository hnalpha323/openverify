/**
 * The case page's sections (C142.2): the header, the held objects, the timeline, the comments and
 * the attachments, rendered from what the API returned and masked as it masked it.
 */
import type {
  CaseAttachment,
  CaseCommentResource,
  CaseHistoryEntryResource,
  CaseResource,
  CaseStatusDefinitionResource,
  CaseTemplateResource,
} from '@openverify/contracts';
import type { CaseHeldObjectType, InquiryStatus } from '@openverify/core';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ActionResult, ActionState } from '../../../lib/action-state';
import { ConfirmActionButton } from '../../confirm-action-button';
import { DataTable } from '../../data-table';
import { Detail } from '../../detail';
import { inquiryActionsFor } from '../../lifecycle/inquiry-action-names';
import { RedactedValue } from '../../lifecycle/redacted-value';
import { LINK_CLASS } from '../../link-styles';
import { HiddenValue } from '../../masked-value';
import { Timestamp } from '../../timestamp';
import {
  CATEGORY_WORDS,
  HELD_GROUPS,
  attachmentServed,
  historyDetails,
  historySentence,
  renditionWords,
  scanWords,
  sizeWords,
  slaWords,
  statusLabel,
  statusWords,
} from './case-words';
import { CommentText } from './comment-text';
import type { HeldRow, LiveState } from './load-case';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

const code = (value: string) => <code className="font-mono text-xs break-all">{value}</code>;
const muted = (words: string) => <span className="text-ink-muted">{words}</span>;

/** A person the page may name: "you", their email when users are readable, else their id. */
export function personName(
  id: string | null,
  viewerId: string,
  people: ReadonlyMap<string, string>,
): ReactNode {
  if (id === null) {
    return muted('Nobody');
  }
  if (id === viewerId) {
    return (
      <>
        You <span className="text-ink-muted">({code(id)})</span>
      </>
    );
  }
  const email = people.get(id);
  return email === undefined ? (
    code(id)
  ) : (
    <>
      {email} <span className="text-ink-muted">({code(id)})</span>
    </>
  );
}

/** C142.2: the header's details, each state in words (1.4.1). */
export function CaseDetails({
  resource,
  template,
  statuses,
  queueName,
  viewerId,
  people,
  now,
}: {
  readonly resource: CaseResource;
  readonly template: CaseTemplateResource | null;
  readonly statuses: readonly CaseStatusDefinitionResource[] | null;
  readonly queueName: string | null;
  readonly viewerId: string;
  readonly people: ReadonlyMap<string, string>;
  readonly now: number;
}) {
  const { attributes, relationships } = resource;
  const templateId = relationships['case-template'].data.id;
  const queueId = relationships['case-queue'].data?.id ?? null;
  return (
    // The group names the list; a role on the <dl> itself would take the list from its terms.
    <div role="group" aria-label="Case details">
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Detail term="Template">
          <Link href={`/case-templates/${templateId}`} className={LINK_CLASS}>
            {template?.attributes.name ?? templateId}
          </Link>
        </Detail>
        <Detail term="Status">{statusLabel(statuses, attributes.status)}</Detail>
        <Detail term="Category">{CATEGORY_WORDS[attributes['status-category']]}</Detail>
        <Detail term="Resolution">{attributes.resolution ?? muted('Not resolved')}</Detail>
        <Detail term="Assignee">{personName(attributes['assignee-id'], viewerId, people)}</Detail>
        <Detail term="Queue">
          {queueId === null ? muted('No queue') : (queueName ?? code(queueId))}
        </Detail>
        <Detail term="SLA">
          <span className="flex flex-col">
            <span>{slaWords(attributes['sla-state'], attributes['sla-expires-at'], now)}</span>
            {attributes['sla-expires-at'] !== null && (
              <span className="text-xs text-ink-muted">
                Due <Timestamp value={attributes['sla-expires-at']} /> (UTC)
              </span>
            )}
          </span>
        </Detail>
        <Detail term="Created">
          <Timestamp value={attributes['created-at']} /> by {code(attributes['creator-id'])}
        </Detail>
      </dl>
    </div>
  );
}

/** The case's fields, member-wise as the API masked them: masked reads "Hidden", never empty. */
export function CaseFields({
  fields,
  masked,
}: {
  readonly fields: CaseResource['attributes']['fields'];
  readonly masked: boolean;
}) {
  if (fields === null) {
    return <RedactedValue />;
  }
  const entries = Object.entries(fields);
  if (entries.length === 0) {
    return <p className="text-sm text-ink-muted">This case has no fields.</p>;
  }
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {entries.map(([key, field]) => (
        <Detail key={key} term={key}>
          {field.value === null || field.value === undefined ? (
            masked ? (
              <HiddenValue />
            ) : (
              muted('Not set')
            )
          ) : typeof field.value === 'string' ||
            typeof field.value === 'number' ||
            typeof field.value === 'boolean' ? (
            String(field.value)
          ) : (
            <code className="font-mono text-xs break-all">{JSON.stringify(field.value)}</code>
          )}
        </Detail>
      ))}
    </dl>
  );
}

function liveCell(live: LiveState): ReactNode {
  switch (live.kind) {
    case 'no-access':
      return muted('No access');
    case 'gone':
      return muted('Not found: deleted or out of reach');
    case 'not-read':
      return muted('Open the object to see its state');
    case 'shown':
      if (live.redacted) {
        return <RedactedValue />;
      }
      return live.status === null ? muted('No status') : statusWords(live.status);
  }
}

function attachedCell(state: Readonly<Record<string, unknown>>): ReactNode {
  const lines = historyDetails(state);
  return lines.length === 0 ? (
    muted('Nothing recorded')
  ) : (
    <ul className="flex flex-col text-xs">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

/** The decisions a held inquiry allows now, each a button with a confirmation (C142.4). */
function DecisionButtons({
  caseId,
  inquiryId,
  status,
  action,
}: {
  readonly caseId: string;
  readonly inquiryId: string;
  readonly status: InquiryStatus;
  readonly action: Action;
}) {
  const decisions = inquiryActionsFor(status).filter(
    (each): each is 'approve' | 'decline' | 'mark-for-review' => each !== 'expire',
  );
  const words = {
    approve: ['Approve', 'Approve this inquiry?', 'primary'],
    decline: ['Decline', 'Decline this inquiry?', 'danger'],
    'mark-for-review': ['Mark for review', 'Mark this inquiry for review?', 'primary'],
  } as const;
  return (
    <span className="flex flex-wrap gap-2">
      {decisions.map((decision) => {
        const [label, title, tone] = words[decision];
        return (
          <ConfirmActionButton
            key={decision}
            label={label}
            accessibleLabel={`${label} ${inquiryId}`}
            variant="secondary"
            tone={tone}
            title={title}
            description="This decides the inquiry through its own route; resolving the case decides nothing. A decision cannot be undone here."
            confirmLabel={label}
            pendingLabel="Saving…"
            successMessage="The inquiry was decided."
            action={action}
            fields={{ 'case-id': caseId, 'inquiry-id': inquiryId, action: decision }}
          />
        );
      })}
    </span>
  );
}

/**
 * C136.3, C142.2: the held objects grouped by type, the state as attached beside the live state
 * read through each object's own route and scope. Holding grants nothing: an object the reader may
 * not read shows its id and "No access", with no link.
 */
export function HeldObjects({
  caseId,
  rows,
  shownKinds,
  canDecide,
  canEdit,
  decide,
  remove,
}: {
  readonly caseId: string;
  readonly rows: readonly HeldRow[];
  readonly shownKinds: ReadonlySet<CaseHeldObjectType>;
  readonly canDecide: boolean;
  readonly canEdit: boolean;
  readonly decide: Action;
  readonly remove: Action;
}) {
  const groups = HELD_GROUPS.filter((group) => shownKinds.has(group.type))
    .map((group) => ({
      ...group,
      rows: rows.filter((row) => row.held.attributes['object-type'] === group.type),
    }))
    .filter((group) => group.rows.length > 0);
  if (groups.length === 0) {
    return <p className="text-sm text-ink-muted">This case holds no object.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.type} className="flex flex-col gap-2">
          <h3 className="text-base font-semibold">
            {group.title} ({group.rows.length})
          </h3>
          <DataTable
            caption={group.caption}
            captionHidden
            rows={group.rows}
            emptyMessage="None held."
            getRowKey={(row) => row.held.id}
            columns={[
              {
                id: 'object',
                header: 'Object',
                rowHeader: true,
                cell: (row) =>
                  row.href === null ? (
                    code(row.held.attributes['object-id'])
                  ) : (
                    <Link href={row.href} className={`${LINK_CLASS} font-mono text-xs`}>
                      {row.held.attributes['object-id']}
                    </Link>
                  ),
              },
              {
                id: 'attached',
                header: 'As attached',
                cell: (row) => (
                  <span className="flex flex-col gap-1">
                    {attachedCell(row.held.attributes['attached-state'])}
                    <span className="text-xs text-ink-muted">
                      <Timestamp value={row.held.attributes['attached-at']} /> by{' '}
                      {code(row.held.attributes['attached-by-id'])}
                    </span>
                  </span>
                ),
              },
              { id: 'live', header: 'Now', cell: (row) => liveCell(row.live) },
              {
                id: 'actions',
                header: 'Actions',
                cell: (row) => (
                  <span className="flex flex-wrap gap-2">
                    {canDecide &&
                      group.type === 'inquiry' &&
                      row.live.kind === 'shown' &&
                      !row.live.redacted &&
                      row.live.status !== null && (
                        <DecisionButtons
                          caseId={caseId}
                          inquiryId={row.held.attributes['object-id']}
                          status={row.live.status as InquiryStatus}
                          action={decide}
                        />
                      )}
                    {canEdit && (
                      <ConfirmActionButton
                        label="Remove"
                        accessibleLabel={`Remove ${row.held.attributes['object-id']} from the case`}
                        variant="secondary"
                        title="Remove this object from the case?"
                        description="The object itself is not changed; the case only stops holding it."
                        confirmLabel="Remove"
                        pendingLabel="Removing…"
                        successMessage="The object was removed from the case."
                        action={remove}
                        fields={{
                          'case-id': caseId,
                          'object-id': row.held.attributes['object-id'],
                        }}
                      />
                    )}
                  </span>
                ),
              },
            ]}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * C131.4, C142.2: the timeline, newest first: each entry in words with who did it and when, and a
 * comment's words beside the entry that added it (as the API masked them).
 */
export function CaseTimeline({
  entries,
  statuses,
  comments,
  viewerId,
  people,
}: {
  readonly entries: readonly CaseHistoryEntryResource[];
  readonly statuses: readonly CaseStatusDefinitionResource[] | null;
  readonly comments: ReadonlyMap<string, CaseCommentResource>;
  readonly viewerId: string;
  readonly people: ReadonlyMap<string, string>;
}) {
  if (entries.length === 0) {
    return <p className="text-sm text-ink-muted">Nothing has happened to this case yet.</p>;
  }
  return (
    <ol
      aria-label="Case timeline"
      tabIndex={-1}
      data-shortcut-target="timeline"
      className="flex flex-col gap-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      {entries.map((entry) => {
        const { attributes } = entry;
        const commentId = attributes.to?.['comment-id'];
        const comment = typeof commentId === 'string' ? comments.get(commentId) : undefined;
        const details = [...historyDetails(attributes.from), ...historyDetails(attributes.to)];
        return (
          <li key={entry.id} className="flex flex-col gap-1 border-s-2 border-line ps-3">
            <span className="text-sm font-medium">{historySentence(entry, statuses)}</span>
            <span className="text-xs text-ink-muted">
              <Timestamp value={attributes['created-at']} /> by{' '}
              {attributes['actor-id'] === null ? (
                'the system'
              ) : (
                <>
                  {attributes['actor-type']} {personName(attributes['actor-id'], viewerId, people)}
                </>
              )}
            </span>
            {comment?.attributes.message != null && (
              <blockquote className="text-sm">
                <CommentText
                  message={comment.attributes.message}
                  viewerId={viewerId}
                  people={people}
                />
              </blockquote>
            )}
            {details.length > 0 && attributes.kind !== 'comment-added' && (
              <span className="text-xs text-ink-muted">{details.join('; ')}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * C134, C142.2: the comments, newest first, as plain text. A masked message reads "Hidden" and a
 * redacted one "Redacted"; the author or a holder of `cases:redact` can redact one.
 */
export function CaseComments({
  caseId,
  comments,
  viewerId,
  people,
  canRedactAny,
  canWrite,
  redact,
}: {
  readonly caseId: string;
  readonly comments: readonly CaseCommentResource[];
  readonly viewerId: string;
  readonly people: ReadonlyMap<string, string>;
  readonly canRedactAny: boolean;
  readonly canWrite: boolean;
  readonly redact: Action;
}) {
  if (comments.length === 0) {
    return <p className="text-sm text-ink-muted">No comment yet.</p>;
  }
  return (
    <ul aria-label="Comments, newest first" className="flex flex-col gap-3">
      {comments.map((comment) => {
        const { attributes } = comment;
        const heading = `comment-${comment.id}`;
        const redacted = attributes['redacted-at'] !== null;
        const mayRedact =
          canWrite && !redacted && (canRedactAny || attributes['commenter-id'] === viewerId);
        return (
          <li key={comment.id}>
            <article
              id={`comment-${comment.id}`}
              aria-labelledby={heading}
              className="flex flex-col gap-2 rounded-lg border border-line p-3"
            >
              <h3 id={heading} className="text-xs text-ink-muted">
                {personName(attributes['commenter-id'], viewerId, people)},{' '}
                <Timestamp value={attributes['created-at']} />{' '}
                <span className="sr-only">{comment.id}</span>
              </h3>
              <p className="text-sm">
                {redacted ? (
                  <RedactedValue />
                ) : attributes.message === null ? (
                  <HiddenValue />
                ) : (
                  <CommentText message={attributes.message} viewerId={viewerId} people={people} />
                )}
              </p>
              {mayRedact && (
                <div>
                  <ConfirmActionButton
                    label="Redact"
                    accessibleLabel={`Redact comment ${comment.id}`}
                    variant="secondary"
                    title="Redact this comment?"
                    description="Its words are removed for good; who wrote it and when stay."
                    confirmLabel="Redact comment"
                    pendingLabel="Redacting…"
                    successMessage="The comment was redacted."
                    action={redact}
                    fields={{ 'case-id': caseId, 'comment-id': comment.id }}
                  />
                </div>
              )}
            </article>
          </li>
        );
      })}
    </ul>
  );
}

/** The console route of an attachment's rendition page, through the console's own proxy. */
export const attachmentContentPath = (caseId: string, attachmentId: string, page: number) =>
  `/cases/${caseId}/attachments/${attachmentId}/content?page=${String(page)}`;

/**
 * C135, C142.2: the attachments with their type, size, scan and rendition state in words, and a
 * download of each rendition page (never the original, never a storage URL).
 */
export function CaseAttachments({
  caseId,
  attachments,
  masked,
}: {
  readonly caseId: string;
  readonly attachments: readonly CaseAttachment[];
  readonly masked: boolean;
}) {
  return (
    <DataTable
      caption="Attachments of this case"
      captionHidden
      rows={attachments}
      getRowKey={(attachment) => attachment.id}
      emptyMessage="No file is attached."
      columns={[
        {
          id: 'file',
          header: 'File',
          rowHeader: true,
          cell: (attachment) => (
            <span className="flex flex-col">
              {attachment.filename === null ? (
                masked ? (
                  <HiddenValue />
                ) : (
                  <RedactedValue />
                )
              ) : (
                <span className="break-all">{attachment.filename}</span>
              )}
              {code(attachment.id)}
            </span>
          ),
        },
        {
          id: 'type',
          header: 'Type',
          cell: (attachment) => attachment['attachment-type'].toUpperCase(),
        },
        { id: 'size', header: 'Size', cell: (attachment) => sizeWords(attachment['byte-size']) },
        { id: 'scan', header: 'Scan', cell: (attachment) => scanWords(attachment) },
        { id: 'rendition', header: 'Rendition', cell: (attachment) => renditionWords(attachment) },
        {
          id: 'download',
          header: 'Download',
          cell: (attachment) =>
            attachmentServed(attachment) ? (
              <span className="flex flex-wrap gap-2">
                {Array.from({ length: attachment['page-count'] ?? 1 }, (_unused, index) => (
                  <a
                    key={index}
                    href={attachmentContentPath(caseId, attachment.id, index + 1)}
                    download=""
                    className={LINK_CLASS}
                    aria-label={
                      (attachment['page-count'] ?? 1) > 1
                        ? `Download ${attachment.id}, page ${String(index + 1)}`
                        : `Download ${attachment.id}`
                    }
                  >
                    {(attachment['page-count'] ?? 1) > 1 ? `Page ${String(index + 1)}` : 'Download'}
                  </a>
                ))}
              </span>
            ) : (
              muted('Not served')
            ),
        },
      ]}
    />
  );
}
