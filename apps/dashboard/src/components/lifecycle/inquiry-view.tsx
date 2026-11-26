import type {
  DashboardInquiryDocument,
  DeviceResource,
  EventResource,
  FileResource,
  InquirySessionResource,
  ListMatchResource,
  NetworkResource,
  SelfieCaptureResource,
  VerificationResource,
} from '@openverify/contracts';
import { Alert } from '@openverify/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { Detail } from '../detail';
import { ForbiddenPanel } from '../forbidden-panel';
import { LINK_CLASS } from '../link-styles';
import { EmptyValue, MaskedValue } from '../masked-value';
import { PageHeader } from '../page-header';
import { PageMain } from '../page-main';
import { SelfieCaptures } from '../selfie-evidence';
import { InquirySignals } from '../signals/inquiry-signals';
import { ListMatches, ListScreening, screeningViewOf } from '../signals/list-matches';
import { InquiryStatusBadge } from '../status-badge';
import { Timestamp, formatUtc } from '../timestamp';
import { VerificationCard, verificationTitles } from '../verification-card';
import { FieldsEditor } from './fields-editor';
import { inquiryActionsFor, simulateActionsFor } from './inquiry-action-names';
import { InquiryActions } from './inquiry-actions';
import { InquirySessions } from './inquiry-sessions';
import { InquiryTimeline } from './inquiry-timeline';
import { NoteEditor } from './note-editor';
import { OneTimeLinkButton, type OneTimeLink } from './one-time-link-button';
import { OptionalSection, SlotSection } from './optional-section';
import { PageSection } from './page-section';
import { RedactedValue } from './redacted-value';
import type { SectionData } from './section-data';
import { LinkedReports, type LinkedReportList } from '../reports/linked-reports';
import { SimulateForm } from './simulate-form';
import { TagEditor } from './tag-editor';

type Action<Data = undefined> = (
  state: ActionState<Data>,
  formData: FormData,
) => Promise<ActionResult<Data>>;
type Included = DashboardInquiryDocument['included'][number];

/** What the operator may see and do on the inquiry page, from the session's permissions. */
export interface InquiryAbilities {
  /** `inquiries:write`. */
  readonly write: boolean;
  /** `inquiries:redact`. */
  readonly redact: boolean;
  /** `pii:view`: without it the API masks fields, the note and session addresses (C15). */
  readonly piiView: boolean;
  /** `verifications:read`, for the check details. */
  readonly verificationsRead: boolean;
  /** `accounts:read`, to link the account. */
  readonly accountsRead: boolean;
  /** `inquiry-templates:read`, to link the template and its pinned version. */
  readonly templatesRead: boolean;
  /** `inquiry-sessions:write`. */
  readonly sessionsWrite: boolean;
  /** The session works in the sandbox, where simulate actions exist. */
  readonly sandbox: boolean;
  /** `report-templates:read`, to link the reports' template versions (C86). */
  readonly reportTemplatesRead?: boolean;
  /** `lists:read`, to link the lists of the screening and the matches (C108). */
  readonly listsRead?: boolean;
  /** `lists:write`, to dismiss a list match (C99.3). */
  readonly listsWrite?: boolean;
  /** `devices:write`, to trust a session's device (C127.9). */
  readonly devicesWrite?: boolean;
}

/** The server actions the page's controls run. */
export interface InquiryPageActions {
  readonly transition: Action;
  readonly redact: Action;
  readonly addTag: Action;
  readonly removeTag: Action;
  readonly setTags: Action;
  readonly updateNote: Action;
  readonly updateFields: Action;
  readonly generateLink: Action<OneTimeLink>;
  readonly expireSession: Action;
  readonly expireAllSessions: Action<{ expiredCount: number }>;
  readonly simulate: Action;
  /** C99.3: dismisses one list match with a reason. */
  readonly dismissListMatch?: Action;
  /** C127.9: trusts a session's device, or removes the mark. */
  readonly trustDevice?: Action;
}

