import {
  deletePageCommand,
  duplicatePageCommand,
  insertPagesCommand,
  movePageCommand,
  rotatePageCommand,
  type PageGraph,
  type PageNode,
  type QuarterTurn,
} from './page-graph.js';
import type { EditorCommand } from './session.js';
import {
  parsePageMeasurement,
  rotatePageMeasurement,
  type PageMeasurement,
} from './measurement.js';

export interface NormalizedPoint {
  readonly x: number;
  readonly y: number;
}

export interface NormalizedRect extends NormalizedPoint {
  readonly height: number;
  readonly width: number;
}

interface AnnotationBase {
  readonly id: string;
  readonly pageId: string;
  readonly rect: NormalizedRect;
}

export interface TextAnnotation extends AnnotationBase {
  readonly alignment: 'center' | 'left' | 'right';
  readonly color: string;
  readonly fontSize: number;
  readonly kind: 'text';
  readonly text: string;
  readonly variant: 'box' | 'callout' | 'plain';
}

export interface MarkupAnnotation extends AnnotationBase {
  readonly color: string;
  readonly kind: 'markup';
  readonly opacity: number;
  readonly style: 'highlight' | 'strikeout' | 'underline';
}

export interface InkAnnotation extends AnnotationBase {
  readonly color: string;
  readonly kind: 'ink';
  readonly points: readonly NormalizedPoint[];
  readonly strokeWidth: number;
}

export interface ShapeAnnotation extends AnnotationBase {
  readonly fillColor: string | null;
  readonly from?: NormalizedPoint;
  readonly kind: 'shape';
  readonly shape: 'arrow' | 'ellipse' | 'line' | 'rectangle';
  readonly strokeColor: string;
  readonly strokeWidth: number;
  readonly to?: NormalizedPoint;
}

export interface CommentAnnotation extends AnnotationBase {
  readonly author: string;
  readonly color: string;
  readonly createdAt: string;
  readonly kind: 'comment';
  readonly status: 'open' | 'resolved';
  readonly text: string;
}

export interface StampAnnotation extends AnnotationBase {
  readonly color: string;
  readonly kind: 'stamp';
  readonly source: 'built-in' | 'custom';
  readonly text: string;
}

export type VisualSignatureAppearance =
  | {
      readonly color: string;
      readonly kind: 'drawn';
      readonly points: readonly NormalizedPoint[];
    }
  | {
      readonly bytes: Uint8Array;
      readonly kind: 'image';
      readonly mimeType: 'image/jpeg' | 'image/png';
    }
  | {
      readonly color: string;
      readonly kind: 'typed';
      readonly text: string;
    };

export interface VisualSignatureAnnotation extends AnnotationBase {
  readonly appearance: VisualSignatureAppearance;
  readonly kind: 'visual-signature';
  readonly label: 'initials' | 'signature';
}

export interface UtilityMarkAnnotation extends AnnotationBase {
  readonly color: string;
  readonly kind: 'utility-mark';
  readonly mark: 'checkmark' | 'date';
  readonly text: string;
}

export type EditorAnnotation =
  | CommentAnnotation
  | InkAnnotation
  | MarkupAnnotation
  | ShapeAnnotation
  | StampAnnotation
  | TextAnnotation
  | UtilityMarkAnnotation
  | VisualSignatureAnnotation;

export type FormFieldType = 'checkbox' | 'dropdown' | 'radio' | 'text';

export interface FormValue {
  readonly fieldName: string;
  readonly sourceId: string;
  readonly type: FormFieldType;
  readonly value: boolean | string;
}

export interface EditorDocumentState {
  readonly measurements: readonly PageMeasurement[];
  readonly annotations: readonly EditorAnnotation[];
  readonly formValues: readonly FormValue[];
  readonly pageGraph: PageGraph;
}

const roundUnit = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
const clampUnit = (value: number): number => roundUnit(Math.max(0, Math.min(1, value)));

export const normalizePoint = (point: NormalizedPoint): NormalizedPoint =>
  Object.freeze({ x: clampUnit(point.x), y: clampUnit(point.y) });

export const normalizeRect = (rect: NormalizedRect): NormalizedRect => {
  const x = clampUnit(rect.x);
  const y = clampUnit(rect.y);
  return Object.freeze({
    height: roundUnit(Math.max(0.002, Math.min(1 - y, rect.height))),
    width: roundUnit(Math.max(0.002, Math.min(1 - x, rect.width))),
    x,
    y,
  });
};

