/**
 * Binds a form to the environment its page was rendered for (Workflow 2D F002). The session
 * environment is shared by every tab, so an environment-scoped action (`runAction` with
 * `environmentForm`) compares this value with the session's and saves nothing when they differ.
 */
export const ENVIRONMENT_FIELD = 'environment-id';

/** The hidden `environment-id` field of an environment-scoped form. */
export function EnvironmentField({ environmentId }: { readonly environmentId: string }) {
  return <input type="hidden" name={ENVIRONMENT_FIELD} value={environmentId} />;
}
