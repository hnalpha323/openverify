import { redirect } from 'next/navigation';
import { homePath } from '../components/nav-items';
import { getSession } from '../lib/api/me';

/**
 * The console opens on the first page the operator's role allows (`/inquiries` for every
 * built-in role); a session that must pass MFA first goes to the security page.
 */
export default async function HomePage(): Promise<never> {
  const session = await getSession();
  redirect(session.mfaSatisfied ? homePath(session.permissions) : '/account/security');
}