const transformPointBetweenRects = (
  point: NormalizedPoint,
  before: NormalizedRect,
  after: NormalizedRect,
): NormalizedPoint =>
  normalizePoint({
    x: after.x + ((point.x - before.x) / before.width) * after.width,
    y: after.y + ((point.y - before.y) / before.height) * after.height,
  });

export const transformAnnotationRect = (
  annotation: EditorAnnotation,
  rect: NormalizedRect,
): EditorAnnotation => {
  const nextRect = normalizeRect(rect);
  if (annotation.kind === 'ink') {
    return {
      ...annotation,
      points: annotation.points.map((point) =>
        transformPointBetweenRects(point, annotation.rect, nextRect),
      ),
      rect: nextRect,
    };
  }
  if (annotation.kind === 'shape' && annotation.from !== undefined && annotation.to !== undefined) {
    return {
      ...annotation,
      from: transformPointBetweenRects(annotation.from, annotation.rect, nextRect),
      rect: nextRect,
      to: transformPointBetweenRects(annotation.to, annotation.rect, nextRect),
    };
  }
  // SIGN-001: drawn appearance points are relative to the signature box, unlike ink.
  // Moving/resizing its page rectangle must not transform the relative points again.
  return { ...annotation, rect: nextRect };
};

export const rotateNormalizedPoint = (
  point: NormalizedPoint,
  rotation: Exclude<QuarterTurn, 0>,
): NormalizedPoint => {
  if (rotation === 90) return normalizePoint({ x: 1 - point.y, y: point.x });
  if (rotation === 180) return normalizePoint({ x: 1 - point.x, y: 1 - point.y });
  return normalizePoint({ x: point.y, y: 1 - point.x });
};

export const rotateNormalizedRect = (
  rect: NormalizedRect,
  rotation: Exclude<QuarterTurn, 0>,
): NormalizedRect => {
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  ].map((point) => rotateNormalizedPoint(point, rotation));
  const xs = corners.map(({ x }) => x);
  const ys = corners.map(({ y }) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return normalizeRect({
    height: Math.max(...ys) - y,
    width: Math.max(...xs) - x,
    x,
    y,
  });
};

const freezeAnnotation = (annotation: EditorAnnotation): EditorAnnotation => {
  const rect = normalizeRect(annotation.rect);
  if (annotation.kind === 'ink') {
    return Object.freeze({
      ...annotation,
      points: Object.freeze(annotation.points.map(normalizePoint)),
      rect,
    });
  }
  if (annotation.kind === 'shape') {
    return Object.freeze({
      ...annotation,
      ...(annotation.from === undefined ? {} : { from: normalizePoint(annotation.from) }),
      rect,
      ...(annotation.to === undefined ? {} : { to: normalizePoint(annotation.to) }),
    });
  }
  if (annotation.kind === 'visual-signature' && annotation.appearance.kind === 'drawn') {
    return Object.freeze({
      ...annotation,
      appearance: Object.freeze({
        ...annotation.appearance,
        points: Object.freeze(annotation.appearance.points.map(normalizePoint)),
      }),
      rect,
    });
  }
  return Object.freeze({ ...annotation, rect });
};

const freezeState = (state: EditorDocumentState): EditorDocumentState =>
  Object.freeze({
    measurements: Object.freeze(state.measurements.map(parsePageMeasurement)),
    annotations: Object.freeze(state.annotations.map(freezeAnnotation)),
    formValues: Object.freeze(state.formValues.map((value) => Object.freeze({ ...value }))),
    pageGraph: state.pageGraph,
  });

export const createInitialEditorDocument = (
  pageGraph: PageGraph,
  formValues: readonly FormValue[] = [],
): EditorDocumentState => freezeState({ annotations: [], measurements: [], formValues, pageGraph });

const createEditorCommand = (
  id: string,
  before: EditorDocumentState,
  update: (state: EditorDocumentState) => EditorDocumentState,
): EditorCommand<EditorDocumentState> => {
  const after = freezeState(update(before));
  return Object.freeze({
    apply: () => after,
    id,
    revert: () => before,
    version: 1,
  });
};

export const addAnnotationCommand = (
  before: EditorDocumentState,
  annotation: EditorAnnotation,
): EditorCommand<EditorDocumentState> =>
  createEditorCommand(`annotation.add.${annotation.id}`, before, (state) => ({
    ...state,
    annotations: [...state.annotations, annotation],
  }));