export interface InquiryTimelineData {
  readonly events: readonly EventResource[];
  readonly nextCursor: string | null;
}

export interface InquirySessionsData {
  readonly sessions: readonly InquirySessionResource[];
  readonly included: readonly (DeviceResource | NetworkResource)[];
}

export interface InquiryViewProps {
  readonly document: DashboardInquiryDocument;
  readonly abilities: InquiryAbilities;
  readonly actions: InquiryPageActions;
  /** With `inquiry-sessions:read`: the sessions, with their devices and networks (C108). */
  readonly sessions: SectionData<InquirySessionsData>;
  /** With `events:read`. */
  readonly timeline: SectionData<InquiryTimelineData>;
  /** The timeline's cursor (`?events-after=`). */
  readonly timelineAfter?: string | undefined;
  /** With `reports:read` (C86): the inquiry's reports. */
  readonly reports?: SectionData<LinkedReportList> | undefined;
  /** With `lists:read` (C108): the inquiry's list matches, newest first. */
  readonly listMatches?: SectionData<readonly ListMatchResource[]> | undefined;
  /**
   * C128.1, C142.4 (F32): what `InquiryDecisionsSection` renders, the decision records and the
   * reopen action.
   */
  readonly decisions?: SectionData<ReactNode> | undefined;
  /** C242.3, C242.4 (Workflow 11A): the Connect slot (`ObjectConnectSection`). */
  readonly connect?: SectionData<ReactNode> | undefined;
  /** C173.3: the page's Print button and its printed footer. */
  readonly print?: { readonly button: ReactNode; readonly footer: ReactNode } | undefined;
}

// The document also includes files and, since Phase 4, the selfie captures (C40.1).
const isVerification = (resource: Included): resource is VerificationResource =>
  resource.type.startsWith('verification/');
const isFile = (resource: Included): resource is FileResource => resource.type === 'file';
const isCapture = (resource: Included): resource is SelfieCaptureResource =>
  resource.type === 'selfie';

/** Newest first, as the inquiry's `selfies` relationship lists them (C40.1). */
const newestFirst = (a: SelfieCaptureResource, b: SelfieCaptureResource) =>
  b.attributes['created-at'].localeCompare(a.attributes['created-at']) || b.id.localeCompare(a.id);

const SECONDS = new Intl.NumberFormat('en-US');

/**
 * An inquiry's own expiry window in words (C151.10): hours or minutes beside the seconds the API
 * stored; `null` or absent is the template version's window, never "0".
 */
export function windowWords(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) {
    return 'The template’s default';
  }
  const unit =
    seconds % 3_600 === 0
      ? `${SECONDS.format(seconds / 3_600)} ${seconds === 3_600 ? 'hour' : 'hours'}`
      : seconds % 60 === 0
        ? `${SECONDS.format(seconds / 60)} ${seconds === 60 ? 'minute' : 'minutes'}`
        : null;
  const raw = `${SECONDS.format(seconds)} seconds`;
  return unit === null ? raw : `${unit} (${raw})`;
}

const code = (value: string) => <code className="font-mono text-xs break-all">{value}</code>;

function linkedId(value: string, href: string, linked: boolean) {
  return linked ? (
    <Link href={href} className={LINK_CLASS}>
      {code(value)}
    </Link>
  ) : (
    code(value)
  );
}

const time = (value: string | null | undefined) =>
  value === null || value === undefined ? <EmptyValue /> : <Timestamp value={value} />;

