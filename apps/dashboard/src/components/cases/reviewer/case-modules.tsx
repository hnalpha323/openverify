/**
 * The modules Phase 7 deferred to the case page (C142.2, C142.7): list matches, the graph, signals,
 * device and location, and the transaction module, each reusing the Phase 7 component with its
 * null, beta and attribution rules, for the case's first held inquiry, account or transaction. The
 * DB-IP line closes the location module whenever a session shows an IP location (C92.8).
 */
import type { DeviceResource, NetworkResource } from '@openverify/contracts';
import type { CaseLayoutModule } from '@openverify/core';
import { Fragment, type ReactNode } from 'react';
import type { ActionResult, ActionState } from '../../../lib/action-state';
import { AccountGraphComponent } from '../../graph/account-graph-component';
import { OptionalSection } from '../../lifecycle/optional-section';
import { DbIpAttribution } from '../../signals/db-ip-attribution';
import { InquirySignals } from '../../signals/inquiry-signals';
import { ListMatches } from '../../signals/list-matches';
import { SessionDevice, SessionNetwork, showsIpLocation } from '../../signals/session-parts';
import { TransactionHistory } from '../../transactions/transaction-history';
import { TransactionRelations } from '../../transactions/transaction-relations';
import type { CaseModulesData } from './load-case';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

export interface CaseModulesProps {
  /** The case whose page this is: a list-match dismissal refreshes it as well (K8-39). */
  readonly caseId: string;
  readonly data: CaseModulesData;
  readonly modules: ReadonlySet<CaseLayoutModule>;
  readonly piiView: boolean;
  readonly listsRead: boolean;
  readonly listsWrite: boolean;
  readonly dismissListMatch: Action;
  /** C172.5: the case actions placed in each module (`module:<key>`), shown inside it. */
  readonly actionsFor?: (module: CaseLayoutModule) => ReactNode;
}

/** The modules this component renders, in the default arrangement's order. */
export const LIVE_MODULES = [
  'list-matches',
  'graph',
  'signals',
  'device',
  'location',
  'transactions',
] as const satisfies readonly CaseLayoutModule[];

type Included = DeviceResource | NetworkResource;
const isDevice = (resource: Included): resource is DeviceResource => resource.type === 'device';
const isNetwork = (resource: Included): resource is NetworkResource => resource.type === 'network';

/** The included resource of `id` that `guard` accepts, or `null`. */
function includedOf<Resource extends Included>(
  included: readonly Included[],
  guard: (resource: Included) => resource is Resource,
  id: string | undefined,
): Resource | null {
  return included.filter(guard).find((resource) => resource.id === id) ?? null;
}

/**
 * Each live module's section, by key, for the case page to place: in the default order
 * (`CaseModules`) or in the version's layout (C172.1). A module with nothing to show has none.
 */
