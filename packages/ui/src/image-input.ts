import type { SupportedImageMimeType } from '@pdfmason/pdf-engine/browser';

export const supportedImageMimeType = (file: File): SupportedImageMimeType | null => {
  if (file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'image/webp') {
    return file.type;
  }
  const extension = /\.(jpe?g|png|webp)$/u.exec(file.name.toLowerCase())?.[1];
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  return null;
};
