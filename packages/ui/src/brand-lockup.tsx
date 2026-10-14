export interface BrandLockupProps {
  readonly compact?: boolean;
}

export const BrandLockup = ({ compact = false }: BrandLockupProps) => (
  <span className={`brand-lockup${compact ? ' brand-lockup--compact' : ''}`}>
    <img
      alt="PDFrig"
      className="brand-lockup__image"
      height={724}
      src="/brand/pdfrig-logo.png"
      width={2172}
    />
  </span>
);
