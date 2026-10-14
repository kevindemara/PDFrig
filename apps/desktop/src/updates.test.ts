import { describe, expect, it } from 'vitest';

import { DesktopUpdateManager } from './updates.js';

describe('desktop update adapter', () => {
  it('accepts only content-bounded metadata returned by the native updater', async () => {
    const manager = new DesktopUpdateManager(<T>(command: string): Promise<T> => {
      expect(command).toBe('check_for_update');
      return Promise.resolve({
        currentVersion: '1.0.0',
        notes: 'Synthetic release notes',
        publishedAt: '2026-08-24T12:00:00Z',
        version: '1.1.0',
      } as T);
    });
    await expect(manager.check()).resolves.toMatchObject({ version: '1.1.0' });
  });

  it('passes only the confirmed version into the install boundary', async () => {
    const calls: unknown[] = [];
    const manager = new DesktopUpdateManager(
      <T>(command: string, arguments_?: Readonly<Record<string, unknown>>): Promise<T> => {
        calls.push({ arguments_, command });
        return Promise.resolve(null as T);
      },
    );
    await manager.install('1.2.3');
    expect(calls).toEqual([
      { arguments_: { expectedVersion: '1.2.3' }, command: 'install_available_update' },
    ]);
  });

  it('rejects malformed native update metadata', async () => {
    const manager = new DesktopUpdateManager(<T>(): Promise<T> =>
      Promise.resolve({ notes: ['unsafe'], version: '1.1.0' } as T),
    );
    await expect(manager.check()).rejects.toThrow('NATIVE_UPDATE_INVALID');
  });
});
