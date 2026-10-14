import { describe, expect, it, vi } from 'vitest';

import { createPrintAdapter } from './platform.js';

describe('print platform adapter', () => {
  it('opens only the host callback supplied by the application surface', async () => {
    const openDialog = vi.fn();
    const adapter = createPrintAdapter(openDialog);

    await adapter.openDialog();

    expect(openDialog).toHaveBeenCalledOnce();
    expect(Object.isFrozen(adapter)).toBe(true);
  });

  it('preserves asynchronous host failures for content-free UI handling', async () => {
    const adapter = createPrintAdapter(() => Promise.reject(new Error('host unavailable')));

    await expect(adapter.openDialog()).rejects.toThrow('host unavailable');
  });
});
