import type { LocalOcrWord } from './local-ocr-compose.js';
/** Treat native JSON as untrusted. Count blank entries too, before traversing them. */
export function readLocalOcrWords(
  raw: unknown,
  width: number,
  height: number,
): readonly LocalOcrWord[] {
  const invalid = (): never => {
    throw new Error('OCR_OUTPUT_INVALID');
  };
  const object = (value: unknown): Record<string, unknown> => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid();
    return value as Record<string, unknown>;
  };
  const array = (value: unknown, max: number): readonly unknown[] => {
    if (!Array.isArray(value) || value.length > max) return invalid();
    return value as unknown[];
  };
  const finite = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : invalid();
  if (![width, height].every((value) => Number.isSafeInteger(value) && value > 0)) return invalid();
  let paragraphs = 0,
    lines = 0,
    entries = 0;
  const words: LocalOcrWord[] = [];
  for (const block of array(object(raw).blocks, 1000))
    for (const paragraph of array(object(block).paragraphs, 1000)) {
      if (++paragraphs > 1000) return invalid();
      for (const line of array(object(paragraph).lines, 10000)) {
        if (++lines > 10000) return invalid();
        const record = object(line);
        const baseline = finite(object(record.baseline).y0);
        for (const item of array(record.words, 10000)) {
          if (++entries > 10000) throw new Error('OCR_WORD_LIMIT');
          const word = object(item);
          if (typeof word.text !== 'string' || word.text.length > 256) return invalid();
          if (!word.text.trim()) continue;
          const confidence = word.confidence === undefined ? undefined : finite(word.confidence);
          if (confidence !== undefined && (confidence < 0 || confidence > 100)) return invalid();
          const box = object(word.bbox);
          const x0 = finite(box.x0),
            y0 = finite(box.y0),
            x1 = finite(box.x1),
            y1 = finite(box.y1);
          if (x0 < 0 || y0 < 0 || x1 > width || y1 > height || x1 <= x0 || y1 <= y0)
            return invalid();
          words.push({
            ...(confidence === undefined ? {} : { confidence }),
            text: word.text,
            x: x0 / width,
            y: y0 / height,
            width: (x1 - x0) / width,
            height: (y1 - y0) / height,
            baseline: Math.min(1, Math.max(0, baseline / height)),
          });
        }
      }
    }
  if (!words.length) throw new Error('OCR_NO_TEXT_FOUND');
  return words;
}
