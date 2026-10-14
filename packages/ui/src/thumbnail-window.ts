// VIEW-004: DOM work follows the viewport, never the document's page count.
export const thumbnailWindow = (
  count: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
): readonly number[] => {
  const height = Math.max(32, Number.isFinite(rowHeight) ? rowHeight : 200);
  const viewport = Math.max(0, Number.isFinite(viewportHeight) ? viewportHeight : 600);
  const top = Math.max(0, Number.isFinite(scrollTop) ? scrollTop : 0);
  const first = Math.max(0, Math.min(count - 1, Math.floor(top / height)) - 2);
  const end = Math.min(count, Math.ceil((top + viewport) / height) + 2);
  return Array.from({ length: Math.max(0, end - first) }, (_, offset) => first + offset);
};

interface RenderJob {
  readonly run: () => Promise<unknown>;
}

// The adapter cannot abort a render already underway. Keep at most two alive;
// unmount removes queued work, including rapid-scroll and source-replacement work.
export class ThumbnailRenderQueue {
  readonly #waiting: RenderJob[] = [];
  #active = 0;

  public schedule(run: () => Promise<unknown>): () => void {
    const job = { run };
    this.#waiting.push(job);
    this.#drain();
    return () => {
      const index = this.#waiting.indexOf(job);
      if (index !== -1) this.#waiting.splice(index, 1);
    };
  }

  #drain(): void {
    while (this.#active < 2 && this.#waiting.length > 0) {
      const job = this.#waiting.shift();
      if (job === undefined) return;
      this.#active += 1;
      void Promise.resolve()
        .then(job.run)
        .catch(() => undefined)
        .finally(() => {
          this.#active -= 1;
          this.#drain();
        });
    }
  }
}
