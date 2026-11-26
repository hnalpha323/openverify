import { idSchema } from '@openverify/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getConnection } from '../../../../../components/connect/connect-api';
import { ConnectionView } from '../../../../../components/connect/connection-view';
import { hasPermission } from '../../../../../lib/api/me';
import { renderPage } from '../../../../../lib/api/page';
import {
  activateConnectionAction,
  changeSharePolicyAction,
  deactivateConnectionAction,
  reactivateConnectionAction,
  startConnectStepUpWebauthn,
} from '../../actions';

export const metadata: Metadata = { title: 'Connection' };

export interface ConnectionPageProps {
  readonly params: Promise<{ id: string }>;
}

const ACTIONS = {
  activate: activateConnectionAction,
  deactivate: deactivateConnectionAction,
  reactivate: reactivateConnectionAction,
  changePolicy: changeSharePolicyAction,
  startStepUpWebauthn: startConnectStepUpWebauthn,
};

/**
 * One connection (C242.1), as the caller's side sees it; the one generic 404 of a connection the
 * caller may not see (C232.8) is the page's not found, as is an id that is not a connection's.
 */
export default async function ConnectionPage({ params }: ConnectionPageProps) {
  const { id } = await params;
  if (!idSchema('cxn').safeParse(id).success) {
    notFound();
  }
  return renderPage({ permissions: ['connect-connections:read'] }, async ({ session }) => (
    <ConnectionView
      connection={await getConnection(id)}
      abilities={{
        activate: hasPermission(session, 'connect-connections:activate'),
        write: hasPermission(session, 'connect-connections:write'),
      }}
      actions={ACTIONS}
    />
  ));
}
