/** C116.3: one object always gets one side, and a retried trigger gets the same side. */
import { newId } from '@openverify/contracts';
import type { WorkflowDeploymentRow, WorkflowVersionRow } from '@openverify/db';
import { describe, expect, it } from 'vitest';
import { chooseRolloutVersion } from './rollout.js';

const version = (id: string) => ({ id }) as WorkflowVersionRow;
const treatment = version(newId('wfv'));
const control = version(newId('wfv'));

const deployment = (percentage: number, id = newId('wfd')) =>
  ({
    id,
    versions: [
      { token: treatment.id, percentage, label: 'treatment' },
      { token: control.id, percentage: 100 - percentage, label: 'control' },
    ],
  }) as unknown as WorkflowDeploymentRow;

const versions = [treatment, control];
const subjects = Array.from({ length: 1_000 }, (_, index) => `inq_${String(index)}`);

describe('chooseRolloutVersion (C116.3)', () => {
  it('reads the live version when there is no rollout', () => {
    expect(chooseRolloutVersion(control, null, [control], 'subject')).toEqual({
      version: control,
      label: null,
      deploymentId: null,
    });
  });

  it('reads nothing before a version is published', () => {
    expect(chooseRolloutVersion(null, null, [], 'subject')).toBeNull();
  });

  it('gives one subject one side, always', () => {
    const rollout = deployment(50);
    const first = subjects.map(
      (subject) => chooseRolloutVersion(control, rollout, versions, subject)?.label,
    );
    const second = subjects.map(
      (subject) => chooseRolloutVersion(control, rollout, versions, subject)?.label,
    );

    expect(second).toEqual(first);
  });

  it('names the deployment and the side it took', () => {
    const rollout = deployment(100);

    expect(chooseRolloutVersion(control, rollout, versions, 'subject')).toEqual({
      version: treatment,
      label: 'treatment',
      deploymentId: rollout.id,
    });
  });

  it('takes about the percentage it was given', () => {
    const rollout = deployment(20);
    const taken = subjects.filter(
      (subject) => chooseRolloutVersion(control, rollout, versions, subject)?.label === 'treatment',
    ).length;

    expect(taken).toBeGreaterThan(120);
    expect(taken).toBeLessThan(280);
  });

  it('assigns by deployment, so a new rollout deals again', () => {
    const first = deployment(50);
    const second = deployment(50);

    const sides = (rollout: WorkflowDeploymentRow) =>
      subjects.map((subject) => chooseRolloutVersion(control, rollout, versions, subject)?.label);

    expect(sides(first)).not.toEqual(sides(second));
  });

  it('reads the control side when a rollout names a version it cannot find', () => {
    const rollout = deployment(100);

    expect(chooseRolloutVersion(control, rollout, [control], 'subject')).toEqual({
      version: control,
      label: 'control',
      deploymentId: rollout.id,
    });
  });
});
