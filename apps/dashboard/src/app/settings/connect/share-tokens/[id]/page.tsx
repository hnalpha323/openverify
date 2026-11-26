import { idSchema } from '@openverify/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getShareToken } from '../../../../../components/connect/connect-api';
import { describeConnectProblem } from '../../../../../components/connect/connect-problem-words';
import {
  ShareTokenView,
  type PeekOutcome,
} from '../../../../../components/connect/share-token-view';
import { classifyApiError, displayProblemOf } from '../../../../../lib/api/errors';
import { hasPermission } from '../../../../../lib/api/me';
import { renderPage } from '../../../../../lib/api/page';
import { expireShareTokenAction, redeemShareTokenAction } from '../../actions';

export const metadata: Metadata = { title: 'Share token' };

export interface ShareTokenPageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const ACTIONS = { expire: expireShareTokenAction, redeem: redeemShareTokenAction };

/**
 * The peek the operator asked for (C233): `null` when refused in a way the page says in words
 * (the token not peekable, the cap, the limiter down); any other failure is the page's.
 */
async function peekAt(id: string): Promise<PeekOutcome> {
  try {
    return { kind: 'shown', token: await getShareToken(id, { peek: true }) };
  } catch (error) {
    if (classifyApiError(error) === 'problem') {
      return { kind: 'refused', problem: describeConnectProblem(displayProblemOf(error)) };
    }
    throw error;
  }
}

/**
 * One share token (C242.2). The peek runs only when the operator follows the page's peek link
 * (`?peek=true`), only for the destination, and only with `connect-share-tokens:peek` and
 * `pii:view` (C233.1): without them nothing is asked of the API and no value reaches the page.
 */
export default async function ShareTokenPage({ params, searchParams }: ShareTokenPageProps) {
  const { id } = await params;
  if (!idSchema('cnst').safeParse(id).success) {
    notFound();
  }
  const wantsPeek = (await searchParams).peek === 'true';
  return renderPage({ permissions: ['connect-share-tokens:read'] }, async ({ session }) => {
    const canPeek = hasPermission(session, 'connect-share-tokens:peek', 'pii:view');
    const token = await getShareToken(id);
    const peek: PeekOutcome =
      wantsPeek &&
      canPeek &&
      token.attributes.direction === 'inbound' &&
      token.attributes.status === 'created'
        ? await peekAt(id)
        : { kind: 'none' };
    return (
      <ShareTokenView
        token={token}
        abilities={{
          write: hasPermission(session, 'connect-share-tokens:write'),
          redeem: hasPermission(session, 'connect-share-tokens:redeem'),
          peek: canPeek,
        }}
        peek={peek}
        actions={ACTIONS}
      />
    );
  });
}
