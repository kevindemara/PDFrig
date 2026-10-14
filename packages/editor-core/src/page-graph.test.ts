import { describe, expect, it } from 'vitest';

import {
  createInitialPageGraph,
  deletePageCommand,
  duplicatePageCommand,
  movePageCommand,
  rotatePageCommand,
} from './page-graph.js';
import { DocumentSession } from './session.js';

describe('page graph commands', () => {
  it('reorders, rotates, duplicates, deletes, and reverses without touching source bytes', () => {
    const graph = createInitialPageGraph('source-a', 3, (index) => `page-${index + 1}`);
    const session = new DocumentSession(
      { contentHash: 'sha256:synthetic', sourceId: 'source-a' },
      graph,
    );

    session.execute(movePageCommand(session.snapshot().state, 'page-3', 0));
    session.execute(rotatePageCommand(session.snapshot().state, 'page-3', true));
    session.execute(duplicatePageCommand(session.snapshot().state, 'page-3', 'page-3-copy'));
    expect(session.snapshot().state.pages.map(({ id }) => id)).toEqual([
      'page-3',
      'page-3-copy',
      'page-1',
      'page-2',
    ]);
    expect(session.snapshot().state.pages[0]?.rotation).toBe(90);

    session.execute(deletePageCommand(session.snapshot().state, 'page-3-copy'));
    session.undo();
    expect(session.snapshot().state.pages[1]?.id).toBe('page-3-copy');
    session.undo();
    expect(session.snapshot().state.pages).toHaveLength(3);
    session.redo();
    expect(session.snapshot().state.pages).toHaveLength(4);
  });

  it('refuses to remove the final page', () => {
    const graph = createInitialPageGraph('source-a', 1, () => 'only-page');
    expect(() => deletePageCommand(graph, 'only-page')).toThrow(
      'A PDF must contain at least one page.',
    );
  });
});
