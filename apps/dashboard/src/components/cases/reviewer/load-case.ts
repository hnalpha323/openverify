/**
 * The case page's reads (C142.2): the case and its pinned version, its timeline, comments and held
 * objects, and each module's data, every one through its own route and only with the scope that
 * route needs. A read the API refuses (403) leaves its part forbidden, never the whole page. What is
 * read is what the API returned, masked as it masked it: nothing is unmasked here.
 */
import 'server-only';
import { OpenVerifyApiError, type OpenVerifyClient } from '@openverify/node';
import type {
  AccountGraphComponentResource,
  CaseAvailableActionListDocument,
  CaseChecklistStateDocument,
  CaseCommentResource,
  CaseHeldObjectResource,
  CaseHistoryEntryResource,
  CaseResource,
  CaseTemplateResource,
  CaseTemplateVersionResource,
  DashboardInquiryDocument,
  DeviceResource,
  InquirySessionResource,
  ListMatchResource,
  NetworkResource,
  TransactionLabelListDocument,
  TransactionRelationListDocument,
  TransactionStatusChangeListDocument,
} from '@openverify/contracts';
import type { CaseHeldObjectType, CaseLayoutModule, Permission } from '@openverify/core';
import { getCaseChecklist } from '../../../lib/api/case-checklists';
import { getInquiry } from '../../../lib/api/inquiries';
import type { DashboardSession } from '../../../lib/api/me';
import { userDirectory } from '../../../lib/api/users';
import { loadSection, type SectionData } from '../../lifecycle/section-data';

/** C142.2: the layout the API serves when a version names none, read when the version cannot be. */
export const DEFAULT_MODULES: readonly {
  readonly key: CaseLayoutModule;
  readonly 'required-permissions': readonly Permission[];
}[] = Object.freeze([
  { key: 'held-objects', 'required-permissions': ['cases:read'] },
  { key: 'reports', 'required-permissions': ['reports:read'] },
  { key: 'report-runs', 'required-permissions': ['reports:read'] },
  { key: 'transactions', 'required-permissions': ['transactions:read'] },
  { key: 'list-matches', 'required-permissions': ['lists:read'] },
  { key: 'graph', 'required-permissions': ['graph:read'] },
  { key: 'signals', 'required-permissions': ['inquiries:read'] },
  { key: 'device', 'required-permissions': ['inquiry-sessions:read'] },
  { key: 'location', 'required-permissions': ['inquiry-sessions:read'] },
  { key: 'timeline', 'required-permissions': ['cases:read'] },
  { key: 'comments', 'required-permissions': ['cases:read'] },
  { key: 'attachments', 'required-permissions': ['cases:read', 'pii:view'] },
  { key: 'case-actions', 'required-permissions': ['workflows:trigger'] },
]);

/** Held objects read per page, and live reads per kind (each is one API call). */
export const HELD_PAGE_SIZE = 100;
export const LIVE_READS_PER_KIND = 10;
export const TIMELINE_PAGE_SIZE = 50;
export const COMMENTS_PAGE_SIZE = 50;

/** Each held kind's own page and the scope its read needs (C136.3: holding grants nothing). */
export const HELD_KINDS: Readonly<
  Record<CaseHeldObjectType, { readonly scope: Permission; readonly page: string | null }>
> = Object.freeze({
  inquiry: { scope: 'inquiries:read', page: '/inquiries' },
  account: { scope: 'accounts:read', page: '/accounts' },
  report: { scope: 'reports:read', page: '/reports' },
  // A report run has no page of its own; its report has.
  'report-run': { scope: 'reports:read', page: null },
  transaction: { scope: 'transactions:read', page: '/transactions' },
  verification: { scope: 'verifications:read', page: '/verifications' },
  document: { scope: 'verifications:read', page: '/verifications' },
  'graph-query': { scope: 'graph:read', page: '/graph' },
});

/** What the live read of a held object found. */
export type LiveState =
  | { readonly kind: 'shown'; readonly status: string | null; readonly redacted: boolean }
  | { readonly kind: 'no-access' }
  | { readonly kind: 'gone' }
  | { readonly kind: 'not-read' };

export interface HeldRow {
  readonly held: CaseHeldObjectResource;
  readonly live: LiveState;
  /** The object's console page, when the reader holds its read scope. */
  readonly href: string | null;
}

export interface CaseModulesData {
  readonly inquiry: DashboardInquiryDocument | null;
  readonly listMatches: SectionData<readonly ListMatchResource[]> | undefined;
  readonly graph: SectionData<AccountGraphComponentResource> | undefined;
  readonly sessions:
    | SectionData<{
        readonly sessions: readonly InquirySessionResource[];
        readonly included: readonly (DeviceResource | NetworkResource)[];
      }>
    | undefined;
  readonly transaction:
    | SectionData<{
        readonly id: string;
        readonly redacted: boolean;
        readonly statusChanges: TransactionStatusChangeListDocument;
        readonly labels: TransactionLabelListDocument;
        readonly relations: TransactionRelationListDocument;
      }>
    | undefined;
}

