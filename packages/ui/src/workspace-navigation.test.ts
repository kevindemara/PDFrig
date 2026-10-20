import { describe, expect, it, vi } from 'vitest';
import {
  createInitialEditorDocument,
  createPageMeasurement,
  DocumentSession,
} from '@pdfmason/editor-core';
import { confirmWorkspaceNavigation, hasUnsavedWorkspaceWork } from './workspace-navigation.js';

const makeSession = () =>
  new DocumentSession(
    { sourceId: 'synthetic', contentHash: 'synthetic-hash' },
    createInitialEditorDocument({ pages: [] }),
  );

describe('VIEW-001 workspace navigation', () => {
  it('does not warn for an empty or unchanged workspace', async () => {
    const confirmLeave = vi.fn();
    expect(hasUnsavedWorkspaceWork(undefined, 0)).toBe(false);
    expect(hasUnsavedWorkspaceWork(makeSession().snapshot(), 0)).toBe(false);
    expect(await confirmWorkspaceNavigation(false, confirmLeave)).toBe(true);
    expect(confirmLeave).not.toHaveBeenCalled();
  });

  it('warns for edits and remains dirty after cancellation until an export succeeds', async () => {
    const session = makeSession();
    session.execute({
      id: 'synthetic-edit',
      version: 1,
      apply: (state) => ({ ...state }),
      revert: (state) => ({ ...state }),
    });
    const confirmLeave = vi.fn().mockReturnValue(false);
    expect(hasUnsavedWorkspaceWork(session.snapshot(), 0)).toBe(true);
    expect(await confirmWorkspaceNavigation(true, confirmLeave)).toBe(false);
    expect(confirmLeave).toHaveBeenCalledWith(
      expect.stringContaining('Choose Cancel to stay and export'),
    );
    expect(session.snapshot().exported).toBe(false);
    session.markExported();
    expect(hasUnsavedWorkspaceWork(session.snapshot(), 0)).toBe(false);
  });

  it('allows an explicit leave without mutating the session or marking it exported', async () => {
    const session = makeSession();
    const before = session.snapshot();
    expect(await confirmWorkspaceNavigation(true, () => true)).toBe(true);
    expect(session.snapshot()).toEqual(before);
  });

  it('never treats an unresolved asynchronous confirmation as permission to leave', async () => {
    let resolve: ((confirmed: boolean) => void) | undefined;
    const confirmation = new Promise<boolean>((finish) => {
      resolve = finish;
    });
    const completed = vi.fn();
    const result = confirmWorkspaceNavigation(true, () => confirmation).then(completed);
    await Promise.resolve();
    expect(completed).not.toHaveBeenCalled();
    resolve?.(false);
    await result;
    expect(completed).toHaveBeenCalledExactlyOnceWith(false);
    expect(await confirmWorkspaceNavigation(true, () => Promise.resolve(true))).toBe(true);
  });

  it('protects unapplied removal marks and guides even after PDF export', () => {
    const session = makeSession();
    expect(hasUnsavedWorkspaceWork(session.snapshot(), 1)).toBe(true);
    session.execute({
      id: 'measurement',
      version: 1,
      apply: (state) => ({ ...state, measurements: [createPageMeasurement('synthetic-page')] }),
      revert: (state) => ({ ...state, measurements: [] }),
    });
    session.markExported();
    expect(hasUnsavedWorkspaceWork(session.snapshot(), 0)).toBe(true);
  });
});