export const updateAnnotationCommand = (
  before: EditorDocumentState,
  annotation: EditorAnnotation,
): EditorCommand<EditorDocumentState> =>
  createEditorCommand(`annotation.update.${annotation.id}`, before, (state) => {
    if (!state.annotations.some(({ id }) => id === annotation.id)) {
      throw new Error('The selected annotation no longer exists.');
    }
    return {
      ...state,
      annotations: state.annotations.map((current) =>
        current.id === annotation.id ? annotation : current,
      ),
    };
  });

export const deleteAnnotationCommand = (
  before: EditorDocumentState,
  annotationId: string,
): EditorCommand<EditorDocumentState> =>
  createEditorCommand(`annotation.delete.${annotationId}`, before, (state) => ({
    ...state,
    annotations: state.annotations.filter(({ id }) => id !== annotationId),
  }));

const squaredDistanceToSegment = (
  point: NormalizedPoint,
  start: NormalizedPoint,
  end: NormalizedPoint,
): number => {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (lengthSquared === 0) return (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
  const projection = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) / lengthSquared),
  );
  const closestX = start.x + projection * segmentX;
  const closestY = start.y + projection * segmentY;
  return (point.x - closestX) ** 2 + (point.y - closestY) ** 2;
};

const resamplePolyline = (
  points: readonly NormalizedPoint[],
  maximumStep: number,
): readonly NormalizedPoint[] => {
  const first = points[0];
  if (first === undefined) return [];
  const samples: NormalizedPoint[] = [normalizePoint(first)];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (start === undefined || end === undefined) continue;
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const steps = Math.max(1, Math.ceil(distance / maximumStep));
    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps;
      samples.push(
        normalizePoint({
          x: start.x + (end.x - start.x) * progress,
          y: start.y + (end.y - start.y) * progress,
        }),
      );
    }
  }
  return samples;
};

const inkBounds = (points: readonly NormalizedPoint[]): NormalizedRect => {
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const minimumX = Math.min(...xs);
  const minimumY = Math.min(...ys);
  const width = Math.max(...xs) - minimumX;
  const height = Math.max(...ys) - minimumY;
  return normalizeRect({
    height,
    width,
    x: minimumX - Math.max(0, 0.002 - width) / 2,
    y: minimumY - Math.max(0, 0.002 - height) / 2,
  });
};

const eraseInkAnnotation = (
  annotation: InkAnnotation,
  eraserPoints: readonly NormalizedPoint[],
  radius: number,
  createAnnotationId: () => string,
): readonly InkAnnotation[] | null => {
  const samples = resamplePolyline(annotation.points, radius / 2);
  const firstEraserPoint = eraserPoints[0];
  if (firstEraserPoint === undefined) return null;
  const eraserSegments: readonly (readonly [NormalizedPoint, NormalizedPoint])[] =
    eraserPoints.length === 1
      ? [[firstEraserPoint, firstEraserPoint]]
      : eraserPoints.slice(1).flatMap((end, index) => {
          const start = eraserPoints[index];
          return start === undefined ? [] : ([[start, end]] as const);
        });
  const radiusSquared = radius * radius;
  const erased = samples.map((point) =>
    eraserSegments.some(
      ([start, end]) => squaredDistanceToSegment(point, start, end) <= radiusSquared,
    ),
  );
  if (!erased.some(Boolean)) return null;
  const pointGroups: NormalizedPoint[][] = [];
  let current: NormalizedPoint[] = [];
  samples.forEach((point, index) => {
    if (erased[index]) {
      if (current.length >= 2) pointGroups.push(current);
      current = [];
    } else current.push(point);
  });
  if (current.length >= 2) pointGroups.push(current);
  return pointGroups.map((points, index) => ({
    ...annotation,
    id: index === 0 ? annotation.id : createAnnotationId(),
    points,
    rect: inkBounds(points),
  }));
};

export const eraseInkAnnotationsCommand = (
  before: EditorDocumentState,
  pageId: string,
  eraserPoints: readonly NormalizedPoint[],
  radius: number,
  createAnnotationId: () => string,
): EditorCommand<EditorDocumentState> | null => {
  if (eraserPoints.length === 0 || !Number.isFinite(radius) || radius < 0.001 || radius > 0.25)
    throw new Error('The eraser path or size is outside the supported range.');
  const normalizedEraserPoints = eraserPoints.map(normalizePoint);
  const annotations = before.annotations.flatMap<EditorAnnotation>((annotation) => {
    if (annotation.kind !== 'ink' || annotation.pageId !== pageId) return [annotation];
    const fragments = eraseInkAnnotation(
      annotation,
      normalizedEraserPoints,
      radius,
      createAnnotationId,
    );
    if (fragments === null) return [annotation];
    return fragments;
  });
  const changed =
    annotations.length !== before.annotations.length ||
    annotations.some((annotation, index) => annotation !== before.annotations[index]);
  if (!changed) return null;
  return createEditorCommand(`annotation.erase.${pageId}`, before, (state) => ({
    ...state,
    annotations,
  }));
};

