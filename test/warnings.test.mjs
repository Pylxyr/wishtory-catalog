// Warnings never stop a publish; a folder name that is too long does.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { validate } from '../scripts/lib/validate.mjs';
import { inspectPicture } from '../scripts/lib/images.mjs';
import { deflateSync, crc32 } from 'node:zlib';

const repo = fileURLToPath(new URL('..', import.meta.url));
const copy = () => {
  const root = mkdtempSync(join(tmpdir(), 'catalog-warn-'));
  cpSync(join(repo, 'examples'), root, { recursive: true });
  return root;
};

// A real, valid PNG of any size.
function png(width, height) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 3 + 1) * height);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

test('the helper makes pictures the checker accepts', () => {
  assert.deepEqual(inspectPicture(png(64, 32)), { format: 'png', width: 64, height: 32 });
});

test('a picture that is not square is a warning, not a problem', () => {
  const root = copy();
  try {
    writeFileSync(join(root, 'items/hk4e/mitya/icon.png'), png(64, 32));
    const result = validate(root);
    assert.deepEqual(result.problems, []);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].file, 'items/hk4e/mitya/icon.png');
    assert.match(result.warnings[0].message, /64x32.*not square/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('wish art may have any shape', () => {
  const root = copy();
  try {
    writeFileSync(join(root, 'items/hk4e/mitya/wish.png'), png(64, 32));
    assert.deepEqual(validate(root).warnings, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a banner added twice is a warning that names the other file', () => {
  const root = copy();
  try {
    const original = JSON.parse(readFileSync(join(root, 'banners/hk4e-character-example-mitya.json'), 'utf8'));
    writeFileSync(join(root, 'banners/hk4e-character-example-twin.json'), JSON.stringify({ ...original, id: 'hk4e-character-example-twin' }));
    const result = validate(root);
    assert.deepEqual(result.problems, []);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0].message, /same pool, dates and 5-star items as banners\/hk4e-character-example-mitya\.json/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('two banners of one pool with different dates are fine', () => {
  const root = copy();
  try {
    const original = JSON.parse(readFileSync(join(root, 'banners/hk4e-character-example-mitya.json'), 'utf8'));
    writeFileSync(join(root, 'banners/hk4e-character-example-later.json'), JSON.stringify({ ...original, id: 'hk4e-character-example-later', start: '2026-12-01 15:00:00', end: '2026-12-20 17:59:59' }));
    assert.deepEqual(validate(root).warnings, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an item folder name over 60 characters is refused', () => {
  const root = copy();
  try {
    renameSync(join(root, 'items/hk4e/mitya'), join(root, 'items/hk4e/' + 'a'.repeat(61)));
    const result = validate(root);
    assert.ok(result.problems.some((p) => /at most 60 characters/.test(p.message)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
