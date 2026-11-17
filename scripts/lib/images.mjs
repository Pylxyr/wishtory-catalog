// Checks that a file really is a PNG or WebP picture by reading its contents, never its name.
// Returns { format: 'png' | 'webp', width, height } or { problem: 'plain words' }.
import { crc32 } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function inspectPng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  let pos = 8;
  let width = 0;
  let height = 0;
  let first = true;
  let sawData = false;
  let sawEnd = false;
  while (pos + 12 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const end = pos + 12 + length;
    if (end > buf.length) return { problem: 'The PNG is cut off (the file ends in the middle of the picture). Export it again.' };
    const crc = buf.readUInt32BE(end - 4);
    if (crc32(buf.subarray(pos + 4, end - 4)) !== crc) {
      return { problem: `The PNG is damaged (a "${type}" part fails its checksum). Export it again.` };
    }
    if (first) {
      if (type !== 'IHDR' || length !== 13) return { problem: 'The PNG has no valid header. Export it again.' };
      width = buf.readUInt32BE(pos + 8);
      height = buf.readUInt32BE(pos + 12);
      first = false;
    }
    if (type === 'IDAT') sawData = true;
    if (type === 'IEND') {
      sawEnd = true;
      pos = end;
      break;
    }
    pos = end;
  }
  if (!sawEnd || !sawData) return { problem: 'The PNG is incomplete (no picture data or no end marker). Export it again.' };
  if (pos !== buf.length) return { problem: 'The PNG has extra bytes after its end. Export it again.' };
  return { format: 'png', width, height };
}

function inspectWebp(buf) {
  if (buf.length < 30 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null;
  if (buf.readUInt32LE(4) + 8 !== buf.length) {
    return { problem: 'The WebP is cut off or has extra bytes (its stated size does not match the file). Export it again.' };
  }
  const chunk = buf.toString('latin1', 12, 16);
  if (chunk === 'VP8X') {
    return { format: 'webp', width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  }
  if (chunk === 'VP8L') {
    if (buf[20] !== 0x2f) return { problem: 'The WebP has no valid header. Export it again.' };
    const bits = buf.readUInt32LE(21);
    return { format: 'webp', width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  if (chunk === 'VP8 ') {
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return { problem: 'The WebP has no valid header. Export it again.' };
    return { format: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  return { problem: 'The WebP has an unknown kind of picture data. Export it again as PNG or WebP.' };
}

export function inspectPicture(buf) {
  return (
    inspectPng(buf) ??
    inspectWebp(buf) ?? { problem: 'This is not a real PNG or WebP picture (the file contents are something else, whatever the name says). Export it again as PNG or WebP.' }
  );
}
