import { describe, expect, it } from 'vitest';
import {
  createInitialEditorDocument,
  deleteEditorPageCommand,
  duplicateEditorPageCommand,
  rotateEditorPageCommand,
} from './document-state.js';
import { createInitialPageGraph } from './page-graph.js';
import { DocumentSession } from './session.js';
import {
  calculateMeasurement,
  calibrateMeasurement,
  createPageMeasurement,
  formatMeasurementValue,
  parsePageMeasurement,
  rotatePageMeasurement,
  setPageMeasurementCommand,
} from './measurement.js';

const metrics = { width: 600, height: 800 };
const calibrated = () => calibrateMeasurement(createPageMeasurement('page-0'), metrics, 3, 'm');

describe('ANNO-008 calibrated session guides', () => {
  it('requires calibration and calculates distance with the visible page aspect ratio', () => {
    expect(() => calculateMeasurement(createPageMeasurement('page-0'), metrics)).toThrow(
      'CALIBRATION_REQUIRED',
    );
    expect(calculateMeasurement(calibrated(), metrics).distance).toBe(3);
    const diagonal = { ...calibrated(), end: { x: 0.75, y: 0.75 } };
    expect(calculateMeasurement(diagonal, metrics).distance).toBe(5);
    // Uniform viewport/UserUnit changes cancel in the calibration ratio, as does CSS zoom.
    expect(calculateMeasurement(diagonal, { width: 1200, height: 1600 }).distance).toBe(5);
  });

  it('calculates rectangular area/perimeter and is invariant under every quarter turn', () => {
    const original = parsePageMeasurement({
      ...calibrated(),
      kind: 'rectangle',
      end: { x: 0.75, y: 0.75 },
    });
    expect(calculateMeasurement(original, metrics)).toEqual({
      distance: 5,
      perimeter: 14,
      area: 12,
      unit: 'm',
    });
    for (const rotation of [90, 180, 270] as const) {
      const rotated = rotatePageMeasurement(original, rotation);
      const size = rotation === 180 ? metrics : { width: metrics.height, height: metrics.width };
      expect(calculateMeasurement(rotated, size)).toEqual(calculateMeasurement(original, metrics));
    }
  });

  it('validates the exact boundary schema and refuses false precision or degenerate geometry', () => {
    for (const candidate of [
      { ...calibrated(), extra: true },
      { ...calibrated(), precision: 5 },
      { ...calibrated(), precision: 1.5 },
      { ...calibrated(), start: { x: NaN, y: 0 } },
      { ...calibrated(), end: { x: 1.1, y: 0 } },
      { ...calibrated(), calibration: { ...calibrated().calibration, unit: 'yards' } },
    ])
      expect(() => parsePageMeasurement(candidate)).toThrow('MEASUREMENT_INVALID');
    for (const knownLength of [0, -1, NaN, Infinity, 1e7])
      expect(() =>
        calibrateMeasurement(createPageMeasurement('page-0'), metrics, knownLength, 'm'),
      ).toThrow();
    expect(() =>
      calibrateMeasurement(
        { ...createPageMeasurement('page-0'), end: { x: 0.250001, y: 0.25 } },
        metrics,
        1,
        'm',
      ),
    ).toThrow('REFERENCE_TOO_SHORT');
    expect(() => calculateMeasurement({ ...calibrated(), kind: 'rectangle' }, metrics)).toThrow(
      'MEASUREMENT_EMPTY',
    );
    expect(() => calculateMeasurement(calibrated(), { width: Infinity, height: 0 })).toThrow();
    expect(formatMeasurementValue(0.0001, 2)).toBe('<0.01');
    expect(formatMeasurementValue(1.23456, 4)).toBe('1.2346');
    expect(formatMeasurementValue(1.5, 0)).toBe('2');
  });

  it('keeps calibration scoped to page identity with rotation, duplication, deletion, and undo', () => {
    const initial = createInitialEditorDocument(
      createInitialPageGraph('source', 2, (index) => `page-${index}`),
    );
    const session = new DocumentSession({ contentHash: 'synthetic', sourceId: 'source' }, initial);
    session.execute(setPageMeasurementCommand(initial, calibrated()));
    expect(session.snapshot().state.measurements).toHaveLength(1);
    session.execute(rotateEditorPageCommand(session.snapshot().state, 'page-0', true));
    const rotated = session.snapshot().state.measurements[0];
    if (rotated === undefined) throw new Error('Missing synthetic guide');
    expect(calculateMeasurement(rotated, { width: 800, height: 600 }).distance).toBe(3);
    session.execute(
      duplicateEditorPageCommand(session.snapshot().state, 'page-0', 'copy', () => 'unused'),
    );
    expect(session.snapshot().state.measurements.map(({ pageId }) => pageId)).toEqual([
      'page-0',
      'copy',
    ]);
    session.execute(deleteEditorPageCommand(session.snapshot().state, 'page-0'));
    expect(session.snapshot().state.measurements).toHaveLength(1);
    session.undo();
    expect(session.snapshot().state.measurements).toHaveLength(2);
    session.redo();
    expect(session.snapshot().state.measurements).toHaveLength(1);
    expect(initial.measurements).toEqual([]);
    expect(session.snapshot().state.annotations).toEqual([]);
    expect(() =>
      setPageMeasurementCommand(initial, { ...calibrated(), pageId: 'missing' }),
    ).toThrow('PAGE_MISSING');
  });
});
