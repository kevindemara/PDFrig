import {
  type EditorDocumentState,
  type VisualSignatureAnnotation,
  type VisualSignatureAppearance,
} from './document-state.js';
import type { EditorCommand } from './session.js';

/** SIGN-003: explicit session-only reuse, never a saved asset or identity claim. */
export const SIGNATURE_REPEAT_LIMITS = Object.freeze({
  maximumPages: 20,
  maximumRangeCharacters: 256,
});
const invalid = (): never => {
  throw new Error('SIGNATURE_REPEAT_INVALID');
};

export const signatureRepeatPageIndices = (range: string, pageCount: number): readonly number[] => {
  if (
    !Number.isInteger(pageCount) ||
    pageCount < 1 ||
    pageCount > 500 ||
    range.length === 0 ||
    range.length > SIGNATURE_REPEAT_LIMITS.maximumRangeCharacters
  )
    return invalid();
  const selected = new Set<number>();
  for (const part of range.split(',')) {
    const match = /^\s*([1-9]\d{0,2})\s*(?:-\s*([1-9]\d{0,2})\s*)?$/u.exec(part);
    if (match === null) return invalid();
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start > end || end > pageCount) return invalid();
    for (let number = start; number <= end; number += 1) {
      if (selected.has(number) || selected.size >= SIGNATURE_REPEAT_LIMITS.maximumPages)
        return invalid();
      selected.add(number);
    }
  }
  return Object.freeze([...selected].sort((a, b) => a - b).map((number) => number - 1));
};

const copyAppearance = (appearance: VisualSignatureAppearance): VisualSignatureAppearance => {
  if (appearance.kind === 'image') {
    if (appearance.bytes.byteLength === 0 || appearance.bytes.byteLength > 5 * 1024 * 1024)
      return invalid();
    return Object.freeze({ ...appearance, bytes: appearance.bytes.slice() });
  }
  if (!/^#[0-9a-f]{6}$/iu.test(appearance.color)) return invalid();
  if (appearance.kind === 'typed') {
    if (
      appearance.text.length === 0 ||
      appearance.text.length > 200 ||
      /\p{Cc}/u.test(appearance.text)
    )
      return invalid();
    return Object.freeze({ ...appearance });
  }
  if (
    appearance.points.length < 2 ||
    appearance.points.length > 10_000 ||
    appearance.points.some(
      ({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1,
    )
  )
    return invalid();
  return Object.freeze({
    ...appearance,
    points: Object.freeze(appearance.points.map((point) => Object.freeze({ ...point }))),
  });
};

/** Atomic command; previews use apply() without changing the live session. */
export const repeatVisualSignatureCommand = (
  before: EditorDocumentState,
  signatureId: string,
  destinationPageIds: readonly string[],
  createId: () => string,
): EditorCommand<EditorDocumentState> => {
  const signature = before.annotations.find(
    (annotation): annotation is VisualSignatureAnnotation =>
      annotation.id === signatureId && annotation.kind === 'visual-signature',
  );
  if (
    signature === undefined ||
    !before.pageGraph.pages.some(({ id }) => id === signature.pageId) ||
    destinationPageIds.length === 0 ||
    destinationPageIds.length > SIGNATURE_REPEAT_LIMITS.maximumPages ||
    new Set(destinationPageIds).size !== destinationPageIds.length ||
    before.annotations.length + destinationPageIds.length > 1_000
  )
    return invalid();
  const rect = signature.rect;
  if (
    Object.values(rect).some((value) => !Number.isFinite(value)) ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.width < 0.002 ||
    rect.height < 0.002 ||
    rect.x + rect.width > 1 ||
    rect.y + rect.height > 1
  )
    return invalid();
  const pages = new Set(before.pageGraph.pages.map(({ id }) => id));
  const occupied = new Set(
    before.annotations
      .filter(({ kind }) => kind === 'visual-signature')
      .map(({ pageId }) => pageId),
  );
  if (destinationPageIds.some((id) => !pages.has(id) || occupied.has(id))) return invalid();
  const appearance = copyAppearance(signature.appearance);
  const ids = new Set(before.annotations.map(({ id }) => id));
  const copies = destinationPageIds.map((pageId): VisualSignatureAnnotation => {
    const id = createId();
    if (id.length === 0 || id.length > 100 || ids.has(id)) return invalid();
    ids.add(id);
    return Object.freeze({
      ...signature,
      id,
      pageId,
      appearance,
      rect: Object.freeze({ ...rect }),
    });
  });
  const after = Object.freeze({
    ...before,
    annotations: Object.freeze([...before.annotations, ...copies]),
  });
  return Object.freeze({
    id: 'signatures.visual.repeat',
    version: 1,
    apply: () => after,
    revert: () => before,
  });
};
