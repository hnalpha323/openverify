/**
 * Scopes an API key can hold; each server API route requires one (contracts C2 and C12).
 * The list lives in `@openverify/core` next to the user permissions (C15), which include every
 * scope, so the two can never drift apart.
 */
export { API_SCOPES, apiScopeSchema, isApiScope, type ApiScope } from '@openverify/core';