export const setFormValueCommand = (
  before: EditorDocumentState,
  value: FormValue,
): EditorCommand<EditorDocumentState> =>
  createEditorCommand(`form.set.${value.sourceId}.${value.fieldName}`, before, (state) => {
    const formValues = state.formValues.filter(
      (current) => current.sourceId !== value.sourceId || current.fieldName !== value.fieldName,
    );
    return { ...state, formValues: [...formValues, value] };
  });

const liftPageGraph = (
  id: string,
  before: EditorDocumentState,
  command: EditorCommand<PageGraph>,
  annotations: readonly EditorAnnotation[] = before.annotations,
  measurements: readonly PageMeasurement[] = before.measurements,
): EditorCommand<EditorDocumentState> =>
  createEditorCommand(id, before, (state) => ({
    ...state,
    annotations,
    measurements,
    pageGraph: command.apply(state.pageGraph),
  }));

export const moveEditorPageCommand = (
  before: EditorDocumentState,
  pageId: string,
  targetIndex: number,
): EditorCommand<EditorDocumentState> =>
  liftPageGraph(
    `editor.page.move.${pageId}`,
    before,
    movePageCommand(before.pageGraph, pageId, targetIndex),
  );

export const insertEditorPagesCommand = (
  before: EditorDocumentState,
  pages: readonly PageNode[],
  targetIndex: number,
): EditorCommand<EditorDocumentState> =>
  liftPageGraph(
    'editor.page.insert',
    before,
    insertPagesCommand(before.pageGraph, pages, targetIndex),
  );

export const deleteEditorPageCommand = (
  before: EditorDocumentState,
  pageId: string,
): EditorCommand<EditorDocumentState> =>
  liftPageGraph(
    `editor.page.delete.${pageId}`,
    before,
    deletePageCommand(before.pageGraph, pageId),
    before.annotations.filter((annotation) => annotation.pageId !== pageId),
    before.measurements.filter((measurement) => measurement.pageId !== pageId),
  );

export const duplicateEditorPageCommand = (
  before: EditorDocumentState,
  pageId: string,
  duplicateId: string,
  createAnnotationId: () => string,
): EditorCommand<EditorDocumentState> => {
  const duplicates = before.annotations
    .filter((annotation) => annotation.pageId === pageId)
    .map((annotation) => ({ ...annotation, id: createAnnotationId(), pageId: duplicateId }));
  return liftPageGraph(
    `editor.page.duplicate.${pageId}`,
    before,
    duplicatePageCommand(before.pageGraph, pageId, duplicateId),
    [...before.annotations, ...duplicates],
    [
      ...before.measurements,
      ...before.measurements
        .filter((item) => item.pageId === pageId)
        .map((item) => ({ ...item, pageId: duplicateId })),
    ],
  );
};

const rotateAnnotation = (
  annotation: EditorAnnotation,
  pageId: string,
  rotation: Exclude<QuarterTurn, 0>,
): EditorAnnotation => {
  if (annotation.pageId !== pageId) return annotation;
  const rect = rotateNormalizedRect(annotation.rect, rotation);
  if (annotation.kind === 'ink') {
    return {
      ...annotation,
      points: annotation.points.map((point) => rotateNormalizedPoint(point, rotation)),
      rect,
    };
  }
  if (annotation.kind === 'shape') {
    return {
      ...annotation,
      ...(annotation.from === undefined
        ? {}
        : { from: rotateNormalizedPoint(annotation.from, rotation) }),
      rect,
      ...(annotation.to === undefined
        ? {}
        : { to: rotateNormalizedPoint(annotation.to, rotation) }),
    };
  }
  return { ...annotation, rect };
};

export const rotateEditorPageCommand = (
  before: EditorDocumentState,
  pageId: string,
  clockwise: boolean,
): EditorCommand<EditorDocumentState> => {
  const rotation = clockwise ? 90 : 270;
  return liftPageGraph(
    `editor.page.rotate.${pageId}`,
    before,
    rotatePageCommand(before.pageGraph, pageId, clockwise),
    before.annotations.map((annotation) => rotateAnnotation(annotation, pageId, rotation)),
    before.measurements.map((item) =>
      item.pageId === pageId ? rotatePageMeasurement(item, rotation) : item,
    ),
  );
};
