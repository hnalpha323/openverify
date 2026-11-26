import type { VerificationConfig } from '@openverify/contracts';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VERSION_CONTENT } from '../../testing/lifecycle-fixtures';
import { FlowBuilder } from './flow-builder';
import { builderFlow } from './test-flows';

const ETAG = `"${'a'.repeat(64)}"`;
const config: VerificationConfig = VERSION_CONTENT['verification-config'];

// R010 (Workflow 9D review, fix-builder): the outline is the builder's keyboard and screen-reader
// surface (C155.2), so a step selected on the canvas is the outline's selected item too.
describe('the flow builder keeps the outline in step with the canvas (C155.10)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('marks the outline item of a step selected on the canvas, and only that one', () => {
    const { container } = render(
      <FlowBuilder
        versionId="itmplv_01JB0000000000000000000002"
        flow={builderFlow()}
        etag={ETAG}
        migrated={false}
        verificationConfig={config}
        canEdit
        canPublish
        autosaveMs={0}
        actions={{
          save: vi.fn(),
          check: vi.fn(),
          publish: vi.fn(),
        }}
      />,
    );
    const outline = screen.getByRole('tree', { name: 'Outline of the flow' });
    const item = (name: string) => within(outline).getByRole('treeitem', { name });
    fireEvent.click(item('Consent'));
    expect(item('Consent')).toHaveAttribute('aria-selected', 'true');

    const node = container.querySelector<HTMLElement>('.react-flow__node[data-id="s_govid000"]');
    expect(node).not.toBeNull();
    fireEvent.click(node ?? document.body);

    expect(item('Government ID')).toHaveAttribute('aria-selected', 'true');
    expect(item('Government ID')).toHaveAttribute('tabindex', '0');
    expect(item('Consent')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('region', { name: 'Selected step' })).toHaveTextContent(
      'Step: s_govid000',
    );
  });
});
