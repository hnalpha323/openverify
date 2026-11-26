/** The typed variable model and its scopes (plan C115.3-C115.6). */
export const VARIABLES_AREA = 'variables';
export * from './types.js';
// K8-12 (Workflow 8D): the trigger root a test run's synthetic payload must fit.
export { triggerType as triggerRootType } from './scope.js';
