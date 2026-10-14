export type SupportedImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ImageSource {
  readonly bytes: Uint8Array;
  readonly mimeType: SupportedImageMimeType;
}

export interface InspectedImage {
  readonly encodedHeight: number;
  readonly encodedWidth: number;
  readonly orientation: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  readonly orientationValueOffset: number | null;
  readonly orientationValueOrder: 'big' | 'little' | null;
}

export interface NormalizedImage {
  readonly bytes: Uint8Array;
  readonly height: number;
  readonly mimeType: 'image/jpeg' | 'image/png';
  readonly width: number;
}

const maximumImagePixels = 20_000_000;
const maximumNormalizedBytes = 50 * 1024 * 1024;

const ascii = (bytes: Uint8Array, offset: number, value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
};

const uint16 = (bytes: Uint8Array, offset: number, littleEndian: boolean): number | null => {
  if (offset < 0 || offset + 2 > bytes.byteLength) return null;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(
    offset,
    littleEndian,
  );
};

const uint24LittleEndian = (bytes: Uint8Array, offset: number): number | null => {
  if (offset < 0 || offset + 3 > bytes.byteLength) return null;
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
};

const uint32 = (bytes: Uint8Array, offset: number, littleEndian: boolean): number | null => {
  if (offset < 0 || offset + 4 > bytes.byteLength) return null;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    offset,
    littleEndian,
  );
};

const orientationFromTiff = (
  bytes: Uint8Array,
  tiffOffset: number,
  tiffLength: number,
): Pick<InspectedImage, 'orientation' | 'orientationValueOffset' | 'orientationValueOrder'> => {
  const tiffEnd = tiffOffset + tiffLength;
  if (tiffOffset < 0 || tiffLength < 8 || tiffEnd > bytes.byteLength) {
    return { orientation: 1, orientationValueOffset: null, orientationValueOrder: null };
  }
  const littleEndian = ascii(bytes, tiffOffset, 'II');
  if (!littleEndian && !ascii(bytes, tiffOffset, 'MM')) {
    return { orientation: 1, orientationValueOffset: null, orientationValueOrder: null };
  }
  if (uint16(bytes, tiffOffset + 2, littleEndian) !== 42) {
    return { orientation: 1, orientationValueOffset: null, orientationValueOrder: null };
  }
  const firstIfdRelative = uint32(bytes, tiffOffset + 4, littleEndian);
  if (firstIfdRelative === null) {
    return { orientation: 1, orientationValueOffset: null, orientationValueOrder: null };
  }
  const firstIfd = tiffOffset + firstIfdRelative;
  const entryCount = uint16(bytes, firstIfd, littleEndian);
  if (entryCount === null || firstIfd + 2 + entryCount * 12 > tiffEnd) {
    return { orientation: 1, orientationValueOffset: null, orientationValueOrder: null };
  }
  for (let index = 0; index < entryCount; index += 1) {
    const entry = firstIfd + 2 + index * 12;
    const tag = uint16(bytes, entry, littleEndian);
    const type = uint16(bytes, entry + 2, littleEndian);
    const count = uint32(bytes, entry + 4, littleEndian);
    if (tag !== 0x0112 || type !== 3 || count !== 1) continue;
    const valueOffset = entry + 8;
    const value = uint16(bytes, valueOffset, littleEndian);
    if (value !== null && value >= 1 && value <= 8) {
      return {
        orientation: value as InspectedImage['orientation'],
        orientationValueOffset: valueOffset,
        orientationValueOrder: littleEndian ? 'little' : 'big',
      };
    }
  }
  return { orientation: 1, orientationValueOffset: null, orientationValueOrder: null };
};

const inspectPng = (bytes: Uint8Array): InspectedImage | null => {
  if (
    bytes.byteLength < 24 ||
    bytes[0] !== 0x89 ||
    !ascii(bytes, 1, 'PNG') ||
    bytes[4] !== 0x0d ||
    bytes[5] !== 0x0a ||
    bytes[6] !== 0x1a ||
    bytes[7] !== 0x0a ||
    !ascii(bytes, 12, 'IHDR')
  )
    return null;
  const encodedWidth = uint32(bytes, 16, false);
  const encodedHeight = uint32(bytes, 20, false);
  if (encodedWidth === null || encodedHeight === null) return null;
  let orientation: ReturnType<typeof orientationFromTiff> = {
    orientation: 1,
    orientationValueOffset: null,
    orientationValueOrder: null,
  };
  let offset = 8;
  while (offset + 12 <= bytes.byteLength) {
    const length = uint32(bytes, offset, false);
    if (length === null || offset + 12 + length > bytes.byteLength) return null;
    if (ascii(bytes, offset + 4, 'eXIf')) {
      orientation = orientationFromTiff(bytes, offset + 8, length);
    }
    if (ascii(bytes, offset + 4, 'IEND')) break;
    offset += 12 + length;
  }
  return { encodedHeight, encodedWidth, ...orientation };
};

const jpegStartOfFrameMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

const inspectJpeg = (bytes: Uint8Array): InspectedImage | null => {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let encodedWidth: number | null = null;
  let encodedHeight: number | null = null;
  let orientation: ReturnType<typeof orientationFromTiff> = {
    orientation: 1,
    orientationValueOffset: null,
    orientationValueOrder: null,
  };
  let offset = 2;
  while (offset + 4 <= bytes.byteLength) {
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    offset += 1;
    const segmentLength = uint16(bytes, offset, false);
    if (segmentLength === null || segmentLength < 2 || offset + segmentLength > bytes.byteLength) {
      return null;
    }
    const dataOffset = offset + 2;
    const dataLength = segmentLength - 2;
    if (marker === 0xe1 && dataLength >= 14 && ascii(bytes, dataOffset, 'Exif\0\0')) {
      orientation = orientationFromTiff(bytes, dataOffset + 6, dataLength - 6);
    }
    if (jpegStartOfFrameMarkers.has(marker) && dataLength >= 5) {
      encodedHeight = uint16(bytes, dataOffset + 1, false);
      encodedWidth = uint16(bytes, dataOffset + 3, false);
    }
    offset += segmentLength;
  }
  if (encodedWidth === null || encodedHeight === null) return null;
  return { encodedHeight, encodedWidth, ...orientation };
};

const inspectWebp = (bytes: Uint8Array): InspectedImage | null => {
  if (bytes.byteLength < 20 || !ascii(bytes, 0, 'RIFF') || !ascii(bytes, 8, 'WEBP')) return null;
  const riffSize = uint32(bytes, 4, true);
  if (riffSize === null || riffSize + 8 > bytes.byteLength) return null;
  let encodedWidth: number | null = null;
  let encodedHeight: number | null = null;
  let orientation: ReturnType<typeof orientationFromTiff> = {
    orientation: 1,
    orientationValueOffset: null,
    orientationValueOrder: null,
  };
  let offset = 12;
  const riffEnd = riffSize + 8;
  while (offset + 8 <= riffEnd) {
    const chunkSize = uint32(bytes, offset + 4, true);
    if (chunkSize === null) return null;
    const dataOffset = offset + 8;
    if (dataOffset + chunkSize > riffEnd) return null;
    if (ascii(bytes, offset, 'ANIM') || ascii(bytes, offset, 'ANMF')) {
      throw new Error('UTILITY_IMAGE_ANIMATION_UNSUPPORTED');
    }
    if (ascii(bytes, offset, 'VP8X') && chunkSize >= 10) {
      const widthMinusOne = uint24LittleEndian(bytes, dataOffset + 4);
      const heightMinusOne = uint24LittleEndian(bytes, dataOffset + 7);
      if (widthMinusOne !== null && heightMinusOne !== null) {
        encodedWidth = widthMinusOne + 1;
        encodedHeight = heightMinusOne + 1;
      }
    } else if (
      ascii(bytes, offset, 'VP8 ') &&
      chunkSize >= 10 &&
      bytes[dataOffset + 3] === 0x9d &&
      bytes[dataOffset + 4] === 0x01 &&
      bytes[dataOffset + 5] === 0x2a
    ) {
      const widthBits = uint16(bytes, dataOffset + 6, true);
      const heightBits = uint16(bytes, dataOffset + 8, true);
      if (widthBits !== null && heightBits !== null) {
        encodedWidth = widthBits & 0x3fff;
        encodedHeight = heightBits & 0x3fff;
      }
    } else if (ascii(bytes, offset, 'VP8L') && chunkSize >= 5 && bytes[dataOffset] === 0x2f) {
      const byte1 = bytes[dataOffset + 1] ?? 0;
      const byte2 = bytes[dataOffset + 2] ?? 0;
      const byte3 = bytes[dataOffset + 3] ?? 0;
      const byte4 = bytes[dataOffset + 4] ?? 0;
      encodedWidth = 1 + byte1 + ((byte2 & 0x3f) << 8);
      encodedHeight = 1 + (byte2 >> 6) + (byte3 << 2) + ((byte4 & 0x0f) << 10);
    } else if (ascii(bytes, offset, 'EXIF') && chunkSize >= 8) {
      const hasExifPrefix = chunkSize >= 14 && ascii(bytes, dataOffset, 'Exif\0\0');
      orientation = orientationFromTiff(
        bytes,
        dataOffset + (hasExifPrefix ? 6 : 0),
        chunkSize - (hasExifPrefix ? 6 : 0),
      );
    }
    offset = dataOffset + chunkSize + (chunkSize % 2);
  }
  if (encodedWidth === null || encodedHeight === null) return null;
  return { encodedHeight, encodedWidth, ...orientation };
};

