import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageNode } from '@pdfmason/editor-core';
import type { BrowserPdfDocument } from '@pdfmason/pdf-engine/browser';
import { PageThumbnails } from './page-thumbnails.js';
import { ThumbnailRenderQueue } from './thumbnail-window.js';

const pages: readonly PageNode[] = Array.from({ length: 500 }, (_, index) => ({
  id: `page-${index}`,
  rotation: 0,
  sourceId: 'synthetic',
  sourcePageIndex: index,
}));
const renderer = { renderPage: vi.fn((): Promise<void> => Promise.resolve()) };
// Only the render adapter is used by this isolated UI fixture; no parser is mocked.
const documentFor = () => renderer as unknown as BrowserPdfDocument;
const Harness = () => {
  const [selectedId, setSelectedId] = useState(pages[0]?.id);
  return (
    <PageThumbnails
      canMove
      documentFor={documentFor}
      onMove={() => undefined}
      onSelect={setSelectedId}
      pages={pages}
      selectedId={selectedId}
    />
  );
};

describe('VIEW-004 virtual thumbnail navigation and lifecycle', () => {
  beforeEach(() => {
    renderer.renderPage.mockClear();
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return {
        height: this.classList.contains('page-thumbnails__row') ? 200 : 600,
        width: 200,
        top: 0,
        bottom: 600,
        left: 0,
        right: 200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('keeps the mounted DOM and canvas count bounded after a distant scroll', async () => {
    const { container } = render(<Harness />);
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    const first = screen.getAllByRole('listitem')[0];
    expect(first).toHaveAttribute('aria-setsize', '500');
    const rail = container.querySelector<HTMLDivElement>('.page-thumbnails');
    if (rail === null) throw new Error('Missing rail');
    rail.scrollTop = 50_000;
    fireEvent.scroll(rail);
    expect(screen.getByRole('button', { name: 'Page 251' })).toBeVisible();
    expect(screen.getAllByRole('listitem').length).toBeLessThanOrEqual(8);
    expect(container.querySelectorAll('canvas').length).toBeLessThanOrEqual(8);
    await waitFor(() => expect(renderer.renderPage).toHaveBeenCalled());
  });

  it('keeps keyboard focus mounted during scrolling and gives the list one Tab entry', () => {
    const { container } = render(<Harness />);
    const first = screen.getByRole('button', { name: 'Page 1' });
    act(() => first.focus());
    const rail = container.querySelector<HTMLDivElement>('.page-thumbnails');
    if (rail === null) throw new Error('Missing rail');
    rail.scrollTop = 50_000;
    fireEvent.scroll(rail);
    expect(first).toHaveFocus();
    expect(first.isConnected).toBe(true);
    expect(container.querySelectorAll('button[tabindex="0"]')).toHaveLength(1);
  });

  it('reaches unmounted pages with End/Home, arrows and page keys without dropping focus', () => {
    const { container } = render(<Harness />);
    act(() => screen.getByRole('button', { name: 'Page 1' }).focus());
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'End' });
    expect(screen.getByRole('button', { name: 'Page 500' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'ArrowUp' });
    expect(screen.getByRole('button', { name: 'Page 499' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Home' });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'PageDown' });
    expect(screen.getByRole('button', { name: 'Page 4' })).toHaveFocus();
    expect(container.querySelectorAll('button[tabindex="0"]')).toHaveLength(1);
  });

  it('preserves identity/focus after reorder and restores a surviving row after deletion', () => {
    const props = { canMove: true, documentFor, onMove: vi.fn(), onSelect: vi.fn() };
    const { rerender } = render(<PageThumbnails {...props} pages={pages} selectedId="page-0" />);
    const first = screen.getByRole('button', { name: 'Page 1' });
    act(() => first.focus());
    const reordered = [...pages.slice(1), pages[0]].filter((page) => page !== undefined);
    rerender(<PageThumbnails {...props} pages={reordered} selectedId="page-0" />);
    expect(screen.getByRole('button', { name: 'Page 500' })).toBe(first);
    expect(first).toHaveFocus();
    rerender(<PageThumbnails {...props} pages={reordered.slice(0, -1)} selectedId="page-499" />);
    expect(screen.getByRole('button', { name: 'Page 499' })).toHaveFocus();
  });

  it('keeps outside focus when external navigation reveals a distant page or a source is replaced', () => {
    const props = { canMove: true, documentFor, onMove: vi.fn(), onSelect: vi.fn() };
    const { rerender, container } = render(
      <>
        <button>Outside</button>
        <PageThumbnails {...props} pages={pages} selectedId="page-0" />
      </>,
    );
    act(() => screen.getByRole('button', { name: 'Outside' }).focus());
    rerender(
      <>
        <button>Outside</button>
        <PageThumbnails {...props} pages={pages} selectedId="page-400" />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Outside' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Page 401' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    rerender(
      <>
        <button>Outside</button>
        <PageThumbnails
          {...props}
          pages={[{ id: 'replacement', rotation: 0, sourceId: 'replacement', sourcePageIndex: 0 }]}
          selectedId="replacement"
        />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Outside' })).toHaveFocus();
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('moves only an internally dragged stable page ID and refuses disabled or stale drags', () => {
    const onMove = vi.fn();
    const props = { documentFor, onMove, onSelect: vi.fn(), pages, selectedId: 'page-0' };
    const { rerender } = render(<PageThumbnails {...props} canMove />);
    const rows = screen.getAllByRole('listitem');
    const [first, second, third] = rows;
    if (first === undefined || second === undefined || third === undefined)
      throw new Error('Missing rows');
    fireEvent.dragStart(first);
    fireEvent.drop(third);
    expect(onMove).toHaveBeenCalledWith('page-0', 2);
    fireEvent.drop(second);
    expect(onMove).toHaveBeenCalledOnce();
    fireEvent.dragStart(first);
    rerender(<PageThumbnails {...props} canMove={false} />);
    fireEvent.drop(third);
    expect(onMove).toHaveBeenCalledOnce();
  });

  it('discards queued renders on teardown and isolates native errors from the UI', async () => {
    const releases: (() => void)[] = [];
    renderer.renderPage.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releases.push(resolve);
        }),
    );
    const { unmount } = render(<Harness />);
    await waitFor(() => expect(renderer.renderPage).toHaveBeenCalledTimes(2));
    unmount();
    await act(async () => {
      releases.forEach((release) => release());
      await Promise.resolve();
    });
    expect(renderer.renderPage).toHaveBeenCalledTimes(2);
    renderer.renderPage.mockRejectedValue(new Error('private-native-error-canary'));
    render(
      <PageThumbnails
        canMove={false}
        documentFor={documentFor}
        onMove={() => undefined}
        onSelect={() => undefined}
        pages={pages.slice(0, 1)}
        selectedId="page-0"
      />,
    );
    await waitFor(() =>
      expect(within(screen.getByRole('list')).getByText('Preview unavailable')).toBeInTheDocument(),
    );
    expect(screen.queryByText(/private-native/u)).not.toBeInTheDocument();
    renderer.renderPage.mockResolvedValue(undefined);
  });

  it('remeasures a changed viewport and enlarged text row without retaining every page', () => {
    const { container } = render(<Harness />);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(900);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      height: 300,
      width: 200,
      top: 0,
      bottom: 300,
      left: 0,
      right: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent(window, new Event('resize'));
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(container.querySelector('ul')).toHaveStyle({ height: '150000px' });
  });

  it('rejects ended and removed-source drag identities rather than moving another page', () => {
    const onMove = vi.fn();
    const props = { canMove: true, documentFor, onMove, onSelect: vi.fn(), selectedId: 'page-0' };
    const { rerender } = render(<PageThumbnails {...props} pages={pages} />);
    const [first, second] = screen.getAllByRole('listitem');
    if (first === undefined || second === undefined) throw new Error('Missing rows');
    fireEvent.dragStart(first);
    fireEvent.dragEnd(window);
    fireEvent.drop(second);
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.dragStart(first);
    rerender(<PageThumbnails {...props} pages={pages.slice(1)} />);
    const surviving = screen.getAllByRole('listitem')[1];
    if (surviving === undefined) throw new Error('Missing surviving row');
    fireEvent.drop(surviving);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('keeps one render bound across tool teardown and a remounted rail', async () => {
    const queue = new ThumbnailRenderQueue();
    const releases: (() => void)[] = [];
    renderer.renderPage.mockImplementation(
      () => new Promise<void>((resolve) => releases.push(resolve)),
    );
    const props = {
      canMove: true,
      documentFor,
      onMove: vi.fn(),
      onSelect: vi.fn(),
      pages,
      selectedId: 'page-0',
      renderQueue: queue,
    };
    const previous = render(<PageThumbnails {...props} />);
    await waitFor(() => expect(renderer.renderPage).toHaveBeenCalledTimes(2));
    previous.unmount();
    const current = render(<PageThumbnails {...props} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(renderer.renderPage).toHaveBeenCalledTimes(2);
    renderer.renderPage.mockResolvedValue(undefined);
    await act(async () => {
      releases.forEach((release) => release());
      await Promise.resolve();
    });
    await waitFor(() => expect(renderer.renderPage).toHaveBeenCalledTimes(7));
    current.unmount();
  });

  it('does not bubble an internal page reorder into the workspace file-drop boundary', () => {
    const fileDrop = vi.fn();
    render(
      <div onDrop={fileDrop}>
        <Harness />
      </div>,
    );
    const [first, second] = screen.getAllByRole('listitem');
    if (first === undefined || second === undefined) throw new Error('Missing rows');
    fireEvent.dragStart(first);
    fireEvent.drop(second);
    expect(fileDrop).not.toHaveBeenCalled();
    // Foreign drops can still reach the host's independently validated file handler.
    fireEvent.drop(second);
    expect(fileDrop).toHaveBeenCalledOnce();
  });
});
