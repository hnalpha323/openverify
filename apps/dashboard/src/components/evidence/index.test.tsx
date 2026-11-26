import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { governmentIdVerification } from '../../testing/lifecycle-fixtures';
import { PHASE5_RESOURCE_TYPES, phase5Verification } from '../../testing/phase5-fixtures';
import { selfieVerification } from '../../testing/selfie-fixtures';
import { EVIDENCE_COMPONENTS, VerificationEvidence, isPhase5Verification } from './index';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('the evidence table (C54.5)', () => {
  it('has a component for each Phase 5 type, and none for a government ID or a selfie', () => {
    expect(Object.keys(EVIDENCE_COMPONENTS).sort()).toEqual([...PHASE5_RESOURCE_TYPES].sort());
  });

  it.each(PHASE5_RESOURCE_TYPES)('takes the %s component from its own file', async (type) => {
    const file = join(HERE, `${type.slice('verification/'.length)}.tsx`);
    expect(existsSync(file)).toBe(true);

    const module = (await import(/* @vite-ignore */ file)) as Record<string, unknown>;

    expect(Object.values(module)).toEqual([EVIDENCE_COMPONENTS[type]]);
  });

  it.each(PHASE5_RESOURCE_TYPES)('knows a %s verification has evidence', (type) => {
    expect(isPhase5Verification(phase5Verification(type))).toBe(true);
  });

  it('knows a government ID and a selfie have their own views', () => {
    expect(isPhase5Verification(governmentIdVerification())).toBe(false);
    expect(isPhase5Verification(selfieVerification())).toBe(false);
  });

  it("renders a verification's evidence through its type's component", () => {
    render(
      <VerificationEvidence
        verification={phase5Verification('verification/email-address')}
        label="Email address"
        state="visible"
      />,
    );

    expect(screen.getByRole('group', { name: 'Email address evidence' })).toHaveTextContent(
      'avery@example.test',
    );
  });
});
