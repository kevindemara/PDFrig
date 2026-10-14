import { parsePublicConfig } from '@pdfmason/config/public';
import { parseServerConfig } from '@pdfmason/config/server';

import { safeJson } from '../../../../lib/api';

export function GET() {
  const publicConfig = parsePublicConfig(process.env);
  const serverConfig = parseServerConfig(process.env);
  const local = publicConfig.applicationEnvironment === 'development';
  return safeJson({
    checkedAt: new Date().toISOString(),
    components: [
      { name: 'Web application', state: 'operational' },
      {
        name: 'Account and cloud providers',
        state: serverConfig.providerMode === 'fake' ? 'local_fake' : 'configured',
      },
      {
        name: 'Optional analytics',
        state: serverConfig.betaServices.analytics === 'fake' ? 'local_fake' : 'disabled',
      },
      {
        name: 'Support intake',
        state: serverConfig.betaServices.intake === 'fake' ? 'local_fake' : 'disabled',
      },
    ],
    environment: publicConfig.applicationEnvironment,
    report: local ? 'local-development' : 'configuration-only',
  });
}
