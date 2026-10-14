import {
  updateAnnotationCommand,
  type CommentAnnotation,
  type EditorDocumentState,
} from './document-state.js';
import type { EditorCommand } from './session.js';

export type CommentReviewStatus = CommentAnnotation['status'];

export interface CommentSummaryEntry {
  readonly author: string;
  readonly commentId: string;
  readonly createdAt: string;
  readonly pageNumber: number;
  readonly status: CommentReviewStatus;
  readonly text: string;
}

export interface CommentSummaryReport {
  readonly schema: 'pdfmason.comment-summary';
  readonly version: 1;
  readonly generatedAt: string;
  readonly summary: {
    readonly open: number;
    readonly resolved: number;
    readonly total: number;
  };
  readonly comments: readonly CommentSummaryEntry[];
}

const validIsoTimestamp = (value: string): boolean => {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
};

const validateComment = (comment: CommentAnnotation): void => {
  if (
    comment.id.length < 1 ||
    comment.id.length > 100 ||
    comment.author.length < 1 ||
    comment.author.length > 100 ||
    comment.text.length > 2_000 ||
    !validIsoTimestamp(comment.createdAt)
  ) {
    throw new Error('COMMENT_SUMMARY_INVALID');
  }
};

export const createCommentSummaryReport = (
  state: EditorDocumentState,
  generatedAt: string,
): CommentSummaryReport => {
  if (!validIsoTimestamp(generatedAt)) throw new Error('COMMENT_SUMMARY_TIMESTAMP_INVALID');
  const pageNumbers = new Map(
    state.pageGraph.pages.map((page, index) => [page.id, index + 1] as const),
  );
  const commentIds = new Set<string>();
  const comments = state.annotations
    .filter((annotation): annotation is CommentAnnotation => annotation.kind === 'comment')
    .map((comment): CommentSummaryEntry => {
      validateComment(comment);
      if (commentIds.has(comment.id)) throw new Error('COMMENT_SUMMARY_ID_DUPLICATE');
      commentIds.add(comment.id);
      const pageNumber = pageNumbers.get(comment.pageId);
      if (pageNumber === undefined) throw new Error('COMMENT_SUMMARY_PAGE_MISSING');
      return Object.freeze({
        author: comment.author,
        commentId: comment.id,
        createdAt: comment.createdAt,
        pageNumber,
        status: comment.status,
        text: comment.text,
      });
    })
    .sort(
      (left, right) =>
        left.pageNumber - right.pageNumber ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.commentId.localeCompare(right.commentId),
    );
  const open = comments.filter(({ status }) => status === 'open').length;
  return Object.freeze({
    schema: 'pdfmason.comment-summary',
    version: 1,
    generatedAt,
    summary: Object.freeze({ open, resolved: comments.length - open, total: comments.length }),
    comments: Object.freeze(comments),
  });
};

export const updateCommentStatusCommand = (
  before: EditorDocumentState,
  commentId: string,
  status: CommentReviewStatus,
): EditorCommand<EditorDocumentState> => {
  const comment = before.annotations.find(
    (annotation): annotation is CommentAnnotation =>
      annotation.kind === 'comment' && annotation.id === commentId,
  );
  if (comment === undefined) throw new Error('The selected comment no longer exists.');
  return updateAnnotationCommand(before, { ...comment, status });
};
