import { AccountDashboard } from '@pdfmason/ui';
import { parsePublicConfig } from '@pdfmason/config/public';

import { resolvePrincipal } from '../../lib/auth';
import { getCloudService } from '../../lib/cloud/service';
import { AuthPanel } from './auth-panel';

export default async function AccountPage() {
  const publicConfig = parsePublicConfig(process.env);
  const principal = await resolvePrincipal();
  if (principal === null) {
    return (
      <AuthPanel
        applicationUrl={publicConfig.applicationUrl}
        authEnabled={publicConfig.auth.enabled}
      />
    );
  }
  const snapshot = await getCloudService().getAccount(principal);
  return <AccountDashboard initialSnapshot={snapshot} workspaceHref="/workspace" />;
}