/** The matches part of the List matches section: with `lists:read`, else why not. */
function ListMatchesPart({
  data,
  inquiryId,
  abilities,
  dismiss,
}: {
  readonly data: SectionData<readonly ListMatchResource[]> | undefined;
  readonly inquiryId: string;
  readonly abilities: InquiryAbilities;
  readonly dismiss: Action | undefined;
}) {
  if (data === undefined || data.kind === 'hidden') {
    return (
      <p className="text-sm text-ink-muted">
        Viewing the matches needs the <code className="font-mono text-xs">lists:read</code>{' '}
        permission.
      </p>
    );
  }
  if (data.kind === 'forbidden') {
    return <ForbiddenPanel headingLevel={3} />;
  }
  return (
    <ListMatches
      matches={data.data}
      piiView={abilities.piiView}
      listsLinked={abilities.listsRead === true}
      canDismiss={abilities.listsWrite === true && dismiss !== undefined}
      dismiss={dismiss ?? NO_ACTION}
      revalidate={{ 'inquiry-id': inquiryId }}
    />
  );
}

const NO_ACTION: Action = () =>
  Promise.resolve({ ok: false, problem: { title: 'Not available', detail: 'No action.' } });

/**
 * Why no verification is shown: there is none yet, or (Workflow 2D K001) the API listed only
 * their ids because the operator lacks `verifications:read`.
 */
function VerificationsAbsent({ count, readable }: { count: number; readable: boolean }) {
  if (readable || count === 0) {
    return <p className="text-sm text-ink-muted">No verifications yet.</p>;
  }
  return (
    <p className="text-sm text-ink-muted">
      This inquiry has {count} {count === 1 ? 'verification' : 'verifications'}. Viewing them needs
      the <code className="font-mono text-xs">verifications:read</code> permission.
    </p>
  );
}

/**
 * The inquiry's selfie captures (C40.1, C47), newest first, each with its verification, status
 * and why it was not used; without `verifications:read` the API lists only their ids.
 */
function SelfieCapturesSection({
  count,
  captures,
  linkVerifications,
}: {
  readonly count: number;
  readonly captures: readonly SelfieCaptureResource[];
  readonly linkVerifications: boolean;
}) {
  if (count === 0 && captures.length === 0) {
    return null;
  }
  return (
    <PageSection
      id="inquiry-selfie-captures"
      title="Selfie captures"
      description="Each camera or upload session of a selfie. Only the submitted one is checked; the others say why they were not used."
    >
      {captures.length === 0 ? (
        <p className="text-sm text-ink-muted">
          This inquiry has {count} selfie {count === 1 ? 'capture' : 'captures'}. Viewing them needs
          the <code className="font-mono text-xs">verifications:read</code> permission.
        </p>
      ) : (
        <SelfieCaptures
          caption="Inquiry selfie captures"
          captures={[...captures].sort(newestFirst)}
          verificationColumn={linkVerifications ? 'linked' : 'plain'}
        />
      )}
    </PageSection>
  );
}

/**
 * One inquiry (C10, C23): its decisions and redaction, details, fields, tags, note, one-time
 * link, sessions, verifications, timeline and sandbox simulation, each with the permission it
 * needs. Values the API masked show as "Hidden"; a redacted inquiry shows what was removed as
 * "Redacted".
 */
