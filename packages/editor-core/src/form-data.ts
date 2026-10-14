import type { EditorDocumentState, FormFieldType, FormValue } from './document-state.js';
import type { EditorCommand } from './session.js';

/** FORM-003: content-bearing, session-only JSON. Never send this data to telemetry. */
export const FORM_DATA_LIMITS = Object.freeze({ maximumBytes: 1_048_576, maximumFields: 500 });

export interface FormDataFieldDefinition {
  readonly fieldName: string;
  readonly type: FormFieldType;
  readonly readOnly: boolean;
  readonly maximumLength?: number;
  readonly options: readonly { readonly value: string }[];
}

export interface FormDataEntry {
  readonly fieldName: string;
  readonly type: FormFieldType;
  readonly value: boolean | string;
}

export interface FormDataReport {
  readonly schema: 'pdfmason.form-data';
  readonly version: 1;
  readonly fields: readonly FormDataEntry[];
}

const invalid = (): never => {
  // Do not propagate JSON parser messages, field names, or values into an error.
  throw new Error('FORM_DATA_INVALID');
};
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

/** Exact shared schema; rejects unknown keys and does not coerce or silently trim values. */
export const parseFormData = (input: unknown): FormDataReport => {
  if (
    !record(input) ||
    !exactKeys(input, ['schema', 'version', 'fields']) ||
    input.schema !== 'pdfmason.form-data' ||
    input.version !== 1 ||
    !Array.isArray(input.fields) ||
    input.fields.length < 1 ||
    input.fields.length > FORM_DATA_LIMITS.maximumFields
  )
    return invalid();
  const names = new Set<string>();
  const fields = input.fields.map((entry: unknown): FormDataEntry => {
    if (
      !record(entry) ||
      !exactKeys(entry, ['fieldName', 'type', 'value']) ||
      typeof entry.fieldName !== 'string' ||
      entry.fieldName.length < 1 ||
      entry.fieldName.length > 512 ||
      /\p{Cc}/u.test(entry.fieldName) ||
      names.has(entry.fieldName) ||
      typeof entry.type !== 'string' ||
      !['checkbox', 'dropdown', 'radio', 'text'].includes(entry.type) ||
      (entry.type === 'checkbox'
        ? typeof entry.value !== 'boolean'
        : typeof entry.value !== 'string' ||
          entry.value.length > 2_000 ||
          /\p{Cc}/u.test(entry.value.replace(/[\t\n\r]/gu, '')))
    )
      return invalid();
    names.add(entry.fieldName);
    return Object.freeze({
      fieldName: entry.fieldName,
      type: entry.type as FormFieldType,
      value: entry.value as boolean | string,
    });
  });
  return Object.freeze({ schema: 'pdfmason.form-data', version: 1, fields: Object.freeze(fields) });
};

export const parseFormDataBytes = (bytes: Uint8Array): FormDataReport => {
  if (bytes.byteLength === 0 || bytes.byteLength > FORM_DATA_LIMITS.maximumBytes) return invalid();
  try {
    const input: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return parseFormData(input);
  } catch {
    return invalid();
  }
};

const definitionsByName = (definitions: readonly FormDataFieldDefinition[]) => {
  if (definitions.length > 5_000) return invalid();
  const fields = new Map<string, FormDataFieldDefinition>();
  for (const definition of definitions) {
    const previous = fields.get(definition.fieldName);
    if (
      previous !== undefined &&
      (previous.type !== definition.type ||
        previous.readOnly !== definition.readOnly ||
        previous.maximumLength !== definition.maximumLength)
    )
      return invalid();
    fields.set(definition.fieldName, {
      ...definition,
      options: [...(previous?.options ?? []), ...definition.options],
    });
  }
  return fields;
};

export const validateFormDataForFields = (
  input: unknown,
  definitions: readonly FormDataFieldDefinition[],
): FormDataReport => {
  const report = parseFormData(input);
  const fields = definitionsByName(definitions);
  for (const entry of report.fields) {
    const field = fields.get(entry.fieldName);
    if (
      field === undefined ||
      field.readOnly ||
      field.type !== entry.type ||
      ((entry.type === 'dropdown' || entry.type === 'radio') &&
        entry.value !== '' &&
        !field.options.some(({ value }) => value === entry.value)) ||
      (entry.type === 'text' &&
        typeof entry.value === 'string' &&
        field.maximumLength !== undefined &&
        entry.value.length > field.maximumLength)
    )
      return invalid();
  }
  return report;
};

export const exportFormDataBytes = (
  definitions: readonly FormDataFieldDefinition[],
  values: readonly FormValue[],
  sourceId: string,
): Uint8Array => {
  const fields = definitionsByName(definitions);
  const report = validateFormDataForFields(
    {
      schema: 'pdfmason.form-data',
      version: 1,
      fields: values
        .filter(
          (value) => value.sourceId === sourceId && fields.get(value.fieldName)?.readOnly === false,
        )
        .map(({ fieldName, type, value }) => ({ fieldName, type, value }))
        .sort((left, right) =>
          left.fieldName < right.fieldName ? -1 : left.fieldName > right.fieldName ? 1 : 0,
        ),
    },
    definitions,
  );
  const bytes = new TextEncoder().encode(`${JSON.stringify(report, null, 2)}\n`);
  if (bytes.byteLength > FORM_DATA_LIMITS.maximumBytes) return invalid();
  return bytes;
};

/** All validation precedes the command; one undo restores every changed field. */
export const importFormDataCommand = (
  before: EditorDocumentState,
  input: unknown,
  definitions: readonly FormDataFieldDefinition[],
  sourceId: string,
): EditorCommand<EditorDocumentState> => {
  if (!before.pageGraph.pages.some((page) => page.sourceId === sourceId)) return invalid();
  const report = validateFormDataForFields(input, definitions);
  const names = new Set(report.fields.map(({ fieldName }) => fieldName));
  const next = {
    ...before,
    formValues: Object.freeze([
      ...before.formValues.filter(
        (value) => value.sourceId !== sourceId || !names.has(value.fieldName),
      ),
      ...report.fields.map((entry) => Object.freeze({ ...entry, sourceId })),
    ]),
  };
  return { id: 'forms.data.import', version: 1, apply: () => next, revert: () => before };
};
