import { describe, expect, it } from 'vitest';

import { createInitialEditorDocument, type EditorDocumentState } from './document-state.js';
import { createInitialPageGraph } from './page-graph.js';
import { DocumentSession } from './session.js';
import { createCommentSummaryReport, updateCommentStatusCommand } from './comment-review.js';

const stateWithComments = (): EditorDocumentState => ({
  ...createInitialEditorDocument(createInitialPageGraph('source', 2, (index) => `page-${index}`)),
  annotations: [
    {
      author: 'Local author',
      color: '#a86200',
      createdAt: '2026-08-25T13:00:00.000Z',
      id: 'comment-b',
      kind: 'comment' as const,
      pageId: 'page-1',
      rect: { height: 0.1, width: 0.2, x: 0.1, y: 0.1 },
      status: 'resolved' as const,
      text: 'Second page note',
    },
    {
      author: 'Local author',
      color: '#a86200',
      createdAt: '2026-08-25T12:00:00.000Z',
      id: 'comment-a',
      kind: 'comment' as const,
      pageId: 'page-0',
      rect: { height: 0.1, width: 0.2, x: 0.1, y: 0.1 },
      status: 'open' as const,
      text: 'First page note',
    },
  ],
});

describe('local comment review ledger', () => {
  it('builds a deterministic content-bearing summary with stable identities', () => {
    const report = createCommentSummaryReport(stateWithComments(), '2026-08-25T14:00:00.000Z');
    expect(report).toEqual({
      comments: [
        {
          author: 'Local author',
          commentId: 'comment-a',
          createdAt: '2026-08-25T12:00:00.000Z',
          pageNumber: 1,
          status: 'open',
          text: 'First page note',
        },
        {
          author: 'Local author',
          commentId: 'comment-b',
          createdAt: '2026-08-25T13:00:00.000Z',
          pageNumber: 2,
          status: 'resolved',
          text: 'Second page note',
        },
      ],
      generatedAt: '2026-08-25T14:00:00.000Z',
      schema: 'pdfmason.comment-summary',
      summary: { open: 1, resolved: 1, total: 2 },
      version: 1,
    });
    expect(JSON.stringify(report, null, 2)).toMatch(
      /^\{\n {2}"schema": "pdfmason\.comment-summary"/u,
    );
  });

  it('changes review status through undoable editor history', () => {
    const session = new DocumentSession(
      { contentHash: 'synthetic', sourceId: 'source' },
      stateWithComments(),
    );
    session.execute(updateCommentStatusCommand(session.snapshot().state, 'comment-a', 'resolved'));
    expect(session.snapshot().state.annotations[1]).toMatchObject({ status: 'resolved' });
    session.undo();
    expect(session.snapshot().state.annotations[1]).toMatchObject({ status: 'open' });
  });

  it('rejects missing pages and malformed timestamps instead of emitting ambiguous reports', () => {
    const original = stateWithComments();
    const first = original.annotations[0];
    const second = original.annotations[1];
    if (first === undefined || second === undefined) {
      throw new Error('The synthetic comment fixture is incomplete.');
    }
    const missingPage: EditorDocumentState = {
      ...original,
      annotations: [{ ...first, pageId: 'missing' }],
    };
    expect(() => createCommentSummaryReport(missingPage, '2026-08-25T14:00:00.000Z')).toThrow(
      'COMMENT_SUMMARY_PAGE_MISSING',
    );
    expect(() => createCommentSummaryReport(stateWithComments(), 'not-a-date')).toThrow(
      'COMMENT_SUMMARY_TIMESTAMP_INVALID',
    );
    const duplicateIdentity: EditorDocumentState = {
      ...original,
      annotations: [first, { ...second, id: 'comment-b' }],
    };
    expect(() => createCommentSummaryReport(duplicateIdentity, '2026-08-25T14:00:00.000Z')).toThrow(
      'COMMENT_SUMMARY_ID_DUPLICATE',
    );
  });
});
