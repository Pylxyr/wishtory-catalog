// The last step of the build must prove that the signed data only names pictures that exist.
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { missingPictures } from '../scripts/build.mjs';
import { openEnvelope } from '../scripts/lib/sign.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));

test('missingPictures lists every named picture that is not in the site', () => {
  const site = mkdtempSync(join(tmpdir(), 'catalog-site-'));
  try {
    mkdirSync(join(site, 'v1', 'pictures', 'hk4e', 'mitya'), { recursive: true });
    mkdirSync(join(site, 'v1', 'materials'), { recursive: true });
    for (const file of ['pictures/hk4e/mitya/icon.aaaaaaaa.png', 'materials/charity.cccccccc.png']) writeFileSync(join(site, 'v1', file), 'x');
    const document = {
      items: [{ pictures: { icon: 'pictures/hk4e/mitya/icon.aaaaaaaa.png', wish: 'pictures/hk4e/mitya/wish.bbbbbbbb.png' } }],
      schedule: {
        books: [{ picture: 'materials/charity.cccccccc.png' }],
        weapons: [{ picture: 'materials/frost.dddddddd.png' }],
      },
    };
    assert.deepEqual(missingPictures(document, site), ['pictures/hk4e/mitya/wish.bbbbbbbb.png', 'materials/frost.dddddddd.png']);
  } finally {
    rmSync(site, { recursive: true, force: true });
  }
});

test('building the examples with a throwaway key gives a signed file that opens and names only real pictures', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'catalog-build-'));
  try {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const pinned = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
    writeFileSync(join(scratch, 'public-key.txt'), `${pinned}\n`);
    writeFileSync(join(scratch, 'key.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));

    const env = { ...process.env, WISHTORY_PUBLIC_KEY_FILE: join(scratch, 'public-key.txt'), CATALOG_SIGNING_KEY_FILE: join(scratch, 'key.pem') };
    delete env.GITHUB_STEP_SUMMARY; // a test must not write into the real run summary
    delete env.GITHUB_ACTIONS;
    delete env.CATALOG_SIGNING_KEY;
    const run = spawnSync(process.execPath, ['scripts/build.mjs', '--root', 'examples', '--out', join(scratch, 'dist')], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout + run.stderr);

    const site = join(scratch, 'dist', 'site');
    const payload = openEnvelope(readFileSync(join(site, 'v1', 'own.envelope.json')), pinned);
    assert.ok(payload, 'the envelope opens with the public key');
    const document = JSON.parse(payload.toString('utf8'));
    assert.equal(document.items.length, 2);
    assert.deepEqual(missingPictures(document, site), []);
    for (const item of document.items) for (const path of Object.values(item.pictures)) assert.ok(existsSync(join(site, 'v1', path)), path);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
