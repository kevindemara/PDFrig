// VIEW-003: fit the complete page, not a fixed percentage or width-only crop.
export const fitPageScale = (
  pageWidth: number,
  pageHeight: number,
  availableWidth: number,
  availableHeight: number,
): number | null => {
  if (
    ![pageWidth, pageHeight, availableWidth, availableHeight].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    return null;
  const scale = Math.min(2.5, availableWidth / pageWidth, availableHeight / pageHeight);
  return Math.max(0.01, Math.floor(scale * 1000) / 1000);
};
