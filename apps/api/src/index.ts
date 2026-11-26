/** Workspace package name. */
export const PACKAGE_NAME = '@openverify/api';

export { buildApp, type AppMode, type BuildAppOptions } from './app.js';
export { AppError, ForbiddenError, UnauthorizedError, type AppErrorInit } from './errors.js';
export { REDACT_PATHS, type LoggerSettings } from './logger.js';
export type { ApiKeyLookup, ApiKeyRecord, AuthenticatedApiKey } from './plugins/principal-auth.js';
export type { ApiKeyPrincipal, Principal, PrincipalResolver, UserPrincipal } from './ports.js';
export { PROBLEM_CONTENT_TYPE, type ProblemDetails } from './problem-details.js';
