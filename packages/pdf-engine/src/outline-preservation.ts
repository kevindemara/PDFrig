import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFRef,
  PDFStream,
  type PDFDocument,
  type PDFObject,
} from '@cantoo/pdf-lib';

const fail = (): never => {
  throw new Error('EDIT_OUTLINE_PRESERVATION_FAILED');
};

/** VIEW-006 / EDIT-001: retain the entire bookmark graph, not the display-limited list.
 * Page references are terminal destinations; their identity and order are checked
 * without traversing changed page content. This is a rewrite check, not validation
 * of an arbitrary bookmark's actions or semantics. Never log the snapshot.
 */
export const snapshotOutlineStructures = (document: PDFDocument): string | null => {
  if (!document.catalog.has(PDFName.of('Outlines'))) return null;
  try {
    const pages = document.getPages().map((page) => page.ref.toString());
    const pageReferences = new Set(pages);
    const references = new Map<string, unknown>();
    let nodes = 0;
    let characters = 0;
    const visit = (object: PDFObject | undefined, depth = 0): unknown => {
      nodes += 1;
      if (nodes > 8_192 || depth > 64) return fail();
      if (object === undefined) return null;
      if (object instanceof PDFRef) {
        const reference = object.toString();
        if (!pageReferences.has(reference) && !references.has(reference)) {
          if (references.size >= 4_096) return fail();
          references.set(reference, null);
          const resolved = document.context.lookup(object);
          if (resolved === undefined) return fail();
          references.set(reference, visit(resolved, depth + 1));
        }
        return ['ref', reference];
      }
      if (object instanceof PDFStream) return fail();
      if (object instanceof PDFArray) {
        if (object.size() > 8_192 - nodes) return fail();
        return Array.from({ length: object.size() }, (_, index) =>
          visit(object.get(index), depth + 1),
        );
      }
      if (object instanceof PDFDict) {
        const entries = object.entries();
        if (entries.length > 8_192 - nodes) return fail();
        return entries
          .sort(([left], [right]) => left.toString().localeCompare(right.toString()))
          .map(([key, value]) => [visit(key, depth + 1), visit(value, depth + 1)]);
      }
      const value = object.toString();
      characters += value.length;
      if (characters > 2 * 1024 * 1024) return fail();
      return value;
    };
    const names = document.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
    const roots = [
      visit(document.catalog.get(PDFName.of('Outlines'))),
      visit(document.catalog.get(PDFName.of('Dests'))),
      visit(names?.get(PDFName.of('Dests'))),
    ];
    return JSON.stringify({
      pages,
      references: [...references.entries()].sort(([left], [right]) => left.localeCompare(right)),
      roots,
    });
  } catch {
    return fail();
  }
};

export const assertOutlineStructuresPreserved = (
  snapshot: string | null,
  output: PDFDocument,
): void => {
  if (snapshot !== snapshotOutlineStructures(output)) fail();
};
