/**
 * C207.9 (Phase 10, Workflow 10C; `api-nfc`): the console's words for the publish acknowledgement
 * `client-unable:<step id>`. The publish dialog shows a kind's words beside its key and falls back
 * to the raw key for a kind it has no words for, so every kind the contract knows has words, and
 * the client-unable ones say what is acknowledged: a self-asserted report that any client can send.
 */
import { TEMPLATE_ACKNOWLEDGEMENT_KINDS } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { FLOW_BUILDER_COPY } from './flow-builder';

const words: Readonly<Record<string, string>> = FLOW_BUILDER_COPY.acknowledgements;

describe('the publish acknowledgements’ words (C154.9, C207.9)', () => {
  it('has words for every kind the contract knows, never a raw key', () => {
    for (const kind of TEMPLATE_ACKNOWLEDGEMENT_KINDS) {
      expect(words[kind], kind).toBeDefined();
      expect(words[kind]?.length ?? 0, kind).toBeGreaterThan(20);
      expect(words[kind], kind).not.toContain(`${kind}:`);
    }
  });

  it('says a client-unable report is self-asserted, and that the fallback then skips review', () => {
    const text = words['client-unable'] ?? '';

    expect(text).toMatch(/self-asserted/);
    expect(text).toMatch(/any client can send it/);
    expect(text).toMatch(/without review/);
    expect(text).toMatch(/chip/);
  });
});
