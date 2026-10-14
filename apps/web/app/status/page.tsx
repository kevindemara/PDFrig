import type { Metadata } from 'next';

import { PublicPage, PublicSection } from '@pdfmason/ui';

import { getPublicSite } from '../../lib/public-site';

export const metadata: Metadata = {
  description: 'PDFrig service-status reporting and current monitoring limitations.',
  title: 'Service status — PDFrig',
};

export default function StatusPage() {
  const { config, footer, links } = getPublicSite();
  const local = config.applicationEnvironment === 'development';
  return (
    <PublicPage
      {...footer}
      eyebrow="Service status"
      introduction="This page distinguishes a working local shell from production monitoring. It never infers service health from an unchecked static claim."
      links={links}
      title={local ? 'Local development is ready.' : 'Production status needs live evidence.'}
    >
      <PublicSection title="What this build can truthfully report.">
        <div className="status-grid">
          <article className="status-card">
            <p className="status-card__state">Operational</p>
            <h3>Web shell</h3>
            <p>The route rendered and its content-free status endpoint is available.</p>
          </article>
          <article className="status-card">
            <p className="status-card__state">Local fake</p>
            <h3>Account and cloud control plane</h3>
            <p>Local development is deterministic. It is not evidence of provider uptime.</p>
          </article>
          <article className="status-card">
            <p className="status-card__state">Not connected</p>
            <h3>Production monitoring</h3>
            <p>Alert delivery, public incident updates, and provider probes still need approval.</p>
          </article>
        </div>
        {config.policy.statusPageUrl !== null && (
          <p>
            <a href={config.policy.statusPageUrl}>Open the approved external status service</a>
          </p>
        )}
      </PublicSection>
      <PublicSection title="How incidents will be communicated.">
        <p>
          A production status service must publish the affected surface, start time, safe impact
          description, mitigation state, and resolution without exposing a customer, document,
          object key, request URL, or support ticket. Each alert needs an owner and tested runbook.
        </p>
      </PublicSection>
    </PublicPage>
  );
}
