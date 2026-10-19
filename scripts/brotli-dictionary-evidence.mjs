// Read bytes only: never import/evaluate the package's JS or compiled encoder.
import { createHash } from 'node:crypto';
import { brotliDecompressSync } from 'node:zlib';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function brotliDictionaryEvidence(source, packed) {
  const fail = () => {
    throw new Error('BROTLI_DICTIONARY_EVIDENCE_INVALID');
  };
  if (
    !Buffer.isBuffer(source) ||
    !Buffer.isBuffer(packed) ||
    source.length > 1024 * 1024 ||
    packed.length > 128 * 1024
  )
    return fail();
  const arrays = [
    ...source
      .toString('utf8')
      .matchAll(/exports\.dictionary = new Uint8Array\(\[([\s\S]*?)\]\);/gu),
  ];
  const literal = packed
    .toString('utf8')
    .match(/^module\.exports="([A-Za-z0-9+/]+={0,2})";\n?$/u)?.[1];
  if (arrays.length !== 1 || !/^(?:\s*0x[a-f0-9]{2}\s*,)*\s*$/u.test(arrays[0][1]) || !literal)
    return fail();
  const numbers = arrays[0][1].match(/0x[a-f0-9]{2}/gu) ?? [];
  if (numbers.length !== 122784) return fail();
  const raw = Buffer.from(numbers.map((value) => parseInt(value, 16)));
  const compressed = Buffer.from(literal, 'base64');
  if (compressed.toString('base64') !== literal) return fail();
  let decoded;
  try {
    decoded = brotliDecompressSync(compressed, { maxOutputLength: 122784 });
  } catch {
    return fail();
  }
  if (!raw.equals(decoded)) return fail();
  return {
    sourceSha256: hash(source),
    payloadSha256: hash(packed),
    bytes: decoded.length,
    sha256: hash(decoded),
  };
}
