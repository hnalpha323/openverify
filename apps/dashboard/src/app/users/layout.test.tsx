import { describe, expect, it, vi } from 'vitest';
import { ConsoleLayout } from '../../components/console-layout';
import UsersLayout from './layout';

vi.mock('../actions/auth', () => ({ logout: vi.fn() }));
vi.mock('../actions/environment', () => ({ switchEnvironment: vi.fn() }));

describe('users layout', () => {
  it('is the console layout (tested in components/console-layout.test.tsx)', () => {
    expect(UsersLayout).toBe(ConsoleLayout);
  });
});
