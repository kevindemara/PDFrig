'use client';

import { UtilityWorkbench } from '@pdfmason/ui';
import type { UtilityId } from '@pdfmason/ui';

const createWorker = (): Worker =>
  new Worker(new URL('./pdf.worker.ts', import.meta.url), {
    name: 'pdfmason-utilities',
    type: 'module',
  });

export const ToolsClient = ({
  enabledFeatures,
  ocrEnabled,
}: {
  readonly enabledFeatures: Readonly<Record<UtilityId, boolean>>;
  readonly ocrEnabled: boolean;
}) => (
  <UtilityWorkbench
    createWorker={createWorker}
    enabledFeatures={enabledFeatures}
    ocrEnabled={ocrEnabled}
    surface="Web"
  />
);
