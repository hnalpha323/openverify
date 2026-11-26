/**
 * C172.5 (Workflow 9B, `api-cases-reports`; contracts B37; review P28): where a case action shows and
 * who sees it.
 *
 * - **Placement**: the `header`, the `status-switcher` or a layout module (`module:<key>`, a module of
 *   the closed list `CASE_LAYOUT_MODULES`); another module key is refused at
 *   `/data/attributes/placement`. An action spans templates, so a module another template does not
 *   lay out leaves the action in the header of that template's case page (the console's rule).
 * - **`visible-when`** `{ statuses, role-ids }`: each list, when not empty, restricts the action to a
 *   case in one of those statuses and to a caller holding one of those roles in the case's
 *   environment (an assignment reaching it, C167.2); `null` and empty lists restrict nothing. An API
 *   key holds no role, so an action restricted to roles is never available to one. The roles named
 *   are roles of the organisation (422 by pointer).
 * - {@link isCaseActionVisible} is the one rule: `listAvailableCaseActions` leaves out what it hides,
 *   and `runCaseAction` refuses it with 403 `case_action_not_available`, so a restriction the console
 *   shows is enforced by the API.
 */
import { CASE_LAYOUT_MODULES } from '@openverify/core';
import { listUserRoleAssignments, roles, type Db } from '@openverify/db';
import { and, eq, inArray } from 'drizzle-orm';
import { UnprocessableContentError, type ProblemFieldError } from '../../../errors.js';
import type { Principal } from '../../../ports.js';
import { assignmentReaches } from '../../access/permissions.js';
import { CaseProblemError } from '../problems.js';

const ATTRIBUTES = '/data/attributes';

/** An action's `visible-when`, as stored. */
export interface CaseActionVisibleWhen {
  readonly statuses: readonly string[];
  readonly 'role-ids': readonly string[];
}

/** Who looks at an action: the case's status and the caller's roles in its environment. */
export interface CaseActionViewer {
  status: string;
  roleIds: ReadonlySet<string>;
}

const MODULE_PLACEMENT = /^module:(.+)$/;

/** @throws {UnprocessableContentError} for a module placement naming no layout module. */
export function assertCaseActionPlacement(placement: string | undefined): void {
  const module = placement === undefined ? undefined : MODULE_PLACEMENT.exec(placement)?.[1];
  if (module !== undefined && !(CASE_LAYOUT_MODULES as readonly string[]).includes(module)) {
    throw new UnprocessableContentError('The placement names no layout module.', [
      {
        location: 'body',
        pointer: `${ATTRIBUTES}/placement`,
        detail: 'Names no module of the case layout.',
      },
    ]);
  }
}

/** @throws {UnprocessableContentError} for a role that is not one of this organisation. */
export async function assertVisibleWhenRoles(
  db: Db,
  organizationId: string,
  visibleWhen: CaseActionVisibleWhen | null | undefined,
): Promise<void> {
  const roleIds = visibleWhen?.['role-ids'] ?? [];
  if (roleIds.length === 0) {
    return;
  }
  const found = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.organizationId, organizationId), inArray(roles.id, [...roleIds])));
  const known = new Set(found.map(({ id }) => id));
  const errors: ProblemFieldError[] = roleIds.flatMap((id, index) =>
    known.has(id)
      ? []
      : [
          {
            location: 'body',
            pointer: `${ATTRIBUTES}/visible-when/role-ids/${String(index)}`,
            detail: 'Names no role of this organisation.',
          },
        ],
  );
  if (errors.length > 0) {
    throw new UnprocessableContentError('A role is not one of this organisation.', errors);
  }
}

/** The roles `principal` holds in `environmentId`; an API key holds none. */
export async function rolesInEnvironment(
  db: Db,
  principal: Principal,
  environmentId: string,
): Promise<ReadonlySet<string>> {
  if (principal.kind !== 'user') {
    return new Set();
  }
  const assignments = await listUserRoleAssignments(db, principal.organizationId, principal.userId);
  return new Set(
    assignments
      .filter((assignment) => assignmentReaches(assignment, environmentId))
      .map((assignment) => assignment.role.id),
  );
}

/** The viewer of a case's actions: its status and the caller's roles in its environment. */
export async function caseActionViewerOf(
  db: Db,
  principal: Principal,
  caseRow: { environmentId: string; status: string },
): Promise<CaseActionViewer> {
  return {
    status: caseRow.status,
    roleIds: await rolesInEnvironment(db, principal, caseRow.environmentId),
  };
}

/** C172.5: whether `viewer` sees an action restricted by `visibleWhen`. The one rule (P28). */
export function isCaseActionVisible(
  visibleWhen: CaseActionVisibleWhen | null | undefined,
  viewer: CaseActionViewer,
): boolean {
  if (visibleWhen === null || visibleWhen === undefined) {
    return true;
  }
  const { statuses } = visibleWhen;
  const roleIds = visibleWhen['role-ids'];
  return (
    (statuses.length === 0 || statuses.includes(viewer.status)) &&
    (roleIds.length === 0 || roleIds.some((id) => viewer.roleIds.has(id)))
  );
}

/** @throws {CaseProblemError} 403 `case_action_not_available` for an action `viewer` does not see. */
export function assertCaseActionVisible(
  visibleWhen: CaseActionVisibleWhen | null | undefined,
  viewer: CaseActionViewer,
): void {
  if (!isCaseActionVisible(visibleWhen, viewer)) {
    throw new CaseProblemError(
      'case_action_not_available',
      'That action is not available for this case.',
    );
  }
}
