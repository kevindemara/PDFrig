import { createTableWorkbook } from './table-workbook.js';
import type { TableValue } from './table-extraction.js';
const scope = globalThis as unknown as {
  onmessage:
    | ((
        event: MessageEvent<{
          rows: readonly (readonly TableValue[])[];
          format: 'xlsx' | 'ods';
          header: boolean;
        }>,
      ) => Promise<void>)
    | null;
  postMessage(value: unknown): void;
};
scope.onmessage = async (event) => {
  try {
    const { rows, format, header } = event.data;
    const bytes = await createTableWorkbook(rows, format, header);
    scope.postMessage({ ok: true, bytes });
  } catch {
    scope.postMessage({ ok: false });
  }
};
