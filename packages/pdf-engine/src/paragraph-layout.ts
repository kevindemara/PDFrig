/** Natural-width wrapping: never changes font size, character spacing or scale. */
export function wrapParagraph(
  text: string,
  width: number,
  measure: (text: string) => number,
): readonly string[] {
  if (!Number.isFinite(width) || width <= 0 || text.length > 4096)
    throw new Error('SOURCE_TEXT_REFLOW_INVALID_FRAME');
  const lines: string[] = [];
  for (const hardLine of text.split('\n')) {
    let line = '';
    for (const word of hardLine.trim().split(/ +/u).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= width + 0.001) {
        line = candidate;
        continue;
      }
      if (line) {
        lines.push(line);
        line = '';
      }
      for (const character of word) {
        if (measure(character) > width + 0.001) throw new Error('SOURCE_TEXT_REFLOW_INVALID_FRAME');
        if (measure(line + character) > width + 0.001) {
          lines.push(line);
          line = '';
        }
        line += character;
      }
    }
    lines.push(line);
    if (lines.length > 200) throw new Error('SOURCE_TEXT_REFLOW_OVERFLOW');
  }
  return lines;
}
