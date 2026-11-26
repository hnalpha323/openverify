import type {
  AccountRelation,
  AccountResource,
  AccountTypeResource,
  InquiryResource,
  ListMatchResource,
} from '@openverify/contracts';
import { Alert } from '@openverify/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ConfirmActionButton } from '../confirm-action-button';
import { Detail } from '../detail';
import { LINK_CLASS } from '../link-styles';
import { EmptyValue, MaskedValue } from '../masked-value';
import { PageHeader } from '../page-header';
import { PageMain } from '../page-main';
import { Timestamp, formatUtc } from '../timestamp';
import { AccountInquiries, type AccountInquiryList } from './account-inquiries';
import { AccountRelations } from './account-relations';
import { AccountStatusBadge } from './badges';
import { ConsolidateButton } from './consolidate-button';
import { FieldsEditor } from './fields-editor';
import { REDACT_PHRASE } from './inquiry-action-names';
import { LinkedReports, type LinkedReportList } from '../reports/linked-reports';
import { OptionalSection, SlotSection } from './optional-section';
import { PageSection } from './page-section';
import type { SectionData } from './section-data';
import { RedactedValue } from './redacted-value';
import { TagEditor } from './tag-editor';
import { TypedConfirmButton } from './typed-confirm-button';
import { AccountSignals } from '../signals/account-signals';
import { ListMatches } from '../signals/list-matches';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

export interface AccountAbilities {
  /** `accounts:write`. */
  readonly write: boolean;
  /** `accounts:redact`. */
  readonly redact: boolean;
  /** `pii:view`: without it the API masks the field values (C15). */
  readonly piiView: boolean;
  /** `report-templates:read`, to link the reports' template versions (C86). */
  readonly reportTemplatesRead?: boolean;
  /** `lists:read`, to link the lists of the matches (C108). */
  readonly listsRead?: boolean;
  /** `lists:write`, to dismiss a list match (C99.3). */
  readonly listsWrite?: boolean;
}

export interface AccountPageActions {
  readonly updateStatus: Action;
  readonly addTag: Action;
  readonly removeTag: Action;
  readonly setTags: Action;
  readonly updateFields: Action;
  readonly addRelation: Action;
  readonly removeRelation: Action;
  readonly consolidate: Action;
  readonly addInquiries: Action;
  readonly removeInquiry: Action;
  readonly redact: Action;
  /** C99.3: dismisses one list match with a reason. */
  readonly dismissListMatch?: Action;
}

export interface AccountViewProps {
  readonly account: AccountResource;
  readonly accountType: AccountTypeResource;
  readonly relations: readonly AccountRelation[];
  readonly inquiries: AccountInquiryList;
  readonly inquiriesAfter?: string | undefined;
  /** With `reports:read` (C86): the account's reports, as home or linked account. */
  readonly reports?: SectionData<LinkedReportList> | undefined;
  /** With `inquiries:read` (C108): the account's latest inquiries, for their signals. */
  readonly signals?: SectionData<readonly InquiryResource[]> | undefined;
  /** With `lists:read` (C108): the account's list matches, newest first. */
  readonly listMatches?: SectionData<readonly ListMatchResource[]> | undefined;
  /** With `graph:read` (C108, F32): what `dashboard-graph`'s `AccountGraphSection` renders. */
  readonly graph?: SectionData<ReactNode> | undefined;
  /**
   * With `transactions:read` (C108, F32): what `dashboard-lists-transactions`'
   * `AccountTransactionsSection` renders.
   */
  readonly transactions?: SectionData<ReactNode> | undefined;
  /** C242.3 (Workflow 11A): the Connect slot (`ObjectConnectSection`). */
  readonly connect?: SectionData<ReactNode> | undefined;
  /**
   * With `workflows:trigger` (C118.7, C141.7, F32): what `AccountActionsSection` renders, the
   * account actions the principal may run.
   */
  readonly workflowActions?: SectionData<ReactNode> | undefined;
  readonly abilities: AccountAbilities;
  readonly actions: AccountPageActions;
}

const NO_ACTION: Action = () =>
  Promise.resolve({ ok: false, problem: { title: 'Not available', detail: 'No action.' } });

const code = (value: string) => <code className="font-mono text-xs break-all">{value}</code>;

/**
 * One account (C13, C23): status, details, fields labelled by its type, tags, relations and
 * inquiries, with archive and restore, consolidation and redaction for the roles that may.
 */
