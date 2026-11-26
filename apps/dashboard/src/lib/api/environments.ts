/** The sandbox and production switch of a dashboard session (C15, C21). */
import 'server-only';
import { dashboardSwitchEnvironmentResponseSchema } from '@openverify/contracts';
import { apiRequest } from './client';
import type { DashboardSession, SessionEnvironment } from './me';

/** `PUT /dashboard/sessions/current/environment`; production needs `environments:production`. */
export async function switchSessionEnvironment(environmentId: string): Promise<SessionEnvironment> {
  const { environment } = await apiRequest({
    method: 'PUT',
    path: '/dashboard/sessions/current/environment',
    body: { 'environment-id': environmentId },
    schema: dashboardSwitchEnvironmentResponseSchema,
  });
  return environment;
}

/**
 * The environments the switcher offers: the session's others, production only with
 * `environments:production` (a reviewer cannot switch, C15).
 */
export function switchableEnvironments(
  session: Pick<DashboardSession, 'environment' | 'environments' | 'permissions'>,
): SessionEnvironment[] {
  return session.environments.filter(
    (environment) =>
      environment.id !== session.environment.id &&
      (environment.kind !== 'production' || session.permissions.has('environments:production')),
  );
}