export const inspectImage = (source: ImageSource): InspectedImage => {
  const inspection =
    source.mimeType === 'image/png'
      ? inspectPng(source.bytes)
      : source.mimeType === 'image/jpeg'
        ? inspectJpeg(source.bytes)
        : inspectWebp(source.bytes);
  if (inspection === null) throw new Error('UTILITY_IMAGE_INVALID');
  if (
    inspection.encodedWidth < 1 ||
    inspection.encodedHeight < 1 ||
    inspection.encodedWidth * inspection.encodedHeight > maximumImagePixels
  ) {
    throw new Error('UTILITY_IMAGE_PIXELS_LIMIT');
  }
  return inspection;
};

export const resolveImageOrientation = (
  orientation: InspectedImage['orientation'],
  width: number,
  height: number,
): {
  readonly height: number;
  readonly transform: readonly [number, number, number, number, number, number];
  readonly width: number;
} => {
  const swapsDimensions = orientation >= 5;
  const output = {
    height: swapsDimensions ? width : height,
    width: swapsDimensions ? height : width,
  };
  if (orientation === 2) return { ...output, transform: [-1, 0, 0, 1, width, 0] };
  if (orientation === 3) return { ...output, transform: [-1, 0, 0, -1, width, height] };
  if (orientation === 4) return { ...output, transform: [1, 0, 0, -1, 0, height] };
  if (orientation === 5) return { ...output, transform: [0, 1, 1, 0, 0, 0] };
  if (orientation === 6) return { ...output, transform: [0, 1, -1, 0, height, 0] };
  if (orientation === 7) return { ...output, transform: [0, -1, -1, 0, height, width] };
  if (orientation === 8) return { ...output, transform: [0, -1, 1, 0, 0, width] };
  return { ...output, transform: [1, 0, 0, 1, 0, 0] };
};

const bytesWithTopLeftOrientation = (
  source: ImageSource,
  inspection: InspectedImage,
): Uint8Array => {
  if (inspection.orientationValueOffset === null || inspection.orientationValueOrder === null) {
    return source.bytes;
  }
  const bytes = source.bytes.slice();
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(
    inspection.orientationValueOffset,
    1,
    inspection.orientationValueOrder === 'little',
  );
  if (source.mimeType === 'image/png') {
    let offset = 8;
    let updated = false;
    while (offset + 12 <= bytes.byteLength) {
      const length = uint32(bytes, offset, false);
      if (length === null || offset + 12 + length > bytes.byteLength) break;
      const dataOffset = offset + 8;
      if (
        ascii(bytes, offset + 4, 'eXIf') &&
        inspection.orientationValueOffset >= dataOffset &&
        inspection.orientationValueOffset + 2 <= dataOffset + length
      ) {
        let crc = 0xffffffff;
        for (let index = offset + 4; index < dataOffset + length; index += 1) {
          crc ^= bytes[index] ?? 0;
          for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
          }
        }
        new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
          dataOffset + length,
          (crc ^ 0xffffffff) >>> 0,
          false,
        );
        updated = true;
        break;
      }
      offset += 12 + length;
    }
    if (!updated) throw new Error('UTILITY_IMAGE_INVALID');
  }
  return bytes;
};

export const normalizeImageForPdf = async (source: ImageSource): Promise<NormalizedImage> => {
  const inspection = inspectImage(source);
  if (source.mimeType !== 'image/webp' && inspection.orientation === 1) {
    return {
      bytes: source.bytes,
      height: inspection.encodedHeight,
      mimeType: source.mimeType,
      width: inspection.encodedWidth,
    };
  }
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
    throw new Error('UTILITY_IMAGE_DECODER_UNAVAILABLE');
  }
  const bitmap = await createImageBitmap(
    new Blob([bytesWithTopLeftOrientation(source, inspection).slice().buffer], {
      type: source.mimeType,
    }),
    { imageOrientation: 'from-image' },
  ).catch(() => {
    throw new Error('UTILITY_IMAGE_INVALID');
  });
  try {
    if (
      bitmap.width !== inspection.encodedWidth ||
      bitmap.height !== inspection.encodedHeight ||
      bitmap.width * bitmap.height > maximumImagePixels
    ) {
      throw new Error('UTILITY_IMAGE_DECODE_MISMATCH');
    }
    const oriented = resolveImageOrientation(inspection.orientation, bitmap.width, bitmap.height);
    const { height, width } = oriented;
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('UTILITY_IMAGE_DECODER_UNAVAILABLE');
    context.setTransform(...oriented.transform);
    context.drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' }).catch(() => {
      throw new Error('UTILITY_IMAGE_ENCODING_FAILED');
    });
    if (blob.type !== 'image/png' || blob.size === 0 || blob.size > maximumNormalizedBytes) {
      throw new Error('UTILITY_IMAGE_ENCODING_FAILED');
    }
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      height,
      mimeType: 'image/png',
      width,
    };
  } finally {
    bitmap.close();
  }
};
