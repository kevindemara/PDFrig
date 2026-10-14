import type { EditorDocumentState, NormalizedPoint } from './document-state.js';
import type { QuarterTurn } from './page-graph.js';
import type { EditorCommand } from './session.js';

/** ANNO-008: session-only guides, deliberately separate from exported annotations. */
export const MEASUREMENT_UNITS = ['mm', 'cm', 'm', 'in', 'ft'] as const;
export type MeasurementUnit = (typeof MEASUREMENT_UNITS)[number];
export interface MeasurementCalibration {
  readonly start: NormalizedPoint;
  readonly end: NormalizedPoint;
  readonly knownLength: number;
  readonly unit: MeasurementUnit;
}
export interface PageMeasurement {
  readonly pageId: string;
  readonly start: NormalizedPoint;
  readonly end: NormalizedPoint;
  readonly kind: 'distance' | 'rectangle';
  readonly precision: number;
  readonly calibration: MeasurementCalibration | null;
}
export interface MeasurementMetrics {
  readonly width: number;
  readonly height: number;
}
export interface MeasurementResult {
  readonly distance: number;
  readonly perimeter: number;
  readonly area: number;
  readonly unit: MeasurementUnit;
}

const object = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('MEASUREMENT_INVALID');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key)))
    throw new Error('MEASUREMENT_INVALID');
  return record;
};
const boundedNumber = (value: unknown, minimum: number, maximum: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum)
    throw new Error('MEASUREMENT_INVALID');
  return value;
};
const point = (value: unknown): NormalizedPoint => {
  const record = object(value, ['x', 'y']);
  return Object.freeze({ x: boundedNumber(record.x, 0, 1), y: boundedNumber(record.y, 0, 1) });
};

export const parsePageMeasurement = (value: unknown): PageMeasurement => {
  const record = object(value, ['pageId', 'start', 'end', 'kind', 'precision', 'calibration']);
  if (typeof record.pageId !== 'string' || record.pageId.length < 1 || record.pageId.length > 100)
    throw new Error('MEASUREMENT_INVALID');
  if (record.kind !== 'distance' && record.kind !== 'rectangle')
    throw new Error('MEASUREMENT_INVALID');
  const precision = boundedNumber(record.precision, 0, 4);
  if (!Number.isInteger(precision)) throw new Error('MEASUREMENT_INVALID');
  let calibration: MeasurementCalibration | null = null;
  if (record.calibration !== null) {
    const candidate = object(record.calibration, ['start', 'end', 'knownLength', 'unit']);
    const unit = MEASUREMENT_UNITS.find((item) => item === candidate.unit);
    if (unit === undefined) throw new Error('MEASUREMENT_INVALID');
    calibration = Object.freeze({
      start: point(candidate.start),
      end: point(candidate.end),
      unit,
      knownLength: boundedNumber(candidate.knownLength, 0.000001, 1_000_000),
    });
  }
  return Object.freeze({
    pageId: record.pageId,
    kind: record.kind,
    precision,
    calibration,
    start: point(record.start),
    end: point(record.end),
  });
};

export const createPageMeasurement = (pageId: string): PageMeasurement =>
  parsePageMeasurement({
    pageId,
    start: { x: 0.25, y: 0.25 },
    end: { x: 0.75, y: 0.25 },
    kind: 'distance',
    precision: 2,
    calibration: null,
  });

const dimensions = (metrics: MeasurementMetrics): MeasurementMetrics => ({
  width: boundedNumber(metrics.width, 0.001, 10_000_000),
  height: boundedNumber(metrics.height, 0.001, 10_000_000),
});
const length = (
  start: NormalizedPoint,
  end: NormalizedPoint,
  metrics: MeasurementMetrics,
): number => Math.hypot((end.x - start.x) * metrics.width, (end.y - start.y) * metrics.height);

export const calculateMeasurement = (
  input: PageMeasurement,
  rawMetrics: MeasurementMetrics,
): MeasurementResult => {
  const measurement = parsePageMeasurement(input);
  const metrics = dimensions(rawMetrics);
  const calibration = measurement.calibration;
  if (calibration === null) throw new Error('MEASUREMENT_CALIBRATION_REQUIRED');
  const reference = length(calibration.start, calibration.end, metrics);
  // A tiny reference amplifies pointer/scan errors. Require 0.01% of the page diagonal.
  if (reference / Math.hypot(metrics.width, metrics.height) < 0.0001)
    throw new Error('MEASUREMENT_REFERENCE_TOO_SHORT');
  const scale = calibration.knownLength / reference;
  const width = Math.abs(measurement.end.x - measurement.start.x) * metrics.width * scale;
  const height = Math.abs(measurement.end.y - measurement.start.y) * metrics.height * scale;
  const distance = Math.hypot(width, height);
  if (distance === 0 || (measurement.kind === 'rectangle' && (width === 0 || height === 0)))
    throw new Error('MEASUREMENT_EMPTY');
  const perimeter = 2 * (width + height);
  const area = width * height;
  if ([distance, perimeter, area].some((value) => !Number.isFinite(value) || value > 1e12))
    throw new Error('MEASUREMENT_RANGE');
  return Object.freeze({ area, distance, perimeter, unit: calibration.unit });
};

export const calibrateMeasurement = (
  before: PageMeasurement,
  metrics: MeasurementMetrics,
  knownLength: number,
  unit: MeasurementUnit,
): PageMeasurement => {
  const after = parsePageMeasurement({
    ...before,
    calibration: {
      start: before.start,
      end: before.end,
      knownLength,
      unit,
    },
  });
  // Calibrating uses the diagonal A–B even when the current guide is a rectangle.
  calculateMeasurement({ ...after, kind: 'distance' }, metrics);
  return after;
};

export const formatMeasurementValue = (value: number, precision: number): string => {
  boundedNumber(value, 0, 1e12);
  boundedNumber(precision, 0, 4);
  if (!Number.isInteger(precision)) throw new Error('MEASUREMENT_INVALID');
  const quantum = 10 ** -precision;
  return value > 0 && value < quantum ? `<${quantum.toFixed(precision)}` : value.toFixed(precision);
};

export const setPageMeasurementCommand = (
  before: EditorDocumentState,
  candidate: PageMeasurement,
): EditorCommand<EditorDocumentState> => {
  const measurement = parsePageMeasurement(candidate);
  if (!before.pageGraph.pages.some(({ id }) => id === measurement.pageId))
    throw new Error('MEASUREMENT_PAGE_MISSING');
  const after = Object.freeze({
    ...before,
    measurements: Object.freeze([
      ...before.measurements.filter(({ pageId }) => pageId !== measurement.pageId),
      measurement,
    ]),
  });
  return Object.freeze({
    id: `measurement.set.${measurement.pageId}`,
    version: 1,
    apply: () => after,
    revert: () => before,
  });
};

export const rotatePageMeasurement = (
  measurement: PageMeasurement,
  rotation: Exclude<QuarterTurn, 0>,
): PageMeasurement => {
  // Do not quantize coordinates: repeated rotations must not lose calibration precision.
  const rotate = ({ x, y }: NormalizedPoint): NormalizedPoint =>
    rotation === 90
      ? { x: 1 - y, y: x }
      : rotation === 180
        ? { x: 1 - x, y: 1 - y }
        : { x: y, y: 1 - x };
  return parsePageMeasurement({
    ...measurement,
    start: rotate(measurement.start),
    end: rotate(measurement.end),
    calibration:
      measurement.calibration === null
        ? null
        : {
            ...measurement.calibration,
            start: rotate(measurement.calibration.start),
            end: rotate(measurement.calibration.end),
          },
  });
};
