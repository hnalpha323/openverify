import { describe, expect, it } from 'vitest';
import * as engine from './index.js';

describe('@openverify/workflow-engine', () => {
  it('is the package it says it is', () => {
    expect(engine.PACKAGE_NAME).toBe('@openverify/workflow-engine');
  });

  it('exports every area of the plan, each from its own folder', () => {
    expect([
      engine.ACTIONS_AREA,
      engine.CODE_RUNNER_AREA,
      engine.DEFINITION_AREA,
      engine.EXPRESSIONS_AREA,
      engine.GRAPH_AREA,
      engine.INTERPRETER_AREA,
      engine.LIMITS_AREA,
      engine.SCHEDULES_AREA,
      engine.TEMPLATES_AREA,
      engine.VARIABLES_AREA,
    ]).toEqual([
      'actions',
      'code-runner',
      'definition',
      'expressions',
      'graph',
      'interpreter',
      'limits',
      'schedules',
      'templates',
      'variables',
    ]);
  });
});