export function InquiryView({
  document,
  abilities,
  actions,
  sessions,
  timeline,
  timelineAfter,
  reports,
  listMatches,
  decisions,
  connect,
  print,
}: InquiryViewProps) {
  const { data: inquiry, included } = document;
  const { attributes } = inquiry;
  const redactedAt = attributes['redacted-at'] ?? null;
  const redacted = redactedAt !== null;
  const open = attributes.status === 'created' || attributes.status === 'pending';
  const verifications = included.filter(isVerification);
  const titles = verificationTitles(verifications);
  const files = included.filter(isFile);
  const captures = included.filter(isCapture);
  const fields = Object.entries(attributes.fields);
  const templateId = inquiry.relationships['inquiry-template'].data.id;
  // C25.4: the version pinned at creation; absent from answers older than Workflow 2E.
  const versionId = inquiry.relationships['inquiry-template-version']?.data.id ?? null;
  const accountId = inquiry.relationships.account?.data?.id ?? null;
  const media = redacted ? 'redacted' : abilities.piiView ? 'visible' : 'hidden';
  const idField = { 'inquiry-id': inquiry.id };
  const simulateActions =
    abilities.sandbox && abilities.write ? simulateActionsFor(attributes.status) : [];

  return (
    <PageMain className="gap-8">
      <PageHeader
        breadcrumbs={[{ label: 'Inquiries', href: '/inquiries' }, { label: code(inquiry.id) }]}
        title={<>Inquiry {code(inquiry.id)}</>}
        description={<InquiryStatusBadge status={attributes.status} />}
        actions={
          <div className="flex flex-wrap items-start gap-3">
            {print?.button}
            <InquiryActions
              inquiryId={inquiry.id}
              actions={abilities.write ? inquiryActionsFor(attributes.status) : []}
              canRedact={abilities.redact && !redacted}
              transition={actions.transition}
              redact={actions.redact}
            />
          </div>
        }
      />

      {redacted && (
        <Alert tone="info" title="Redacted" aria-label="Redacted">
          This inquiry was redacted on {formatUtc(redactedAt)} UTC. Its fields, note, files and
          check details were deleted for good.
        </Alert>
      )}

      <SlotSection id="inquiry-connect" title="Connect" data={connect} />

      <SlotSection id="inquiry-decisions" title="Decision records" data={decisions} />

      <PageSection id="inquiry-details" title="Details">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Detail term="Reference ID">{attributes['reference-id'] ?? <EmptyValue />}</Detail>
          <Detail term="Template">
            {linkedId(templateId, `/templates/${templateId}`, abilities.templatesRead)}
          </Detail>
          <Detail term="Template version">
            {versionId === null ? (
              <EmptyValue />
            ) : (
              linkedId(
                versionId,
                `/templates/${templateId}/versions/${versionId}`,
                abilities.templatesRead,
              )
            )}
          </Detail>
          <Detail term="Account">
            {accountId === null ? (
              <EmptyValue />
            ) : (
              linkedId(accountId, `/accounts/${accountId}`, abilities.accountsRead)
            )}
          </Detail>
          <Detail term="Created (UTC)">{time(attributes['created-at'])}</Detail>
          <Detail term="Updated (UTC)">{time(attributes['updated-at'])}</Detail>
          <Detail term="Expires (UTC)">{time(attributes['expires-at'])}</Detail>
          {/* C151.10: the inquiry's own windows; an unset one is its template version's. */}
          <Detail term="Expires after start">
            {windowWords(attributes['expiration-after-start-interval-seconds'])}
          </Detail>
          <Detail term="Expires after resume">
            {windowWords(attributes['expiration-after-resume-interval-seconds'])}
          </Detail>
          <Detail term="One-time link lifetime">
            {windowWords(attributes['one-time-link-expiration-seconds'])}
          </Detail>
          <Detail term="Decided (UTC)">{time(attributes['decisioned-at'])}</Detail>
          <Detail term="Redacted (UTC)">{time(redactedAt)}</Detail>
        </dl>
      </PageSection>

      <PageSection id="inquiry-fields" title="Fields">
        {redacted ? (
          <p>
            <RedactedValue />
          </p>
        ) : fields.length === 0 ? (
          <p className="text-sm text-ink-muted">No fields.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {fields.map(([name, value]) => (
              <Detail key={name} term={<code className="font-mono">{name}</code>}>
                <MaskedValue value={value} masked={!abilities.piiView} />
              </Detail>
            ))}
          </dl>
        )}
        {!redacted && open && abilities.write && abilities.piiView && (
          <div>
            <FieldsEditor
              fields={attributes.fields}
              hiddenFields={idField}
              description="The fields you send are merged into the inquiry's; set a field to null to clear it. Fields change only until the end user finishes."
              action={actions.updateFields}
            />
          </div>
        )}
      </PageSection>

      <PageSection id="inquiry-tags" title="Tags">
        <TagEditor
          tags={attributes.tags ?? []}
          fields={idField}
          canEdit={abilities.write}
          addTag={actions.addTag}
          removeTag={actions.removeTag}
          setTags={actions.setTags}
        />
      </PageSection>

      <PageSection id="inquiry-note" title="Note">
        <NoteEditor
          inquiryId={inquiry.id}
          note={attributes.note ?? null}
          state={redacted ? 'redacted' : abilities.piiView ? 'visible' : 'hidden'}
          canEdit={!redacted && abilities.write && abilities.piiView}
          action={actions.updateNote}
        />
      </PageSection>

      {!redacted && open && abilities.write && (
        <PageSection
          id="inquiry-one-time-link"
          title="One-time link"
          description="Send the end user a single-use link to the hosted flow."
        >
          <div>
            <OneTimeLinkButton inquiryId={inquiry.id} action={actions.generateLink} />
          </div>
        </PageSection>
      )}

      <OptionalSection id="inquiry-sessions" title="Sessions" data={sessions}>
        {(items) => (
          <InquirySessions
            inquiryId={inquiry.id}
            sessions={items.sessions}
            included={items.included}
            masked={!abilities.piiView}
            canExpire={abilities.sessionsWrite}
            expire={actions.expireSession}
            expireAll={actions.expireAllSessions}
            {...(abilities.devicesWrite === true && actions.trustDevice !== undefined
              ? { trustDevice: actions.trustDevice }
              : {})}
          />
        )}
      </OptionalSection>

      <PageSection
        id="inquiry-signals"
        title="Signals"
        description="What the API recorded about the sessions, the network, the behaviour and the lists. A signal decides nothing: it can only send the inquiry to review by a template rule."
      >
        <InquirySignals signals={attributes.signals} details={attributes['signal-details']} />
      </PageSection>

      <PageSection id="inquiry-list-matches" title="List matches">
        <ListScreening
          view={screeningViewOf(attributes['signal-details'], attributes.signals)}
          listsLinked={abilities.listsRead === true}
        />
        <ListMatchesPart
          data={listMatches}
          inquiryId={inquiry.id}
          abilities={abilities}
          dismiss={actions.dismissListMatch}
        />
      </PageSection>

      <PageSection id="inquiry-verifications" title="Verifications">
        {verifications.length === 0 ? (
          <VerificationsAbsent
            count={inquiry.relationships.verifications.data.length}
            readable={abilities.verificationsRead}
          />
        ) : (
          verifications.map((verification) => (
            <VerificationCard
              key={verification.id}
              verification={verification}
              title={titles.get(verification.id)}
              files={files.filter(
                (file) => file.relationships.verification.data.id === verification.id,
              )}
              media={media}
              showChecks={abilities.verificationsRead}
              linked
              captures={captures}
              referenceFiles={files}
            />
          ))
        )}
      </PageSection>

      <SelfieCapturesSection
        count={inquiry.relationships.selfies?.data.length ?? 0}
        captures={captures}
        linkVerifications={abilities.verificationsRead}
      />

      <LinkedReports
        subject={{ kind: 'inquiry', id: inquiry.id }}
        data={reports}
        linkTemplates={abilities.reportTemplatesRead === true}
      />

      <OptionalSection id="inquiry-timeline" title="Timeline" data={timeline}>
        {(data) => (
          <InquiryTimeline
            inquiryId={inquiry.id}
            events={data.events}
            after={timelineAfter}
            nextCursor={data.nextCursor}
            linkVerifications={abilities.verificationsRead}
          />
        )}
      </OptionalSection>

      {simulateActions.length > 0 && (
        <PageSection
          id="inquiry-simulate"
          title="Sandbox simulation"
          description="Move this test inquiry through its lifecycle without an end user. Only the sandbox allows it."
        >
          <SimulateForm
            inquiryId={inquiry.id}
            actions={simulateActions}
            action={actions.simulate}
          />
        </PageSection>
      )}
      {print?.footer}
    </PageMain>
  );
}
