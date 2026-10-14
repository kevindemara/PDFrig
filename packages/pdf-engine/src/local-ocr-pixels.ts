/** Fixed P6 RGB raster: no user image headers, compression or ancillary chunks
 * enter native OCR decoders. This reduces codec exposure; it does not certify
 * the native runtime or remove the unused codecs compiled into it. */
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
  const header = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`);
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