export function caseModuleNodes({
  caseId,
  data,
  modules,
  piiView,
  listsRead,
  listsWrite,
  dismissListMatch,
  actionsFor = () => null,
}: CaseModulesProps): Record<(typeof LIVE_MODULES)[number], ReactNode> {
  const { inquiry } = data;
  const sessions = data.sessions?.kind === 'ready' ? data.sessions.data : null;
  const masked = !piiView;
  return {
    'list-matches': (
      <OptionalSection
        id="case-list-matches"
        title="List matches"
        description="The held inquiry's list matches (the held account's when it holds no inquiry)."
        data={data.listMatches}
      >
        {(matches) => (
          <>
            <ListMatches
              matches={matches}
              piiView={piiView}
              listsLinked={listsRead}
              canDismiss={listsWrite}
              dismiss={dismissListMatch}
              revalidate={{
                ...(inquiry === null ? {} : { 'inquiry-id': inquiry.data.id }),
                'case-id': caseId,
              }}
              caption="List matches of the held object"
              emptyMessage="No list match for the held object."
            />
            {actionsFor('list-matches')}
          </>
        )}
      </OptionalSection>
    ),
    graph: (
      <OptionalSection
        id="case-graph"
        title="Graph"
        description="The held account's graph component."
        data={data.graph}
      >
        {(component) => (
          <>
            <AccountGraphComponent component={component} />
            {actionsFor('graph')}
          </>
        )}
      </OptionalSection>
    ),
    signals: modules.has('signals') && inquiry !== null && (
      <OptionalSection
        id="case-signals"
        title="Signals"
        description="The held inquiry's signals."
        data={{ kind: 'ready', data: inquiry }}
      >
        {(document) => (
          <>
            <InquirySignals
              signals={document.data.attributes.signals}
              details={document.data.attributes['signal-details']}
            />
            {actionsFor('signals')}
          </>
        )}
      </OptionalSection>
    ),
    device: modules.has('device') && (
      <OptionalSection
        id="case-device"
        title="Device"
        description="The held inquiry's sessions and their devices."
        data={data.sessions}
      >
        {() => (
          <>
            {sessions === null || sessions.sessions.length === 0 ? (
              <p className="text-sm text-ink-muted">No session yet.</p>
            ) : (
              <dl className="flex flex-col gap-3">
                {sessions.sessions.map((session) => (
                  <Fragment key={session.id}>
                    <dt className="font-mono text-xs">{session.id}</dt>
                    <dd>
                      <SessionDevice
                        session={session}
                        device={includedOf(
                          sessions.included,
                          isDevice,
                          session.relationships.device?.data?.id,
                        )}
                        masked={masked}
                      />
                    </dd>
                  </Fragment>
                ))}
              </dl>
            )}
            {actionsFor('device')}
          </>
        )}
      </OptionalSection>
    ),
    location: modules.has('location') && (
      <OptionalSection
        id="case-location"
        title="Location"
        description="The held inquiry's sessions and their networks."
        data={data.sessions}
      >
        {() => (
          <>
            {sessions === null || sessions.sessions.length === 0 ? (
              <p className="text-sm text-ink-muted">No session yet.</p>
            ) : (
              <div className="flex flex-col gap-3">
                <dl className="flex flex-col gap-3">
                  {sessions.sessions.map((session) => (
                    <Fragment key={session.id}>
                      <dt className="font-mono text-xs">{session.id}</dt>
                      <dd>
                        <SessionNetwork
                          session={session}
                          network={includedOf(
                            sessions.included,
                            isNetwork,
                            session.relationships.network?.data?.id,
                          )}
                          masked={masked}
                        />
                      </dd>
                    </Fragment>
                  ))}
                </dl>
                {sessions.sessions.some(showsIpLocation) && <DbIpAttribution />}
              </div>
            )}
            {actionsFor('location')}
          </>
        )}
      </OptionalSection>
    ),
    transactions: (
      <OptionalSection
        id="case-transactions"
        title="Transactions"
        description="The held transaction's status history, labels and relations."
        data={data.transaction}
      >
        {(transaction) => (
          <>
            <TransactionHistory
              transactionId={transaction.id}
              statusChanges={transaction.statusChanges}
              labels={transaction.labels}
              statusAfter={undefined}
              labelsAfter={undefined}
              relationsAfter={undefined}
              nextStatusCursor={null}
              nextLabelsCursor={null}
              redacted={transaction.redacted}
            />
            <TransactionRelations
              transactionId={transaction.id}
              relations={transaction.relations}
              after={undefined}
              nextCursor={null}
              otherCursors={{}}
            />
            {transaction.redacted && (
              <p className="text-sm text-ink-muted">
                The transaction was redacted; its relations are shown as they were.
              </p>
            )}
            {actionsFor('transactions')}
          </>
        )}
      </OptionalSection>
    ),
  };
}

/** The live modules in the default arrangement (C142.2). */
export function CaseModules(props: CaseModulesProps) {
  const nodes = caseModuleNodes(props);
  return (
    <>
      {LIVE_MODULES.map((key) => (
        <Fragment key={key}>{nodes[key]}</Fragment>
      ))}
    </>
  );
}
