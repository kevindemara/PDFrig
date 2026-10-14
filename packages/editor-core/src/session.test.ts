import { describe, expect, it } from 'vitest';

import { DocumentSession, type EditorCommand } from './session.js';

interface State {
  readonly pages: readonly string[];
}

const addPage = (page: string): EditorCommand<State> => ({
  id: `add-${page}`,
  version: 1,
  apply: (state) => ({ pages: [...state.pages, page] }),
  revert: (state) => ({ pages: state.pages.slice(0, -1) }),
});

describe('DocumentSession', () => {
  it('tracks reversible commands without holding document bytes', () => {
    const session = new DocumentSession<State>(
      { contentHash: 'sha256:synthetic', sourceId: 'source-1' },
      { pages: ['page-1'] },
    );

    expect(session.execute(addPage('page-2'))).toMatchObject({
      canUndo: true,
      exported: false,
      state: { pages: ['page-1', 'page-2'] },
    });
    expect(session.undo().state.pages).toEqual(['page-1']);
    expect(session.redo().state.pages).toEqual(['page-1', 'page-2']);
    expect(session.markExported().exported).toBe(true);
  });
});
