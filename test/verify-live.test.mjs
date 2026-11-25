// The after-publish check passes only for a site that serves exactly what was built.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
let scratch, site, document;

before(() => {
  scratch = mkdtempSync(join(tmpdir(), 'catalog-live-'));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  writeFileSync(join(scratch, 'public-key.txt'), `${publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64')}\n`);
  writeFileSync(join(scratch, 'key.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const env = { ...process.env, WISHTORY_PUBLIC_KEY_FILE: join(scratch, 'public-key.txt'), CATALOG_SIGNING_KEY_FILE: join(scratch, 'key.pem') };
  for (const name of ['GITHUB_STEP_SUMMARY', 'GITHUB_ACTIONS', 'CATALOG_SIGNING_KEY']) delete env[name];
  const run = spawnSync(process.execPath, ['scripts/build.mjs', '--root', 'examples', '--out', join(scratch, 'dist')], { cwd: repo, env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  site = join(scratch, 'dist', 'site');
  document = JSON.parse(Buffer.from(JSON.parse(readFileSync(join(site, 'v1', 'own.envelope.json'), 'utf8')).payload, 'base64').toString('utf8'));
});
after(() => rmSync(scratch, { recursive: true, force: true }));

// Serves the built site, with optional changes to what is served.
async function serve(change = {}) {
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://x').pathname.replace(/^\//, '');
    const body = path in change ? change[path] : (() => { try { return readFileSync(join(site, path)); } catch { return null; } })();
    if (body === null) return response.writeHead(404).end();
    response.writeHead(200).end(body);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() };
}

const verify = (url) =>
  new Promise((done) => {
    const child = spawn(process.execPath, ['scripts/verify-live.mjs', url, site], { cwd: repo, env: { ...process.env, VERIFY_ATTEMPTS: '2', VERIFY_DELAY_MS: '10' } });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('exit', (status) => done({ status, out }));
  });

test('the picture names are the SHA-256 of the pictures', () => {
  for (const path of document.items.flatMap((item) => Object.values(item.pictures))) {
    const named = /\.([0-9a-f]{64})\.(png|webp)$/.exec(path);
    assert.ok(named, path);
    assert.equal(createHash('sha256').update(readFileSync(join(site, 'v1', path))).digest('hex'), named[1]);
  }
});

test('a site that serves exactly what was built passes', async () => {
  const live = await serve();
  try {
    const { status, out } = await verify(live.url);
    assert.equal(status, 0, out);
    assert.match(out, /Verified online/);
  } finally {
    live.close();
  }
});

test('a site still serving an older signed file fails', async () => {
  const live = await serve({ 'v1/own.envelope.json': Buffer.from('{"payload":"","signature":""}\n') });
  try {
    const { status, out } = await verify(live.url);
    assert.equal(status, 1);
    assert.match(out, /not the one that was just built/);
  } finally {
    live.close();
  }
});

test('a picture that is missing online fails', async () => {
  const path = `v1/${document.items[0].pictures.icon}`;
  const live = await serve({ [path]: null });
  try {
    const { status, out } = await verify(live.url);
    assert.equal(status, 1);
    assert.match(out, /picture\(s\) are wrong or missing online/);
  } finally {
    live.close();
  }
});

test('a picture that was swapped for another real picture fails', async () => {
  const [first, second] = document.items.map((item) => item.pictures.icon);
  const live = await serve({ [`v1/${first}`]: readFileSync(join(site, 'v1', second)) });
  try {
    const { status, out } = await verify(live.url);
    assert.equal(status, 1);
    assert.match(out, /not the picture that was built/);
  } finally {
    live.close();
  }
});

test('an address that is not https is refused', () => {
  const run = spawnSync(process.execPath, ['scripts/verify-live.mjs', 'http://example.org/', site], { cwd: repo, encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /must be an https address/);
});
