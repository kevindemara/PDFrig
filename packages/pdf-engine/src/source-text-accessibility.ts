import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  type PDFDocument,
  type PDFObject,
} from '@cantoo/pdf-lib';

interface SourceTextSemanticChange {
  readonly pageIndex: number;
  readonly markedContentId: number;
  readonly expectedText: string;
  readonly replacementText: string;
}

const fail = (): never => {
  throw new Error('SOURCE_TEXT_ACCESSIBILITY_UNSUPPORTED');
};

/** EDIT-002 engine evaluation support, not a shipped source-text editor.
 * Only a uniquely owned page MCID with exact, single-content ActualText is
 * supported. Never replace a string globally, guess an ancestor's reading order,
 * remove tags or modify shared form-XObject semantics. Validate before mutation.
 */
export const updateSourceTextAccessibility = (
  document: PDFDocument,
  change: SourceTextSemanticChange,
): void => {
  if (
    !Number.isSafeInteger(change.pageIndex) ||
    change.pageIndex < 0 ||
    change.pageIndex >= document.getPageCount() ||
    !Number.isSafeInteger(change.markedContentId) ||
    change.markedContentId < 0 ||
    change.markedContentId > 65_535 ||
    [change.expectedText, change.replacementText].some(
      (text) =>
        typeof text !== 'string' ||
        text.length === 0 ||
        text.length > 4_096 ||
        Array.from(text).some((character) => {
          const point = character.codePointAt(0) ?? 0;
          return point < 0x20 || point === 0x7f || (point >= 0xd800 && point <= 0xdfff);
        }),
    )
  )
    return fail();
  const context = document.context;
  const resolve = (value: PDFObject | undefined): PDFObject | undefined => context.lookup(value);
  const root = resolve(document.catalog.get(PDFName.of('StructTreeRoot')));
  if (!(root instanceof PDFDict) || root.get(PDFName.of('Type')) !== PDFName.of('StructTreeRoot'))
    return fail();
  const page = document.getPage(change.pageIndex);
  const ownerPage = page.ref.toString();
  const seen = new Set<PDFDict>();
  const contentCounts = new Map<PDFDict, number>();
  const targets: PDFDict[][] = [];
  let visited = 0;
  const walk = (
    raw: PDFObject | undefined,
    parent: PDFDict,
    ancestors: readonly PDFDict[],
    inheritedPage: string | null,
    depth: number,
  ): void => {
    if (++visited > 65_536 || depth > 128) return fail();
    const value = resolve(raw);
    if (value === undefined) return fail();
    if (value instanceof PDFArray) {
      if (value.size() > 8_192) return fail();
      for (const child of value.asArray()) walk(child, parent, ancestors, inheritedPage, depth + 1);
      return;
    }
    const countContent = (markedContentId: number, pageReference: string | null): void => {
      if (!Number.isSafeInteger(markedContentId) || markedContentId < 0 || pageReference === null)
        return fail();
      for (const ancestor of ancestors)
        contentCounts.set(ancestor, (contentCounts.get(ancestor) ?? 0) + 1);
      if (markedContentId === change.markedContentId && pageReference === ownerPage)
        targets.push([...ancestors]);
    };
    if (value instanceof PDFNumber) {
      countContent(value.asNumber(), inheritedPage);
      return;
    }
    if (!(value instanceof PDFDict)) return fail();
    const type = value.get(PDFName.of('Type'));
    const ownPage = value.get(PDFName.of('Pg'))?.toString() ?? inheritedPage;
    if (type === PDFName.of('MCR')) {
      if (value.has(PDFName.of('Stm')) || value.has(PDFName.of('StmOwn'))) return fail();
      const id = resolve(value.get(PDFName.of('MCID')));
      if (!(id instanceof PDFNumber)) return fail();
      countContent(id.asNumber(), ownPage);
      return;
    }
    if (type === PDFName.of('OBJR')) {
      for (const ancestor of ancestors)
        contentCounts.set(ancestor, (contentCounts.get(ancestor) ?? 0) + 1);
      return;
    }
    if (
      (type !== undefined && type !== PDFName.of('StructElem')) ||
      !(resolve(value.get(PDFName.of('S'))) instanceof PDFName) ||
      resolve(value.get(PDFName.of('P'))) !== parent ||
      seen.has(value)
    )
      return fail();
    seen.add(value);
    contentCounts.set(value, 0);
    const children = value.get(PDFName.of('K'));
    if (children !== undefined) walk(children, value, [...ancestors, value], ownPage, depth + 1);
  };
  walk(root.get(PDFName.of('K')), root, [], null, 0);
  if (targets.length !== 1 || targets[0]?.length === 0) return fail();
  // Bind tree traversal to the page's ParentTree entry as well. A visually
  // matching MCID alone is insufficient when the reverse ownership map is bad.
  const parentKey = resolve(page.node.get(PDFName.of('StructParents')));
  if (!(parentKey instanceof PDFNumber)) return fail();
  const mappings: PDFObject[] = [];
  const numberTreeSeen = new Set<PDFDict>();
  const numberTreeKeys = new Set<number>();
  const visitNumberTree = (raw: PDFObject | undefined, depth: number): void => {
    if (depth > 32 || numberTreeSeen.size >= 1_024) return fail();
    const node = resolve(raw);
    if (!(node instanceof PDFDict) || numberTreeSeen.has(node)) return fail();
    numberTreeSeen.add(node);
    const nums = resolve(node.get(PDFName.of('Nums')));
    const kids = resolve(node.get(PDFName.of('Kids')));
    if ((nums === undefined) === (kids === undefined)) return fail();
    if (nums !== undefined) {
      if (!(nums instanceof PDFArray) || nums.size() % 2 !== 0 || nums.size() > 8_192)
        return fail();
      let previous = -1;
      for (let index = 0; index < nums.size(); index += 2) {
        const key = resolve(nums.get(index));
        if (
          !(key instanceof PDFNumber) ||
          !Number.isSafeInteger(key.asNumber()) ||
          key.asNumber() <= previous ||
          numberTreeKeys.has(key.asNumber())
        )
          return fail();
        previous = key.asNumber();
        numberTreeKeys.add(previous);
        if (key.asNumber() === parentKey.asNumber()) mappings.push(nums.get(index + 1));
      }
    } else {
      if (!(kids instanceof PDFArray) || kids.size() === 0 || kids.size() > 1_024) return fail();
      for (const child of kids.asArray()) visitNumberTree(child, depth + 1);
    }
  };
  visitNumberTree(root.get(PDFName.of('ParentTree')), 0);
  const mapping = mappings.length === 1 ? resolve(mappings[0]) : undefined;
  if (
    !(mapping instanceof PDFArray) ||
    change.markedContentId >= mapping.size() ||
    resolve(mapping.get(change.markedContentId)) !== targets[0]?.at(-1)
  )
    return fail();
  const updates: PDFDict[] = [];
  for (const ancestor of targets[0] ?? fail()) {
    // Alt can override spoken content; there is no reliable automatic correction
    // contract for arbitrary alternative descriptions in this bounded path.
    if (ancestor.has(PDFName.of('Alt'))) return fail();
    const actual = resolve(ancestor.get(PDFName.of('ActualText')));
    if (actual === undefined) continue;
    if (
      !(actual instanceof PDFString || actual instanceof PDFHexString) ||
      contentCounts.get(ancestor) !== 1 ||
      actual.decodeText() !== change.expectedText
    )
      return fail();
    updates.push(ancestor);
  }
  for (const node of updates)
    node.set(PDFName.of('ActualText'), PDFHexString.fromText(change.replacementText));
};
