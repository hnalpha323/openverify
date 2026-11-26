/**
 * Workflow 11C Stage 1a (contracts-11c): the four variables 11C adds, entered in the configuration
 * registry with their processes (C257.1, C263.6, C289; orchestrator decision 17 before 11C), so the
 * chart's per-process ConfigMap and Secrets (C264.3) and 11E's reference are generated from them.
 */
import { describe, expect, it } from 'vitest';
import { CONFIG_REGISTRY } from './config-registry.js';

const entry = (name: string) => CONFIG_REGISTRY.find((variable) => variable.name === name);

describe('the variables Workflow 11C adds (C257.1, C263.6, C289)', () => {
  it('registers OPENVERIFY_FLOW_API_URL for the flow server, not a secret', () => {
    expect(entry('OPENVERIFY_FLOW_API_URL')).toMatchObject({
      default: null,
      secret: false,
      fileForm: false,
      processes: ['flow'],
    });
  });

  it('registers OPENVERIFY_FLOW_FACE_GUIDANCE, read when the flow is built, on by default', () => {
    expect(entry('OPENVERIFY_FLOW_FACE_GUIDANCE')).toMatchObject({
      default: 'on',
      secret: false,
      fileForm: false,
      processes: ['flow'],
    });
  });

  it('registers OPENVERIFY_CODE_RUNNER_TOKEN as a secret of the worker and the runner, with its _FILE form', () => {
    expect(entry('OPENVERIFY_CODE_RUNNER_TOKEN')).toMatchObject({
      default: null,
      secret: true,
      fileForm: true,
      processes: ['worker', 'code-runner'],
    });
  });

  it('registers OPENVERIFY_CODE_RUNNER_LISTEN for the runner', () => {
    expect(entry('OPENVERIFY_CODE_RUNNER_LISTEN')).toMatchObject({
      default: null,
      secret: false,
      fileForm: false,
      processes: ['code-runner'],
    });
  });

  it('describes the tcp: form of OPENVERIFY_WORKFLOW_CODE_RUNNER', () => {
    expect(entry('OPENVERIFY_WORKFLOW_CODE_RUNNER')?.description).toContain('tcp:<host>:<port>');
  });
});
