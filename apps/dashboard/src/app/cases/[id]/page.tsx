import { idSchema } from '@openverify/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CaseView } from '../../../components/cases/reviewer/case-view';
import { loadCase } from '../../../components/cases/reviewer/load-case';
import { renderPage } from '../../../lib/api/page';
import { dismissListMatch } from '../../list-matches/actions';
import './print.css';
import {
  addCaseComment,
  addCaseObjects,
  addCaseTag,
  assignCase,
  checkCaseChecklistItem,
  decideHeldInquiry,
  printCase,
  redactCase,
  redactCaseComment,
  removeCaseObject,
  removeCaseTag,
  runCaseAction,
  setCaseQueue,
  setCaseSla,
  setCaseStatus,
  setCaseTags,
  updateCaseFields,
} from './actions';

export const metadata: Metadata = { title: 'Case' };

export interface CasePageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const ACTIONS = {
  setStatus: setCaseStatus,
  assign: assignCase,
  addComment: addCaseComment,
  redactComment: redactCaseComment,
  addTag: addCaseTag,
  removeTag: removeCaseTag,
  setTags: setCaseTags,
  updateFields: updateCaseFields,
  setQueue: setCaseQueue,
  setSla: setCaseSla,
  addObjects: addCaseObjects,
  removeObject: removeCaseObject,
  redact: redactCase,
  print: printCase,
  decide: decideHeldInquiry,
  dismissListMatch,
  runAction: runCaseAction,
  checkItem: checkCaseChecklistItem,
};

/**
 * One case (C142.2, decision 70): the fixed default layout, each module visible by its permission,
 * every object it holds read through its own route and scope. `cases:read` shows the page; each
 * part asks for its own scope on top.
 */
export default async function CasePage({ params }: CasePageProps) {
  const { id } = await params;
  if (!idSchema('case').safeParse(id).success) {
    notFound();
  }
  return renderPage({ permissions: ['cases:read'] }, async ({ session, api }) => {
    const data = await loadCase(api, session, id);
    return <CaseView data={data} session={session} now={Date.now()} actions={ACTIONS} />;
  });
}
