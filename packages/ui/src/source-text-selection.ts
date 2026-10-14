import type { SourceTextRun } from '@pdfmason/pdf-engine/browser';
import type { NormalizedRect } from '@pdfmason/editor-core';
export interface PdfTextSelection {
  readonly text: string;
  readonly rect: NormalizedRect;
}
/** Whitespace inferred by independent PDF readers may differ. Match visible characters
 * and their page region, never silently choose the first duplicate or another line. */
export function matchSourceTextSelection(
  runs: readonly SourceTextRun[],
  selection: PdfTextSelection,
): { id: string; start: number; end: number } | null {
  const needle = selection.text.replace(/\s/gu, '');
  if (!needle || needle.length > 4096) return null;
  const matches: { id: string; start: number; end: number }[] = [];
  for (const run of runs) {
    const characters: string[] = [],
      offsets: number[] = [];
    for (let i = 0; i < run.text.length; i++)
      if (!/\s/u.test(run.text[i] ?? '')) {
        characters.push(run.text[i] ?? '');
        offsets.push(i);
      }
    const compact = characters.join('');
    for (let from = 0; from < compact.length;) {
      const index = compact.indexOf(needle, from);
      if (index < 0) break;
      let start = offsets[index];
      const last = offsets[index + needle.length - 1];
      let end = last === undefined ? undefined : last + 1;
      // Keep literal boundary whitespace when it exists in the source. The
      // compact match is only for whitespace independently inferred by readers.
      if (start !== undefined && end !== undefined) {
        const leading = /^\s*/u.exec(selection.text)?.[0] ?? '';
        const trailing = /\s*$/u.exec(selection.text)?.[0] ?? '';
        if (run.text.slice(Math.max(0, start - leading.length), start) === leading)
          start -= leading.length;
        if (run.text.slice(end, end + trailing.length) === trailing) end += trailing.length;
      }
      const bounds = run.bounds;
      const y = selection.rect.y + selection.rect.height / 2;
      const x = selection.rect.x + selection.rect.width / 2;
      if (
        start !== undefined &&
        last !== undefined &&
        end !== undefined &&
        (!bounds ||
          (Number.isFinite(y) &&
            Number.isFinite(x) &&
            y >= bounds.y - bounds.height * 0.3 &&
            y <= bounds.y + bounds.height * 1.3 &&
            x >= bounds.x - 0.005 &&
            x <= bounds.x + bounds.width + 0.005))
      )
        matches.push({ id: run.id, start, end });
      from = index + 1;
    }
  }
  return matches.length === 1 ? (matches[0] ?? null) : null;
}
