'use server';

import { dashboardSwitchEnvironmentBodySchema } from '@openverify/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ActionInputError, formString, parseInput, runAction } from '../../lib/api/action';
import { switchSessionEnvironment } from '../../lib/api/environments';
import { ForbiddenError } from '../../lib/api/errors';
import { isNoEnvironmentRole } from '../../lib/api/sessions';
import { NO_ENVIRONMENT_ROLE_WORDS } from '../../lib/login-state';

/**
 * Moves the session into another environment (C21), then opens the console there: resources of
 * the page the operator was on belong to the other environment.
 */
export async function switchEnvironment(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  const result = await runAction({}, async ({ session }) => {
    const body = parseInput(dashboardSwitchEnvironmentBodySchema, {
      'environment-id': formString(formData, 'environment-id'),
    });
    const target = session.environments.find(
      (environment) => environment.id === body['environment-id'],
    );
    if (target?.kind === 'production' && !session.permissions.has('environments:production')) {
      throw new ForbiddenError(['environments:production']);
    }
    try {
      await switchSessionEnvironment(body['environment-id']);
    } catch (error) {
      if (isNoEnvironmentRole(error)) {
        // C167.2 (K9-9): said in words, never which roles or environments exist.
        throw new ActionInputError({
          title: NO_ENVIRONMENT_ROLE_WORDS.environmentSwitch,
          status: 403,
          code: 'no_environment_role',
        });
      }
      throw error;
    }
    revalidatePath('/', 'layout');
    return undefined;
  });
  if (result.ok) {
    redirect('/');
  }
  return result;
}
