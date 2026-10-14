import {
  PublicSiteFooter,
  PublicSiteHeader,
  type PublicSiteFooterProps,
  type PublicSiteLinks,
} from './public-site.js';

export interface MarketingHomeProps {
  readonly footer: Omit<PublicSiteFooterProps, 'links'>;
  readonly links: PublicSiteLinks;
}

const toolGroups = [
  ['Organize', 'Combine, split, and arrange pages.'],
  ['Annotate', 'Add clear notes and visual markup.'],
  ['Fill & Sign', 'Complete forms and add a visual signature.'],
  ['Convert', 'Move between PDFs and common formats.'],
  ['Protect', 'Reduce size and handle sensitive content carefully.'],
] as const;

export const MarketingHome = ({ footer, links }: MarketingHomeProps) => (
  <div className="marketing-page">
    <PublicSiteHeader links={links} />
    <main>
      <section className="hero" id="top">
        <div className="hero__content">
          <p className="eyebrow">A calmer document workspace</p>
          <h1>Build better PDFs.</h1>
          <p className="hero__lede">
            Edit, organize, sign, convert, and protect PDFs without paying for a bloated
            professional suite. Use PDFrig on the web or Windows, with local processing whenever
            practical.
          </p>
          <div className="hero__actions">
            <a className="button button--primary" href={links.workspace}>
              Edit a PDF locally
            </a>
            <a className="button button--secondary" href="#desktop">
              View the Windows app
            </a>
          </div>
          <p className="trust-line">
            <span aria-hidden="true" className="status-dot status-dot--local" />
            Local tools will stay on your device. Cloud tools will be labeled before upload.
          </p>
        </div>

        <div
          aria-label="Measured pages workspace illustration"
          className="measured-pages"
          role="img"
        >
          <span className="measured-pages__rule measured-pages__rule--top" />
          <span className="measured-pages__rule measured-pages__rule--side" />
          <span className="measured-pages__page measured-pages__page--back" />
          <span className="measured-pages__page measured-pages__page--middle" />
          <span className="measured-pages__page measured-pages__page--front">
            <span className="measured-pages__label">Working copy</span>
            <span className="measured-pages__line measured-pages__line--long" />
            <span className="measured-pages__line" />
            <span className="measured-pages__line" />
            <span className="measured-pages__stamp">Original stays unchanged</span>
          </span>
        </div>
      </section>

      <section className="tool-overview" id="tools">
        <div className="section-heading">
          <p className="eyebrow">The PDF workspace</p>
          <h2>Common jobs, grouped by outcome.</h2>
          <p>
            View, organize, annotate, fill, protect, optimize, and convert locally. Beta cloud tools
            remain clearly labelled.
          </p>
        </div>
        <ul className="tool-cards">
          {toolGroups.map(([name, description]) => (
            <li key={name}>
              <span aria-hidden="true" className="tool-cards__index" />
              <h3>{name}</h3>
              <p>{description}</p>
              <span className="planned-label">Available now</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="privacy-band" id="privacy">
        <div>
          <p className="eyebrow eyebrow--light">Private by design</p>
          <h2>Your documents. Your device when possible. Your call.</h2>
        </div>
        <p>
          The viewer, organizer, annotation, form, visual-signature, protection, metadata, image,
          and optimization tools run in your browser without an account or upload. PDFrig shows
          where cloud processing happens before a file leaves your device, and originals are never
          silently overwritten.
        </p>
      </section>

      <section className="desktop-note" id="desktop">
        <span className="desktop-note__badge">Windows shell</span>
        <div>
          <h2>One workspace, two surfaces.</h2>
          <p>
            The Windows application uses the same local PDF workspace as the web, with a
            deny-by-default native command surface.
          </p>
        </div>
        <a className="text-link" href={links.workspace}>
          Open the shared workspace <span aria-hidden="true">→</span>
        </a>
      </section>
    </main>
    <PublicSiteFooter {...footer} links={links} />
  </div>
);
