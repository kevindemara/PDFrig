import {
  exportFormDataBytes,
  FORM_DATA_LIMITS,
  parseFormDataBytes,
  validateFormDataForFields,
  type FormDataFieldDefinition,
  type FormDataReport,
  type FormValue,
} from '@pdfmason/editor-core';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';

interface FormDataPanelProps {
  readonly definitions: readonly FormDataFieldDefinition[];
  readonly values: readonly FormValue[];
  readonly sourceId: string;
  readonly onApply: (report: FormDataReport) => void;
  readonly onSave: (bytes: Uint8Array) => Promise<boolean>;
}

/** FORM-003: no persistence, telemetry, network, or raw parser errors. */
export const FormDataPanel = ({
  definitions,
  values,
  sourceId,
  onApply,
  onSave,
}: FormDataPanelProps) => {
  const [pending, setPending] = useState<{
    report: FormDataReport;
    values: readonly FormValue[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const generation = useRef(0);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      generation.current += 1;
    };
  }, []);
  const review = pending?.values === values ? pending.report : null;

  const load = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined) return;
    const request = ++generation.current;
    setPending(null);
    setStatus(null);
    setError(null);
    setBusy(true);
    try {
      if (file.size === 0 || file.size > FORM_DATA_LIMITS.maximumBytes)
        throw new Error('FORM_DATA_INVALID');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const report = validateFormDataForFields(parseFormDataBytes(bytes), definitions);
      if (active.current && generation.current === request) setPending({ report, values });
    } catch {
      if (active.current && generation.current === request)
        setError(
          'This JSON does not match the supported editable fields or exceeds the limits. No values changed.',
        );
    } finally {
      if (active.current && generation.current === request) setBusy(false);
    }
  };
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const saved = await onSave(exportFormDataBytes(definitions, values, sourceId));
      if (active.current)
        setStatus(saved ? 'Form data saved on this device.' : 'Saving cancelled.');
    } catch {
      if (active.current)
        setError('Form data could not be saved. Your PDF and values were not changed.');
    } finally {
      if (active.current) setBusy(false);
    }
  };
  return (
    <section className="property-section form-data-panel" aria-label="Form data">
      <h3>Form data · JSON</h3>
      <p>
        Runs on this device. JSON contains field names and values, which may be sensitive. Keep it
        private.
      </p>
      <p>
        Editable text, checkbox, radio and dropdown fields only. No signatures, read-only fields,
        FDF or XFDF. Up to 500 fields and 1 MiB.
      </p>
      <button disabled={busy} onClick={() => void save()} type="button">
        Export form data
      </button>
      <label className="field-stack">
        Import form data JSON
        <input
          accept=".json,application/json"
          disabled={busy}
          onChange={(event) => void load(event)}
          type="file"
        />
      </label>
      {busy && <p role="status">Preparing form data on this device…</p>}
      {error !== null && <p role="alert">{error}</p>}
      {status !== null && <p role="status">{status}</p>}
      {review !== null && (
        <div className="form-data-review">
          <h4>Review {review.fields.length} field values</h4>
          <p>
            These values replace matching fields only; other fields stay unchanged. Matching names
            do not prove this is the same form. Review before applying. Undo restores all values.
          </p>
          <dl className="form-data-values">
            {review.fields.map(({ fieldName, value }) => (
              <div key={fieldName}>
                <dt>{fieldName}</dt>
                <dd>
                  {typeof value === 'boolean'
                    ? value
                      ? 'Checked'
                      : 'Unchecked'
                    : value === ''
                      ? '(empty)'
                      : value}
                </dd>
              </div>
            ))}
          </dl>
          <button
            onClick={() => {
              try {
                onApply(review);
                setPending(null);
                setStatus('Form data applied. You can undo this change.');
              } catch {
                setPending(null);
                setError('Import stopped safely. No values changed.');
              }
            }}
            type="button"
          >
            Apply reviewed form data
          </button>
          <button
            onClick={() => {
              setPending(null);
              setStatus('Import cancelled. No values changed.');
            }}
            type="button"
          >
            Cancel import
          </button>
        </div>
      )}
    </section>
  );
};
