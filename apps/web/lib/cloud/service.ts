import { parseServerConfig } from '@pdfmason/config/server';

import { FakeCloudService } from './fake-service';
import { ProductionCloudService } from './production-service';
import type { CloudService } from './types';

// SEC-006: dev route compilation can re-evaluate this module. Synthetic metadata
// belongs to the server process, not a module instance. Never cache production clients.
const registry = globalThis as typeof globalThis & {
  __pdfmasonFakeCloudService?: CloudService;
};

export const getCloudService = (): CloudService => {
  if (parseServerConfig(process.env).providerMode !== 'fake') return new ProductionCloudService();
  registry.__pdfmasonFakeCloudService ??= new FakeCloudService();
  return registry.__pdfmasonFakeCloudService;
};
