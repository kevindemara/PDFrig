import type { Metadata } from 'next';

import { PublicPage, PublicSection } from '@pdfmason/ui';

import { getPublicSite } from '../../lib/public-site';

export const metadata: Metadata = {
  description: 'PDFrig help for local PDF workflows, cloud processing, accounts, and Windows.',
  title: 'PDFrig Help',
};

const helpTopics = [
  [
    'Select source text',
    'Choose Select text above the page, then drag to select. Focus the text layer and use Ctrl+A/Ctrl+C to copy the current page. Scans need OCR; Add text creates overlays, not edits to original text.',
    'VIEW-008',
    '/workspace',
  ],
  ['Start locally', 'Open a PDF without an account or upload.', 'VIEW-001', '/get-started'],
  [
    'Organize pages',
    'Combine, split, reorder, rotate, extract, and insert safely.',
    'ORG-001',
    '/workspace',
  ],
  [
    'Fill & sign',
    'Fill supported fields and add a visual—not certificate-backed—signature.',
    'FORM-001',
    '/workspace',
  ],
  [
    'Protect a copy',
    'Add an open password or remove supported encryption with authorization.',
    'SEC-001',
    '/tools',
  ],
  [
    'Add repeating page marks',
    'Choose page ranges, build an actual-PDF preview, compare text-area and margin warnings, then inspect and download the reviewed copy.',
    'EDIT-006',
    '/tools',
  ],
  [
    'Number pages',
    'Match logical and visible page labels, or add a Bates sequence and local report. Clipped identifiers stop safely; inspect the exported copy for overlap.',
    'ORG-011',
    '/tools',
  ],
  [
    'Crop or normalize pages',
    'Measure page boxes, crop visible margins, or fit/fill mixed pages into a standard size.',
    'ORG-009',
    '/tools',
  ],
  [
    'Add a review stamp',
    'Place a built-in or custom text stamp locally; optional saved stamps stay on this device.',
    'ANNO-006',
    '/workspace',
  ],
  [
    'Review and export comments',
    'Filter local comments, change open/resolved status, and save a private JSON summary.',
    'ANNO-007',
    '/workspace',
  ],
  [
    'Measure a calibrated page',
    'Set a known reference, then check distance or rectangular area/perimeter with session-only guides.',
    'ANNO-008',
    '/workspace',
  ],
  [
    'Cloud beta tools',
    'Understand consent, quotas, retention, and beta limits before upload.',
    'OCR-001',
    '/retention',
  ],
  [
    'Windows alpha',
    'Native open/save, recent-file opt-in, offline grace, and safe updates.',
    'VIEW-001',
    '/known-limitations',
  ],
] as const;

export default function HelpPage() {
  const { footer, links } = getPublicSite();
  return (
    <PublicPage
      {...footer}
      eyebrow="PDFrig Help"
      introduction="Start with the job you are trying to finish. Help stays specific about processing location, output changes, and what is not supported yet."
      links={links}
      title="Clear answers, without asking for your PDF."
    >
      <PublicSection title="Choose a starting point.">
        <div className="help-grid">
          {helpTopics.map(([title, description, featureId, href]) => (
            <article className="help-card" key={title}>
              <p className="feature-reference">{featureId}</p>
              <h3>{title}</h3>
              <p>{description}</p>
              <a href={href}>Open guide</a>
            </article>
          ))}
        </div>
      </PublicSection>
      <PublicSection eyebrow="Safe support" title="Begin with content-free diagnostics.">
        <p>
          Use an error code and request ID when available. Do not send document text, filenames,
          passwords, signatures, signed URLs, or the file itself through ordinary support.
        </p>
        <p>
          <a href={links.support}>Contact support</a> or review the{' '}
          <a href={links.knownLimits}>known limitations</a> first.
        </p>
      </PublicSection>
    </PublicPage>
  );
}
