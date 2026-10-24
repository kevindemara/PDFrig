import { parsePublicConfig } from '@pdfmason/config/public';

import { ToolsClient } from './tools-client';

export default function ToolsPage() {
  const config = parsePublicConfig(process.env);
  return (
    <ToolsClient enabledFeatures={config.utilityFeatures} ocrEnabled={config.utilityFeatures.ocr} />
  );
}
