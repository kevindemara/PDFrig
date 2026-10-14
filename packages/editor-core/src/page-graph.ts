import type { EditorCommand } from './session.js';

export type QuarterTurn = 0 | 90 | 180 | 270;

export interface PageNode {
  readonly id: string;
  readonly rotation: QuarterTurn;
  readonly sourceId: string;
  readonly sourcePageIndex: number;
}

export interface PageGraph {
  readonly pages: readonly PageNode[];
}

export type PageIdFactory = (sourcePageIndex: number) => string;

const freezeGraph = (pages: readonly PageNode[]): PageGraph =>
  Object.freeze({ pages: Object.freeze(pages.map((page) => Object.freeze({ ...page }))) });

const assertNonEmpty = (pages: readonly PageNode[]): void => {
  if (pages.length === 0) throw new Error('A PDF must contain at least one page.');
};

export const createInitialPageGraph = (
  sourceId: string,
  pageCount: number,
  createId: PageIdFactory,
): PageGraph => {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error('Page count must be a positive integer.');
  }
  return freezeGraph(
    Array.from({ length: pageCount }, (_, sourcePageIndex) => ({
      id: createId(sourcePageIndex),
      rotation: 0 as const,
      sourceId,
      sourcePageIndex,
    })),
  );
};

export const createPageGraphCommand = (
  id: string,
  before: PageGraph,
  update: (pages: readonly PageNode[]) => readonly PageNode[],
): EditorCommand<PageGraph> => {
  const afterPages = update(before.pages);
  assertNonEmpty(afterPages);
  const after = freezeGraph(afterPages);
  return Object.freeze({
    id,
    version: 1,
    apply: () => after,
    revert: () => before,
  });
};

export const movePageCommand = (
  before: PageGraph,
  pageId: string,
  targetIndex: number,
): EditorCommand<PageGraph> =>
  createPageGraphCommand(`page.move.${pageId}`, before, (pages) => {
    const sourceIndex = pages.findIndex((page) => page.id === pageId);
    if (sourceIndex < 0) throw new Error('The selected page no longer exists.');
    const boundedTarget = Math.max(0, Math.min(targetIndex, pages.length - 1));
    const result = [...pages];
    const [page] = result.splice(sourceIndex, 1);
    if (page === undefined) throw new Error('The selected page no longer exists.');
    result.splice(boundedTarget, 0, page);
    return result;
  });

export const rotatePageCommand = (
  before: PageGraph,
  pageId: string,
  clockwise: boolean,
): EditorCommand<PageGraph> =>
  createPageGraphCommand(`page.rotate.${pageId}`, before, (pages) =>
    pages.map((page) => {
      if (page.id !== pageId) return page;
      const delta = clockwise ? 90 : 270;
      return { ...page, rotation: ((page.rotation + delta) % 360) as QuarterTurn };
    }),
  );

export const duplicatePageCommand = (
  before: PageGraph,
  pageId: string,
  duplicateId: string,
): EditorCommand<PageGraph> =>
  createPageGraphCommand(`page.duplicate.${pageId}`, before, (pages) => {
    const sourceIndex = pages.findIndex((page) => page.id === pageId);
    const source = pages[sourceIndex];
    if (source === undefined) throw new Error('The selected page no longer exists.');
    const result = [...pages];
    result.splice(sourceIndex + 1, 0, { ...source, id: duplicateId });
    return result;
  });

export const deletePageCommand = (before: PageGraph, pageId: string): EditorCommand<PageGraph> =>
  createPageGraphCommand(`page.delete.${pageId}`, before, (pages) =>
    pages.filter((page) => page.id !== pageId),
  );

export const insertPagesCommand = (
  before: PageGraph,
  pagesToInsert: readonly PageNode[],
  targetIndex: number,
): EditorCommand<PageGraph> =>
  createPageGraphCommand('page.insert', before, (pages) => {
    const boundedTarget = Math.max(0, Math.min(targetIndex, pages.length));
    const result = [...pages];
    result.splice(boundedTarget, 0, ...pagesToInsert);
    return result;
  });
