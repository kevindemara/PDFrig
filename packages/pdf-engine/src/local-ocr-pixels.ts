/** Fixed P6 RGB raster: no user image headers, compression or ancillary chunks
 * enter native OCR decoders. This reduces codec exposure; it does not certify
 * the native runtime or remove the unused codecs compiled into it. */
// Tesseract.js scans the first 500 bytes for an EXIF-like byte pattern even
// for PNM. Keep those bytes entirely owned ASCII whitespace, never RGB data.
const prefix = `P6\n${' '.repeat(512)}`;
export function assertOcrPixels(image: Uint8Array): void {
  if (
    !(image instanceof Uint8Array) ||
    image.length < prefix.length + 11 ||
    image.length > 60_000_540 ||
    (typeof SharedArrayBuffer !== 'undefined' && image.buffer instanceof SharedArrayBuffer)
  )
    throw new Error('OCR_IMAGE_FAILED');
  const lineEnd = image.indexOf(10, prefix.length);
  if (lineEnd < prefix.length + 3 || lineEnd > prefix.length + 17)
    throw new Error('OCR_IMAGE_FAILED');
  const headerLength = lineEnd + 5;
  const header = new TextDecoder().decode(image.subarray(0, headerLength));
  if (!header.startsWith(prefix)) throw new Error('OCR_IMAGE_FAILED');
  const match = /^([1-9][0-9]{0,7}) ([1-9][0-9]{0,7})\n255\n$/u.exec(header.slice(prefix.length));
  if (!match) throw new Error('OCR_IMAGE_FAILED');
  const pixels = Number(match[1]) * Number(match[2]);
  if (
    !Number.isSafeInteger(pixels) ||
    pixels > 20_000_000 ||
    image.length !== headerLength + pixels * 3
  )
    throw new Error('OCR_IMAGE_FAILED');
}

export function encodeOcrPixels(
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
  signal: AbortSignal,
): Uint8Array {
  if (signal.aborted) throw new Error('OCR_CANCELLED');
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > 20_000_000
  )
    throw new Error('OCR_PAGE_PIXEL_LIMIT');
  if (rgba.length !== width * height * 4) throw new Error('OCR_IMAGE_FAILED');
  const header = new TextEncoder().encode(`${prefix}${width} ${height}\n255\n`);
  const image = new Uint8Array(header.length + width * height * 3);
  image.set(header);
  for (let source = 0, target = header.length; source < rgba.length; source += 4) {
    // The viewer renders opaque white. Explicit alpha compositing also makes
    // this helper safe if a transparent canvas reaches it in a future change.
    const alpha = (rgba[source + 3] ?? 0) / 255;
    for (let channel = 0; channel < 3; channel++)
      image[target++] = Math.round((rgba[source + channel] ?? 0) * alpha + 255 * (1 - alpha));
  }
  return image;
}
