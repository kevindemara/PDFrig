'use client';

import {
  calculateMeasurement,
  calibrateMeasurement,
  formatMeasurementValue,
  MEASUREMENT_UNITS,
  parsePageMeasurement,
  type MeasurementMetrics,
  type NormalizedPoint,
  type PageMeasurement,
} from '@pdfmason/editor-core';
import { useState, type SyntheticEvent, type PointerEvent as ReactPointerEvent } from 'react';

interface MeasurementPanelProps {
  readonly geometryUnavailable?: boolean;
  readonly measurement: PageMeasurement;
  readonly metrics: MeasurementMetrics | null;
  readonly onChange: (measurement: PageMeasurement) => void;
}

const measurementError = (error: unknown): string => {
  const code = error instanceof Error ? error.message : '';
  if (code === 'MEASUREMENT_CALIBRATION_REQUIRED')
    return 'Set A–B to a known reference, then calibrate this page.';
  if (code === 'MEASUREMENT_REFERENCE_TOO_SHORT')
    return 'The reference is too short. Choose points farther apart and calibrate again.';
  if (code === 'MEASUREMENT_EMPTY')
    return 'Choose two distinct points. A rectangle needs both width and height.';
  if (code === 'MEASUREMENT_RANGE')
    return 'The result exceeds the supported range. Check the reference length and units.';
  return 'Check the coordinates, reference length, and precision. The previous guide is unchanged.';
};

export const MeasurementPanel = ({
  geometryUnavailable = false,
  measurement,
  metrics,
  onChange,
}: MeasurementPanelProps) => {
  const [error, setError] = useState<string | null>(null);
  let result = null;
  let resultMessage = geometryUnavailable
    ? 'Page geometry could not be read safely. Reopen the PDF to try again.'
    : 'Reading page geometry…';
  if (metrics !== null) {
    try {
      result = calculateMeasurement(measurement, metrics);
    } catch (calculationError) {
      resultMessage = measurementError(calculationError);
    }
  }
  const update = (candidate: PageMeasurement): void => {
    try {
      onChange(parsePageMeasurement(candidate));
      setError(null);
    } catch (updateError) {
      setError(measurementError(updateError));
    }
  };
  const applyPoints = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const number = (name: string): number => {
      const value = data.get(name);
      return typeof value === 'string' && value.trim() !== '' ? Number(value) / 100 : NaN;
    };
    update({
      ...measurement,
      start: { x: number('ax'), y: number('ay') },
      end: { x: number('bx'), y: number('by') },
    });
  };
  const calibrate = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (metrics === null) return;
    const data = new FormData(event.currentTarget);
    const unit = MEASUREMENT_UNITS.find((candidate) => candidate === data.get('unit'));
    if (unit === undefined) return;
    try {
      update(calibrateMeasurement(measurement, metrics, Number(data.get('length')), unit));
    } catch (calibrationError) {
      setError(measurementError(calibrationError));
    }
  };
  const calibration = measurement.calibration;
  return (
    <section aria-labelledby="measurement-title" className="measurement-panel">
      <span className="panel-kicker">ANNO-008 · Session guide</span>
      <h3 id="measurement-title">Measure this page</h3>
      <p>
        Drag A–B on the page or enter coordinates. Calibrate a known reference first, then move A–B
        to measure.
      </p>
      <div
        className="measurement-readout"
        role="status"
        aria-live="polite"
        aria-label="Measurement result"
      >
        {result === null ? (
          <p>{resultMessage}</p>
        ) : measurement.kind === 'distance' ? (
          <>
            <span>Distance</span>
            <strong>
              {formatMeasurementValue(result.distance, measurement.precision)}{' '}
              <small>{result.unit}</small>
            </strong>
          </>
        ) : (
          <>
            <span>Rectangle area</span>
            <strong>
              {formatMeasurementValue(result.area, measurement.precision)}{' '}
              <small>{result.unit}²</small>
            </strong>
            <span>
              Perimeter: {formatMeasurementValue(result.perimeter, measurement.precision)}{' '}
              {result.unit}
            </span>
          </>
        )}
      </div>
      <label>
        Guide shape
        <select
          aria-label="Measurement shape"
          value={measurement.kind}
          onChange={(event) =>
            update({
              ...measurement,
              kind: event.target.value === 'rectangle' ? 'rectangle' : 'distance',
            })
          }
        >
          <option value="distance">Straight-line distance</option>
          <option value="rectangle">Rectangle area + perimeter</option>
        </select>
      </label>
      <form
        key={`${measurement.start.x},${measurement.start.y},${measurement.end.x},${measurement.end.y}`}
        onSubmit={applyPoints}
      >
        <fieldset className="measurement-coordinates">
          <legend>A–B coordinates (% of visible page)</legend>
          {(
            [
              ['A', measurement.start],
              ['B', measurement.end],
            ] as const
          ).map(([label, coordinate]) => (
            <div key={label}>
              <span className="measurement-point-label">{label}</span>
              {(['x', 'y'] as const).map((axis) => (
                <label key={axis}>
                  {axis.toUpperCase()} %
                  <input
                    aria-label={`${label} ${axis.toUpperCase()} percent`}
                    defaultValue={Number((coordinate[axis] * 100).toFixed(8))}
                    min="0"
                    max="100"
                    step="any"
                    required
                    type="number"
                    name={`${label.toLowerCase()}${axis}`}
                  />
                </label>
              ))}
            </div>
          ))}
        </fieldset>
        <button type="submit">Apply coordinates</button>
      </form>
      <form
        key={`${calibration?.knownLength ?? ''}:${calibration?.unit ?? ''}`}
        className="measurement-calibration"
        onSubmit={calibrate}
      >
        <fieldset>
          <legend>Page calibration</legend>
          <p>
            A–B is the reference line, including the diagonal in rectangle mode. A single scale
            assumes no scan distortion.
          </p>
          <label>
            Known A–B length
            <input
              name="length"
              defaultValue={calibration?.knownLength ?? 1}
              type="number"
              min="0.000001"
              max="1000000"
              step="any"
              required
            />
          </label>
          <label>
            Reference unit
            <select name="unit" defaultValue={calibration?.unit ?? 'm'}>
              {MEASUREMENT_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <button disabled={metrics === null} type="submit">
          Calibrate from A–B
        </button>
      </form>
      <p className="measurement-scale">
        {calibration === null
          ? 'No calibration applied.'
          : `Applied reference: ${calibration.knownLength} ${calibration.unit}. Dashed line = reference; solid guide = measurement.`}
      </p>
      <label>
        Decimal places
        <select
          value={measurement.precision}
          onChange={(event) => update({ ...measurement, precision: Number(event.target.value) })}
        >
          {[0, 1, 2, 3, 4].map((precision) => (
            <option key={precision} value={precision}>
              {precision}
            </option>
          ))}
        </select>
      </label>
      <small>
        Display precision is not accuracy. Verify dimensions independently. One guide per page,
        session-only; not saved, printed, or included in PDF export.
      </small>
      <button
        disabled={calibration === null}
        onClick={() => update({ ...measurement, calibration: null })}
        type="button"
      >
        Clear calibration
      </button>
      {error !== null && <p role="alert">{error}</p>}
    </section>
  );
};

