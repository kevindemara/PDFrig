import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { createPrintAdapter } from '@pdfmason/editor-core';

import { DEFAULT_UTILITY_FEATURES, UtilityWorkbench, WorkspaceShell } from '@pdfmason/ui';
import '@pdfmason/ui/styles.css';

import { createWindowsPlatformAdapter } from './platform.js';
import { createDesktopAuthClient, parseDesktopAuthConfig } from './auth.js';
import { DesktopAccountControl } from './desktop-account.js';
import { DesktopEntitlementManager, parseDesktopEntitlementConfig } from './entitlement.js';
import { DesktopUpdateManager } from './updates.js';
import { permissionFeatureEnabled } from './permission-feature.js';

const rootElement = document.querySelector('#root');
if (rootElement === null) throw new Error('Desktop root element is missing.');

const createWorker = (): Worker =>
  new Worker(new URL('./pdf.worker.ts', import.meta.url), {
    name: 'pdfmason-local',
    type: 'module',
  });

const platformAdapter = createWindowsPlatformAdapter();
const printAdapter = createPrintAdapter(() => globalThis.print());
const authConfig = parseDesktopAuthConfig(import.meta.env);
const authClient = authConfig === null ? null : createDesktopAuthClient(authConfig);
const entitlementConfig = parseDesktopEntitlementConfig(import.meta.env);
const entitlementManager =
  entitlementConfig === null
    ? null
    : new DesktopEntitlementManager(entitlementConfig, invoke, globalThis.fetch.bind(globalThis));
const updateManager = new DesktopUpdateManager();
const entitlementEnforced = import.meta.env.VITE_PDFMASON_ENTITLEMENT_ENFORCED === 'true';

const DesktopRoot = () => {
  const [desktopAccess, setDesktopAccess] = useState<'checking' | 'locked' | 'ready'>(
    entitlementEnforced ? 'checking' : 'ready',
  );
  const [route, setRoute] = useState(globalThis.location.hash);
  useEffect(() => {
    const update = () => setRoute(globalThis.location.hash);
    globalThis.addEventListener('hashchange', update);
    return () => globalThis.removeEventListener('hashchange', update);
  }, []);
  return route === '#tools' && desktopAccess === 'ready' ? (
    <UtilityWorkbench
      createWorker={createWorker}
      enabledFeatures={{
        ...DEFAULT_UTILITY_FEATURES,
        permissions: permissionFeatureEnabled(
          import.meta.env.DEV,
          import.meta.env.VITE_PDFMASON_PERMISSIONS_ENABLED,
        ),
        text: import.meta.env.DEV || import.meta.env.VITE_PDFMASON_TEXT_ENABLED === 'true',
      }}
      marketingHref="#workspace"
      surface="Windows"
      workspaceHref="#workspace"
    />
  ) : (
    <WorkspaceShell
      accountControl={
        <DesktopAccountControl
          client={authClient}
          config={authConfig}
          entitlementManager={entitlementManager}
          enforceEntitlement={entitlementEnforced}
          onAccessChange={setDesktopAccess}
          updateManager={updateManager}
        />
      }
      commentReviewEnabled={
        import.meta.env.DEV || import.meta.env.VITE_PDFMASON_COMMENT_REVIEW_ENABLED === 'true'
      }
      createWorker={createWorker}
      desktopAccess={desktopAccess}
      measurementEnabled={
        import.meta.env.DEV || import.meta.env.VITE_PDFMASON_MEASUREMENT_ENABLED === 'true'
      }
      marketingHref="#tools"
      platformAdapter={platformAdapter}
      printAdapter={printAdapter}
      redactionEnabled={import.meta.env.VITE_PDFMASON_REDACTION_ENABLED === 'true'}
      stampsEnabled={import.meta.env.DEV || import.meta.env.VITE_PDFMASON_STAMPS_ENABLED === 'true'}
      surface="Windows"
    />
  );
};

createRoot(rootElement).render(
  <StrictMode>
    <DesktopRoot />
  </StrictMode>,
);
