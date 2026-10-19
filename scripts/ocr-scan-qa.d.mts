export function createOcrScanQa(
  png: Uint8Array,
  layout: 'portrait' | 'landscape-crop',
): Promise<Uint8Array>;
export function loadOcrQaCandidate(file: string): Promise<Uint8Array>;