interface MeasurementOverlayProps {
  readonly measurement: PageMeasurement;
  readonly onChange: (measurement: PageMeasurement) => void;
}
export const MeasurementOverlay = ({ measurement, onChange }: MeasurementOverlayProps) => {
  const [draft, setDraft] = useState<{
    start: NormalizedPoint;
    end: NormalizedPoint;
    pointerId: number;
  } | null>(null);
  const point = (event: ReactPointerEvent<HTMLDivElement>): NormalizedPoint => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  };
  const start = draft?.start ?? measurement.start;
  const end = draft?.end ?? measurement.end;
  return (
    <div
      className="measurement-overlay"
      aria-hidden="true"
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const position = point(event);
        setDraft({ start: position, end: position, pointerId: event.pointerId });
      }}
      onPointerMove={(event) => {
        if (draft?.pointerId === event.pointerId) setDraft({ ...draft, end: point(event) });
      }}
      onPointerCancel={() => setDraft(null)}
      onLostPointerCapture={() => setDraft(null)}
      onPointerUp={(event) => {
        if (draft?.pointerId !== event.pointerId) return;
        onChange(parsePageMeasurement({ ...measurement, start: draft.start, end: point(event) }));
        setDraft(null);
      }}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {measurement.calibration !== null && (
          <line
            className="measurement-reference"
            x1={measurement.calibration.start.x * 100}
            y1={measurement.calibration.start.y * 100}
            x2={measurement.calibration.end.x * 100}
            y2={measurement.calibration.end.y * 100}
          />
        )}
        {measurement.kind === 'distance' ? (
          <line x1={start.x * 100} y1={start.y * 100} x2={end.x * 100} y2={end.y * 100} />
        ) : (
          <rect
            x={Math.min(start.x, end.x) * 100}
            y={Math.min(start.y, end.y) * 100}
            width={Math.abs(start.x - end.x) * 100}
            height={Math.abs(start.y - end.y) * 100}
          />
        )}
      </svg>
      <span style={{ left: `${start.x * 100}%`, top: `${start.y * 100}%` }}>A</span>
      <span style={{ left: `${end.x * 100}%`, top: `${end.y * 100}%` }}>B</span>
    </div>
  );
};
