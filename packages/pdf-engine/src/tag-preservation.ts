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
  throw new Error('EDIT_TAG_PRESERVATION_FAILED');
};

interface ContentSnapshot {
  readonly reference: string | null;
  readonly dictionary: string;
  readonly digest: string;
}
interface PageSnapshot {
  readonly identity: string;
  readonly contents: readonly ContentSnapshot[];
}
export interface TagSnapshot {
  readonly graph: string;
  readonly pages: readonly PageSnapshot[];
}

/** EDIT-001 / ANNO-001–006 / FORM-001–002: unchanged-page direct export only.
 * Retain the whole tag graph and original content streams, not just Marked=true.
 * These snapshots contain restricted metadata and must never be logged/persisted.
 * This verifies preservation, not tag validity or PDF/UA conformance.
 */
export const snapshotTagStructures = async (document: PDFDocument): Promise<TagSnapshot | null> => {
  if (
    !document.catalog.has(PDFName.of('StructTreeRoot')) &&
    !document.catalog.has(PDFName.of('MarkInfo'))
  )
    return null;
  try {
    const pages = document.getPages();
    const pageReferences = new Set(pages.map((page) => page.ref.toString()));
    const widgets = new Map<string, unknown>();
    let nodes = 0;
    let characters = 0;
    let streamBytes = 0;
    const references = new Map<string, unknown>();
    const digests: Promise<string>[] = [];
    const digest = (stream: PDFStream): Promise<string> => {
      const bytes = stream.getContents();
      streamBytes += bytes.length;
      if (streamBytes > 50 * 1024 * 1024) return fail();
      return crypto.subtle
        .digest('SHA-256', bytes.slice().buffer)
        .then((hash) =>
          Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join(''),
        );
    };
    const visit = (object: PDFObject | undefined, depth = 0): unknown => {
      nodes += 1;
      if (nodes > 65_536 || depth > 128) return fail();
      if (object === undefined) return null;
      if (object instanceof PDFRef) {
        const reference = object.toString();
        if (widgets.has(reference)) return ['widget', reference, widgets.get(reference)];
        if (!pageReferences.has(reference) && !references.has(reference)) {
          if (references.size >= 32_768) return fail();
          references.set(reference, null);
          const resolved = document.context.lookup(object);
          if (resolved === undefined) return fail();
          references.set(reference, visit(resolved, depth + 1));
        }
        return ['ref', reference];
      }
      if (object instanceof PDFStream) {
        const index = digests.length;
        digests.push(digest(object));
        return ['stream', index, visitDictionary(object.dict, depth + 1, true)];
      }
      if (object instanceof PDFArray) {
        if (object.size() > 65_536 - nodes) return fail();
        return Array.from({ length: object.size() }, (_, index) =>
          visit(object.get(index), depth + 1),
        );
      }
      if (object instanceof PDFDict) return visitDictionary(object, depth + 1);
      const value = object.toString();
      characters += value.length;
      if (characters > 8 * 1024 * 1024) return fail();
      return value;
    };
    const visitDictionary = (dictionary: PDFDict, depth: number, stream = false): unknown => {
      const entries = dictionary
        .entries()
        .filter(([key]) => !stream || key !== PDFName.of('Length'));
      if (entries.length > 65_536 - nodes) return fail();
      return entries
        .sort(([left], [right]) => left.toString().localeCompare(right.toString()))
        .map(([key, value]) => [visit(key, depth), visit(value, depth)]);
    };
    // OBJR widget targets can legitimately change value/appearance during filling.
    // Their tag identity, geometry and page membership cannot change. FORM-002's
    // independent field/appearance verifier handles the editable properties.
    const identities = pages.map((page) => {
      const annotations = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
      const pageWidgets: unknown[] = [];
      if (annotations !== undefined && annotations.size() > 8_192) return fail();
      for (let index = 0; index < (annotations?.size() ?? 0); index++) {
        const reference = annotations?.get(index);
        const annotation = document.context.lookup(reference);
        if (
          !(annotation instanceof PDFDict) ||
          annotation.get(PDFName.of('Subtype')) !== PDFName.of('Widget')
        )
          continue;
        if (!(reference instanceof PDFRef)) return fail();
        const identity = ['Type', 'Subtype', 'P', 'Rect', 'StructParent'].map((key) => [
          key,
          visit(annotation.get(PDFName.of(key))),
        ]);
        widgets.set(reference.toString(), identity);
        pageWidgets.push([reference.toString(), identity]);
      }
      return JSON.stringify([
        page.ref.toString(),
        visit(page.node.get(PDFName.of('StructParents'))),
        pageWidgets,
      ]);
    });
    const roots = ['StructTreeRoot', 'MarkInfo', 'Lang'].map((key) =>
      visit(document.catalog.get(PDFName.of(key))),
    );
    const graph = JSON.stringify({
      identities,
      references: [...references.entries()].sort(([left], [right]) => left.localeCompare(right)),
      roots,
      digests: await Promise.all(digests),
    });
    const pageSnapshots: PageSnapshot[] = [];
    for (const [index, page] of pages.entries()) {
      const raw = page.node.get(PDFName.of('Contents'));
      const resolved = document.context.lookup(raw);
      const contents =
        resolved instanceof PDFArray ? resolved.asArray() : raw === undefined ? [] : [raw];
      if (contents.length > 8_192) return fail();
      const snapshots: ContentSnapshot[] = [];
      for (const content of contents) {
        const stream = document.context.lookup(content);
        if (!(stream instanceof PDFStream)) return fail();
        // Length is serialization-derived; filters and other dictionary values are not.
        references.clear();
        digests.length = 0;
        const dictionaryRoot = visitDictionary(stream.dict, 0, true);
        const dictionary = JSON.stringify({
          root: dictionaryRoot,
          references: [...references.entries()].sort(([left], [right]) =>
            left.localeCompare(right),
          ),
          digests: await Promise.all(digests),
        });
        snapshots.push({
          reference: content instanceof PDFRef ? content.toString() : null,
          dictionary,
          digest: await digest(stream),
        });
      }
      pageSnapshots.push({ identity: identities[index] ?? fail(), contents: snapshots });
    }
    return { graph, pages: pageSnapshots };
  } catch {
    return fail();
  }
};

export const assertTagStructuresPreserved = async (
  snapshot: TagSnapshot | null,
  output: PDFDocument,
): Promise<void> => {
  const result = await snapshotTagStructures(output);
  if (snapshot === null) {
    if (result !== null) return fail();
    return;
  }
  if (result?.graph !== snapshot.graph || snapshot.pages.length !== result.pages.length)
    return fail();
  for (const [index, sourcePage] of snapshot.pages.entries()) {
    const outputPage = result.pages[index];
    if (sourcePage.identity !== outputPage?.identity) return fail();
    // pdf-lib adds graphics-state wrappers and an overlay stream. Original streams
    // must remain byte-identical, with identical filters and in their original order.
    let cursor = 0;
    for (const content of sourcePage.contents) {
      const match = outputPage.contents.findIndex(
        (candidate, offset) =>
          offset >= cursor &&
          candidate.reference === content.reference &&
          candidate.digest === content.digest &&
          candidate.dictionary === content.dictionary,
      );
      if (match < 0) return fail();
      cursor = match + 1;
    }
  }
};