export interface CasePageData {
  readonly resource: CaseResource;
  readonly template: CaseTemplateResource | null;
  readonly version: SectionData<CaseTemplateVersionResource>;
  readonly modules: ReadonlySet<CaseLayoutModule>;
  readonly history: SectionData<readonly CaseHistoryEntryResource[]>;
  readonly comments: SectionData<readonly CaseCommentResource[]>;
  readonly held: SectionData<readonly HeldRow[]>;
  readonly queueName: string | null;
  readonly queueMembers: readonly string[];
  readonly queues: readonly { readonly id: string; readonly label: string }[] | null;
  readonly people: ReadonlyMap<string, string>;
  readonly actions: SectionData<CaseAvailableActionListDocument> | undefined;
  readonly live: CaseModulesData;
  /** C172.2: the checklist state, read only when the pinned version has a checklist. */
  readonly checklist?: SectionData<CaseChecklistStateDocument> | undefined;
}

const statusOf = (attributes: Record<string, unknown>): string | null =>
  typeof attributes.status === 'string' ? attributes.status : null;

const redactedOf = (attributes: Record<string, unknown>): boolean =>
  typeof attributes['redacted-at'] === 'string';

/** One object's live state through its own route; a refusal is "no access", never an error. */
async function readLive(
  api: OpenVerifyClient,
  type: CaseHeldObjectType,
  id: string,
  inquiries: Map<string, DashboardInquiryDocument>,
): Promise<LiveState> {
  try {
    let attributes: Record<string, unknown>;
    switch (type) {
      case 'inquiry': {
        const document = await getInquiry(id);
        inquiries.set(id, document);
        attributes = document.data.attributes;
        break;
      }
      case 'account':
        attributes = (await api.accounts.retrieve(id)).data.attributes;
        break;
      case 'report':
        attributes = (await api.reports.retrieve(id)).data.attributes;
        break;
      case 'transaction':
        attributes = (await api.transactions.retrieve(id)).data.attributes;
        break;
      case 'verification':
      case 'document':
        attributes = (await api.verifications.retrieve(id)).data.attributes;
        break;
      case 'graph-query':
        attributes = (await api.graphQueries.retrieve(id)).data.attributes;
        break;
      case 'report-run':
        return { kind: 'not-read' };
    }
    return { kind: 'shown', status: statusOf(attributes), redacted: redactedOf(attributes) };
  } catch (error) {
    if (error instanceof OpenVerifyApiError) {
      if (error.status === 403) return { kind: 'no-access' };
      if (error.status === 404) return { kind: 'gone' };
      if (error.status === 410) return { kind: 'shown', status: null, redacted: true };
    }
    throw error;
  }
}

/**
 * The modules a reader sees: the version's (or the default) modules, by their permissions, and,
 * when the version has a layout (C172.1), only those the layout places.
 */
function visibleModules(
  version: SectionData<CaseTemplateVersionResource>,
  session: DashboardSession,
): {
  readonly permitted: ReadonlySet<CaseLayoutModule>;
  readonly shown: ReadonlySet<CaseLayoutModule>;
} {
  const offered =
    version.kind === 'ready' ? version.data.attributes['layout-modules'] : DEFAULT_MODULES;
  const layout = version.kind === 'ready' ? (version.data.attributes.layout ?? null) : null;
  const permitted = new Set(
    offered
      .filter((module) =>
        module['required-permissions'].every((permission) => session.permissions.has(permission)),
      )
      .map((module) => module.key),
  );
  if (layout === null) {
    return { permitted, shown: permitted };
  }
  const placed = new Set(layout.modules.map((module) => module.key));
  return { permitted, shown: new Set([...permitted].filter((key) => placed.has(key))) };
}

