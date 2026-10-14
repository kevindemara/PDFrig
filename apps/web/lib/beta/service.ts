import { parseServerConfig } from '@pdfmason/config/server';

import { FakeBetaService } from './fake-service';
import type { BetaService } from './types';

const fakeService = new FakeBetaService();

export const getBetaService = (kind: 'analytics' | 'intake'): BetaService | null =>
  parseServerConfig(process.env).betaServices[kind] === 'fake' ? fakeService : null;
