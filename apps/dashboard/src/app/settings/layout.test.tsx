import { describe, expect, it, vi } from 'vitest';
import { ConsoleLayout } from '../../components/console-layout';
import SettingsLayout from './layout';

vi.mock('../actions/auth', () => ({ logout: vi.fn() }));
vi.mock('../actions/environment', () => ({ switchEnvironment: vi.fn() }));

describe('settings layout', () => {
  it('is the console layout (tested in components/console-layout.test.tsx)', () => {
    expect(SettingsLayout).toBe(ConsoleLayout);
  });
});