/** Everything the case page shows, read at once where nothing depends on another read. */
export async function loadCase(
  api: OpenVerifyClient,
  session: DashboardSession,
  id: string,
): Promise<CasePageData> {
  const can = (permission: Permission) => session.permissions.has(permission);
  const document = await api.cases.retrieve(
    id,
    can('case-templates:read') ? { include: 'case-template' } : undefined,
  );
  const resource = document.data;
  const template =
    document.included?.find(
      (included): included is CaseTemplateResource => included.type === 'case-template',
    ) ?? null;
  const versionId = resource.relationships['case-template-version'].data.id;
  const queueId = resource.relationships['case-queue'].data?.id ?? null;
  const version = await loadSection(
    can('case-templates:read'),
    async () => (await api.caseTemplateVersions.retrieve(versionId)).data,
  );
  const { permitted, shown: modules } = visibleModules(version, session);
  const show = (module: CaseLayoutModule) => modules.has(module);
  const inquiries = new Map<string, DashboardInquiryDocument>();

  const hasChecklists =
    version.kind === 'ready' && (version.data.attributes.checklists ?? []).length > 0;
  const [history, comments, held, queue, queues, people, actions, checklist] = await Promise.all([
    loadSection(
      true,
      async () => (await api.cases.history(id, { page: { size: TIMELINE_PAGE_SIZE } })).data,
    ),
    loadSection(
      true,
      async () => (await api.cases.comments(id, { page: { size: COMMENTS_PAGE_SIZE } })).data,
    ),
    loadSection(true, async () => {
      const page = await api.cases.objects(id, { page: { size: HELD_PAGE_SIZE } });
      const read = new Map<CaseHeldObjectType, number>();
      return Promise.all(
        page.data.map(async (each): Promise<HeldRow> => {
          const type = each.attributes['object-type'];
          const kind = HELD_KINDS[type];
          const allowed = can(kind.scope);
          const href =
            allowed && kind.page !== null ? `${kind.page}/${each.attributes['object-id']}` : null;
          if (!allowed) {
            return { held: each, live: { kind: 'no-access' }, href: null };
          }
          const count = (read.get(type) ?? 0) + 1;
          read.set(type, count);
          if (count > LIVE_READS_PER_KIND) {
            return { held: each, live: { kind: 'not-read' }, href };
          }
          const live = await readLive(api, type, each.attributes['object-id'], inquiries);
          return { held: each, live, href: live.kind === 'no-access' ? null : href };
        }),
      );
    }),
    queueId !== null && can('case-queues:read')
      ? api.caseQueues.retrieve(queueId).then(
          (answer) => answer.data,
          () => null,
        )
      : Promise.resolve(null),
    can('case-queues:read') && can('cases:write')
      ? api.caseQueues
          .list({ filter: { status: ['active'] }, page: { size: 100 } })
          .then((answer) =>
            answer.data.map((each) => ({ id: each.id, label: each.attributes.name })),
          )
      : Promise.resolve(null),
    can('users:read')
      ? userDirectory().then(
          (directory) => new Map([...directory].map(([key, user]) => [key, user.email])),
          () => new Map<string, string>(),
        )
      : Promise.resolve(new Map<string, string>()),
    // C172.5: actions are read whenever the reader may see the actions module, wherever they are
    // placed; a layout that leaves the module out still shows them, at the top of the page.
    permitted.has('case-actions') && can('cases:read')
      ? loadSection(true, () => api.caseActions.available(id))
      : Promise.resolve(undefined),
    // C172.2: the checklist state, only for a version that has a checklist.
    hasChecklists ? loadSection(true, () => getCaseChecklist(id)) : Promise.resolve(undefined),
  ]);

  const rows = held.kind === 'ready' ? held.data : [];
  const firstOf = (type: CaseHeldObjectType) =>
    rows.find((row) => row.held.attributes['object-type'] === type && row.live.kind === 'shown');
  const inquiryRow = firstOf('inquiry');
  const inquiry =
    inquiryRow === undefined
      ? null
      : (inquiries.get(inquiryRow.held.attributes['object-id']) ?? null);
  const accountId = firstOf('account')?.held.attributes['object-id'] ?? null;
  const transactionRow = firstOf('transaction');
  const inquiryId = inquiry?.data.id ?? null;

  const [listMatches, graph, sessions, transaction] = await Promise.all([
    show('list-matches') && (inquiryId !== null || accountId !== null)
      ? loadSection(true, async () => {
          const filter =
            inquiryId !== null ? { 'inquiry-id': inquiryId } : { 'account-id': accountId ?? '' };
          return (await api.listMatches.list({ filter, page: { size: 100 } })).data;
        })
      : Promise.resolve(undefined),
    show('graph') && accountId !== null
      ? loadSection(true, async () => (await api.accounts.graphComponent(accountId)).data)
      : Promise.resolve(undefined),
    (show('device') || show('location')) && inquiryId !== null
      ? loadSection(true, async () => {
          const page = await api.inquirySessions.list({
            filter: { 'inquiry-id': inquiryId },
            page: { size: 100 },
          });
          const documents = await Promise.all(
            page.data.map((each) =>
              api.inquirySessions.retrieve(each.id, { include: ['device', 'network'] }),
            ),
          );
          return {
            sessions: documents.map((each) => each.data),
            included: documents.flatMap((each) => each.included ?? []),
          };
        })
      : Promise.resolve(undefined),
    show('transactions') && transactionRow !== undefined
      ? loadSection(true, async () => {
          const transactionId = transactionRow.held.attributes['object-id'];
          const [statusChanges, labels, relations] = await Promise.all([
            api.transactions.statusChanges(transactionId, { page: { size: 25 } }),
            api.transactions.labels(transactionId, { page: { size: 25 } }),
            api.transactions.relations(transactionId, { page: { size: 25 } }),
          ]);
          return {
            id: transactionId,
            redacted: transactionRow.live.kind === 'shown' && transactionRow.live.redacted,
            statusChanges,
            labels,
            relations,
          };
        })
      : Promise.resolve(undefined),
  ]);

  const members = queue?.attributes.members.map((member) => member['user-id']) ?? [];
  return {
    resource,
    template,
    version,
    modules,
    history,
    comments,
    held,
    queueName: queue?.attributes.name ?? null,
    queueMembers: members,
    queues,
    people,
    actions,
    live: { inquiry, listMatches, graph, sessions, transaction },
    checklist,
  };
}