export function AccountView({
  account,
  accountType,
  relations,
  inquiries,
  inquiriesAfter,
  reports,
  signals,
  listMatches,
  graph,
  transactions,
  connect,
  workflowActions,
  abilities,
  actions,
}: AccountViewProps) {
  const { attributes } = account;
  const redactedAt = attributes['redacted-at'];
  const redacted = redactedAt !== null;
  const active = attributes.status === 'active';
  const consolidatedInto = attributes['consolidated-into'];
  const schema = accountType.attributes['fields-schema'];
  const fields = Object.entries(attributes.fields);
  const idField = { 'account-id': account.id };
  const showActions = abilities.write || (abilities.redact && !redacted);

  return (
    <PageMain className="gap-8">
      <PageHeader
        breadcrumbs={[{ label: 'Accounts', href: '/accounts' }, { label: code(account.id) }]}
        title={<>Account {code(account.id)}</>}
        description={<AccountStatusBadge status={attributes.status} />}
        actions={
          showActions ? (
            <div role="group" aria-label="Account actions" className="flex flex-wrap gap-3">
              {abilities.write && (
                <ConfirmActionButton
                  label={active ? 'Archive' : 'Restore'}
                  variant="secondary"
                  tone="primary"
                  title={active ? 'Archive this account?' : 'Restore this account?'}
                  description={
                    active
                      ? 'It stays readable with its inquiries, and can be restored at any time.'
                      : 'It becomes active again.'
                  }
                  confirmLabel={active ? 'Archive account' : 'Restore account'}
                  action={actions.updateStatus}
                  fields={{ ...idField, status: active ? 'archived' : 'active' }}
                  successMessage={
                    active ? 'The account was archived.' : 'The account was restored.'
                  }
                />
              )}
              {abilities.write && active && (
                <ConsolidateButton accountId={account.id} action={actions.consolidate} />
              )}
              {abilities.redact && !redacted && (
                <TypedConfirmButton
                  label="Redact"
                  title="Redact this account?"
                  description="Its fields, the personal data and files of its inquiries, and those of every account consolidated into it are deleted for good. This cannot be undone."
                  phrase={REDACT_PHRASE}
                  confirmLabel="Redact account"
                  pendingLabel="Redacting…"
                  action={actions.redact}
                  fields={idField}
                  successMessage="The account was redacted."
                />
              )}
            </div>
          ) : undefined
        }
      />

      {consolidatedInto !== null && (
        <Alert tone="info" title="Consolidated" aria-label="Consolidated">
          This account was consolidated into{' '}
          <Link href={`/accounts/${consolidatedInto}`} className={LINK_CLASS}>
            {code(consolidatedInto)}
          </Link>
          . Its inquiries moved there.
        </Alert>
      )}
      {redacted && (
        <Alert tone="info" title="Redacted" aria-label="Redacted">
          This account was redacted on {formatUtc(redactedAt)} UTC. Its fields and the personal data
          and files of its inquiries were deleted for good.
        </Alert>
      )}

      <SlotSection id="account-workflow-actions" title="Workflow actions" data={workflowActions} />

      <PageSection id="account-details" title="Details">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Detail term="Reference ID">{attributes['reference-id'] ?? <EmptyValue />}</Detail>
          <Detail term="Type">
            <Link href="/account-types" className={LINK_CLASS}>
              {accountType.attributes.name}
            </Link>
          </Detail>
          <Detail term="Created (UTC)">
            <Timestamp value={attributes['created-at']} />
          </Detail>
          <Detail term="Updated (UTC)">
            <Timestamp value={attributes['updated-at']} />
          </Detail>
          <Detail term="Redacted (UTC)">
            {redactedAt === null ? <EmptyValue /> : <Timestamp value={redactedAt} />}
          </Detail>
        </dl>
      </PageSection>

      <PageSection id="account-fields" title="Fields">
        {redacted ? (
          <p>
            <RedactedValue />
          </p>
        ) : fields.length === 0 ? (
          <p className="text-sm text-ink-muted">No fields.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {fields.map(([key, value]) => (
              <Detail
                key={key}
                term={
                  <span className="flex flex-col">
                    <span>{Object.hasOwn(schema, key) ? schema[key]?.label : key}</span>
                    <code className="font-mono text-xs font-normal">{key}</code>
                  </span>
                }
              >
                <MaskedValue value={value} masked={!abilities.piiView} />
              </Detail>
            ))}
          </dl>
        )}
        {!redacted && abilities.write && abilities.piiView && (
          <div>
            <FieldsEditor
              fields={attributes.fields}
              hiddenFields={idField}
              description="The fields you send are merged into the account's and must match its type; set a field to null to clear it."
              action={actions.updateFields}
            />
          </div>
        )}
      </PageSection>

      <PageSection id="account-tags" title="Tags">
        <TagEditor
          tags={attributes.tags}
          fields={idField}
          canEdit={abilities.write}
          addTag={actions.addTag}
          removeTag={actions.removeTag}
          setTags={actions.setTags}
        />
      </PageSection>

      <PageSection id="account-relations" title="Relations">
        <AccountRelations
          accountId={account.id}
          relations={relations}
          canEdit={abilities.write}
          add={actions.addRelation}
          remove={actions.removeRelation}
        />
      </PageSection>

      <PageSection id="account-inquiries" title="Inquiries">
        <AccountInquiries
          accountId={account.id}
          inquiries={inquiries}
          canEdit={abilities.write}
          after={inquiriesAfter}
          add={actions.addInquiries}
          remove={actions.removeInquiry}
        />
      </PageSection>

      <LinkedReports
        subject={{ kind: 'account', id: account.id }}
        data={reports}
        linkTemplates={abilities.reportTemplatesRead === true}
      />

      <OptionalSection
        id="account-signals"
        title="Signals"
        description="What the API recorded on the account's latest inquiries. A signal decides nothing."
        data={signals}
      >
        {(inquiries) => <AccountSignals inquiries={inquiries} />}
      </OptionalSection>

      <OptionalSection id="account-list-matches" title="List matches" data={listMatches}>
        {(matches) => (
          <ListMatches
            matches={matches}
            piiView={abilities.piiView}
            listsLinked={abilities.listsRead === true}
            canDismiss={abilities.listsWrite === true && actions.dismissListMatch !== undefined}
            dismiss={actions.dismissListMatch ?? NO_ACTION}
            revalidate={{ 'account-id': account.id }}
            caption="List matches of this account"
            emptyMessage="No list match for this account."
          />
        )}
      </OptionalSection>

      <SlotSection id="account-graph" title="Graph" data={graph} />

      <SlotSection id="account-transactions" title="Transactions" data={transactions} />

      <SlotSection id="account-connect" title="Connect" data={connect} />
    </PageMain>
  );
}
