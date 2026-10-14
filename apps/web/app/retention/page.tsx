import type { Metadata } from 'next';

import { PublicPage, PublicSection } from '@pdfmason/ui';

import { getPublicSite } from '../../lib/public-site';

export const metadata: Metadata = {
  description:
    'PDFrig retention and deletion schedule for local, cloud, account, and billing data.',
  title: 'Retention — PDFrig',
};

export default function RetentionPage() {
  const { config, footer, links } = getPublicSite();
  return (
    <PublicPage
      {...footer}
      eyebrow="Retention statement"
      introduction="Document objects are processing inputs and outputs, not a permanent drive. Application deletion is primary; storage lifecycle is only a safety net."
      links={links}
      title="Short by default. Observable when it matters."
    >
      <PublicSection title="Current default schedule.">
        <table className="policy-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Default</th>
              <th>Control</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Browser-local source and output</td>
              <td>Current session</td>
              <td>User downloads or saves the new copy</td>
            </tr>
            <tr>
              <td>Cloud input</td>
              <td>Delete when no longer needed</td>
              <td>Immediate-delete workflow plus lifecycle backstop</td>
            </tr>
            <tr>
              <td>Cloud output</td>
              <td>{config.policy.retention.outputHours} hour after successful processing</td>
              <td>Delete now remains available until confirmed</td>
            </tr>
            <tr>
              <td>Failed or cancelled job objects</td>
              <td>Delete immediately</td>
              <td>{config.policy.retention.safetyNetHours}-hour maximum lifecycle backstop</td>
            </tr>
            <tr>
              <td>Opt-in job metadata</td>
              <td>{config.policy.retention.historyDays} days</td>
              <td>Content-free fields only; preference can be turned off</td>
            </tr>
            <tr>
              <td>Billing and security records</td>
              <td>Approved legal/security schedule required</td>
              <td>Never used to reconstruct deleted document bytes</td>
            </tr>
          </tbody>
        </table>
      </PublicSection>
      <PublicSection title="Deletion needs proof, not intention.">
        <p>
          The trusted reconciler deletes idempotently, confirms storage absence, retries with
          bounded backoff, marks repeated failures for attention, and looks for orphan objects.
          Production alert delivery and a storage-inventory exercise remain release gates.
        </p>
      </PublicSection>
    </PublicPage>
  );
}
