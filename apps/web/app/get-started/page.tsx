import type { Metadata } from 'next';

import { PublicPage, PublicSection } from '@pdfmason/ui';

import { getPublicSite } from '../../lib/public-site';

export const metadata: Metadata = {
  description: 'Get started with a local PDFrig workflow.',
  title: 'Get started — PDFrig',
};

export default function GetStartedPage() {
  const { footer, links } = getPublicSite();
  return (
    <PublicPage
      {...footer}
      eyebrow="First run"
      introduction="You can complete the common local workflow without creating an account. PDFrig makes a new copy and leaves the original alone."
      links={links}
      title="From PDF to finished copy in three steps."
    >
      <PublicSection title="A small, visible workflow.">
        <ol className="onboarding-grid">
          <li className="onboarding-card">
            <h3>1. Choose a PDF</h3>
            <p>
              The browser reads the file in the current tab. The local 50 MB limit is checked first.
            </p>
          </li>
          <li className="onboarding-card">
            <h3>2. Make careful changes</h3>
            <p>
              Organize pages, add marks, or fill supported fields. Risky structures lock export.
            </p>
          </li>
          <li className="onboarding-card">
            <h3>3. Review and export</h3>
            <p>
              Read the fidelity warning, choose interactive or flattened forms, and save a new copy.
            </p>
          </li>
        </ol>
        <p>
          <a className="button button--primary" href={links.workspace}>
            Start on this device
          </a>
        </p>
      </PublicSection>
      <PublicSection title="Cloud means a separate decision.">
        <p>
          OCR and Office conversion are separate paid betas. When enabled, the action must state why
          cloud processing is required, what leaves the device, and when temporary objects are
          deleted. PDFrig never silently changes a local operation into an upload.
        </p>
      </PublicSection>
    </PublicPage>
  );
}
