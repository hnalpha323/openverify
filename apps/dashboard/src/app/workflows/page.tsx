import Link from 'next/link';
import { LINK_CLASS } from '../../components/link-styles';
import type { Metadata } from 'next';
import { PageSection } from '../../components/lifecycle/page-section';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { CreateWorkflowForm } from '../../components/workflows/create-workflow-form';
import { RecipesTable } from '../../components/workflows/recipes-table';
import { WorkflowsTable } from '../../components/workflows/workflows-table';
import { hasPermission } from '../../lib/api/me';
import { renderPage } from '../../lib/api/page';
import { createWorkflow, installRecipe } from './actions';

export const metadata: Metadata = { title: 'Workflows' };

/** Workflows shown at once: an environment rarely has more. */
const WORKFLOW_PAGE_SIZE = 100;

/**
 * The environment's workflows and the documented recipes (C141, C140.5), read with
 * `workflows:read`; a recipe installs with `workflows:write` as a paused draft.
 */
export default async function WorkflowsPage() {
  return renderPage({ permissions: ['workflows:read'] }, async ({ session, api }) => {
    const [workflows, recipes] = await Promise.all([
      api.workflows.list({ page: { size: WORKFLOW_PAGE_SIZE } }),
      api.workflows.recipes(),
    ]);
    return (
      <PageMain className="gap-8">
        <PageHeader
          title="Workflows"
          description="What runs on its own when something happens. Each run acts with its published version's grant, never more than its publisher holds."
        />
        {hasPermission(session, 'workflows:write') && (
          <nav aria-label="Bindings" className="flex flex-wrap gap-6 text-sm">
            <Link href="/account-actions" className={LINK_CLASS}>
              Account actions
            </Link>
            <Link href="/case-actions" className={LINK_CLASS}>
              Case actions
            </Link>
          </nav>
        )}
        <WorkflowsTable workflows={workflows.data} />
        {hasPermission(session, 'workflows:write') && (
          <PageSection id="new-workflow" title="New workflow">
            <CreateWorkflowForm environmentId={session.environment.id} action={createWorkflow} />
          </PageSection>
        )}
        <PageSection id="workflow-recipes" title="Recipes">
          <RecipesTable
            recipes={recipes.data}
            install={hasPermission(session, 'workflows:write') ? installRecipe : undefined}
          />
        </PageSection>
      </PageMain>
    );
  });
}
