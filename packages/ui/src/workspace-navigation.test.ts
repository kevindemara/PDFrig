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
  it('does not warn for an empty or unchanged workspace', () => {
    const confirmLeave = vi.fn();
    expect(hasUnsavedWorkspaceWork(undefined, 0)).toBe(false);
    expect(hasUnsavedWorkspaceWork(makeSession().snapshot(), 0)).toBe(false);
    expect(confirmWorkspaceNavigation(false, confirmLeave)).toBe(true);
    expect(confirmLeave).not.toHaveBeenCalled();
  });

  it('warns for edits and remains dirty after cancellation until an export succeeds', () => {
    const session = makeSession();
    session.execute({
      id: 'synthetic-edit',
      version: 1,
      apply: (state) => ({ ...state }),
      revert: (state) => ({ ...state }),
    });
    const confirmLeave = vi.fn().mockReturnValue(false);
    expect(hasUnsavedWorkspaceWork(session.snapshot(), 0)).toBe(true);
    expect(confirmWorkspaceNavigation(true, confirmLeave)).toBe(false);
    expect(confirmLeave).toHaveBeenCalledWith(
      expect.stringContaining('Choose Cancel to stay and export'),
    );
    expect(session.snapshot().exported).toBe(false);
    session.markExported();
    expect(hasUnsavedWorkspaceWork(session.snapshot(), 0)).toBe(false);
  });

  it('allows an explicit leave without mutating the session or marking it exported', () => {
    const session = makeSession();
    const before = session.snapshot();
    expect(confirmWorkspaceNavigation(true, () => true)).toBe(true);
    expect(session.snapshot()).toEqual(before);
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
