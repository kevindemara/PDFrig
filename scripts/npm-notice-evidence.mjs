// Exact published bytes are evidence, not a licence grant or native SBOM clearance.
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const fail = () => {
  throw new Error('NPM_NOTICE_EVIDENCE_INVALID');
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const safePath = (name) =>
  name.length > 0 &&
  name.length <= 240 &&
  !/[\\\0\r\n:]/u.test(name) &&
  name.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
const record = (bytes) => ({ bytes: bytes.length, sha256: sha256(bytes) });

export function npmTreeEvidence(files) {
  const sorted = [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    files: sorted.length,
    bytes: sorted.reduce((sum, [, file]) => sum + file.bytes, 0),
    sha256: sha256(
      Buffer.from(
        sorted.map(([name, file]) => `${name}\0${file.bytes}\0${file.sha256}\n`).join(''),
      ),
    ),
  };
}

export async function installedNpmEvidence(directory) {
  const files = new Map();
  let entries = 0,
    bytes = 0;
  async function walk(relative = '') {
    for (const entry of await readdir(path.join(directory, relative))) {
      if (++entries > 4096) fail();
      const name = relative ? `${relative}/${entry}` : entry;
      if (!safePath(name)) fail();
      const absolute = path.join(directory, name);
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) fail();
      if (stat.isDirectory()) await walk(name);
      else if (stat.isFile() && stat.size <= 64 * 1024 * 1024) {
        const content = await readFile(absolute);
        bytes += content.length;
        files.set(name, record(content));
        if (files.size > 2048 || bytes > 128 * 1024 * 1024) fail();
      } else fail();
    }
  }
  await walk();
  return files;
}

/** Read only; no extraction, symlink following, package scripts or native loading.
 * Deliberately accepts only the simple regular-file npm archives under review. */
export function publishedNpmEvidence(compressed, integrity) {
  if (
    !Buffer.isBuffer(compressed) ||
    compressed.length > 40 * 1024 * 1024 ||
    !/^sha512-[A-Za-z0-9+/]{86}==$/u.test(integrity) ||
    `sha512-${createHash('sha512').update(compressed).digest('base64')}` !== integrity
  )
    fail();
  const tar = gunzipSync(compressed, { maxOutputLength: 128 * 1024 * 1024 });
  const files = new Map();
  const text = (header, offset, length) =>
    header
      .subarray(offset, offset + length)
      .toString('utf8')
      .split('\0')[0];
  const octal = (header, offset, length) => {
    const value = text(header, offset, length).trim();
    if (!/^[0-7]+$/u.test(value)) fail();
    return Number.parseInt(value, 8);
  };
  let offset = 0,
    ended = false;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      if (tar.length < offset + 1024 || !tar.subarray(offset).every((byte) => byte === 0)) fail();
      ended = true;
      break;
    }
    const checksum = [...header].reduce(
      (sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte),
      0,
    );
    if (checksum !== octal(header, 148, 8)) fail();
    const prefix = text(header, 345, 155);
    const full = (prefix ? prefix + '/' : '') + text(header, 0, 100);
    const size = octal(header, 124, 12);
    const type = header[156];
    if (
      size > 64 * 1024 * 1024 ||
      offset + 512 + size > tar.length ||
      (type !== 0 && type !== 48 && type !== 53)
    )
      fail();
    const filename = type === 53 ? full.replace(/\/$/u, '') : full;
    if (!filename.startsWith('package/') || !safePath(filename)) fail();
    if (type !== 53) {
      const name = filename.slice('package/'.length);
      if (files.has(name)) fail();
      files.set(name, record(tar.subarray(offset + 512, offset + 512 + size)));
      if (files.size > 2048) fail();
    } else if (size !== 0) fail();
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!ended || !files.size) fail();
  return files;
}

export async function boundedRegistryFetch(url, maximum) {
  if (!Number.isSafeInteger(maximum) || maximum <= 0 || maximum > 40 * 1024 * 1024) fail();
  const parsed = new URL(url);
  if (parsed.origin !== 'https://registry.npmjs.org' || parsed.username || parsed.password) fail();
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(90_000) });
  if (!response.ok || !response.body) fail();
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > maximum) fail();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
