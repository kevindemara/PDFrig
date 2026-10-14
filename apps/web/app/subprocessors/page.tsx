import type { Metadata } from 'next';

import { PublicPage, PublicSection } from '@pdfmason/ui';

import { getPublicSite } from '../../lib/public-site';

export const metadata: Metadata = {
  description: 'Planned PDFrig subprocessors and their limited purposes.',
  title: 'Subprocessors — PDFrig',
};

export default function SubprocessorsPage() {
  const { config, footer, links } = getPublicSite();
  return (
    <PublicPage
      {...footer}
      eyebrow="Subprocessor register"
      introduction="A provider receives only the data needed for its purpose. This development register is not a data-residency promise or a final production list."
      links={links}
      title="Fewer processors, narrower jobs."
    >
      <PublicSection title="Planned production providers.">
        <table className="policy-table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Purpose</th>
              <th>Document handling</th>
              <th>Approval state</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Supabase</td>
              <td>Authentication and PostgreSQL account/job metadata</td>
              <td>Document bytes and PDF passwords do not belong in the database</td>
              <td>Architecture selected; production project and region pending</td>
            </tr>
            <tr>
              <td>Cloudflare R2</td>
              <td>Private, short-lived processing objects</td>
              <td>Opaque keys, explicit upload consent, short retention</td>
              <td>Architecture selected; production bucket/region pending</td>
            </tr>
            <tr>
              <td>Stripe</td>
              <td>Hosted checkout, billing, invoices, and customer portal</td>
              <td>No PDF content; payment details stay on hosted Stripe surfaces</td>
              <td>Test integration exists; live tax/catalogue approval pending</td>
            </tr>
            <tr>
              <td>Hosting, email/support, monitoring</td>
              <td>Web delivery, transactional communication, support, incidents</td>
              <td>Must use content-free schemas; no ordinary document attachment flow</td>
              <td>Provider selection and contracts pending</td>
            </tr>
          </tbody>
        </table>
        <p>Current processing-location disclosure: {config.policy.processingLocation}</p>
      </PublicSection>
    </PublicPage>
  );
}
