// The local editor: refuses strangers, undoes a save that would break the baskets, and keeps good saves.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
let root, child, base, token;
const asDataUrl = (path) => `data:image/png;base64,${readFileSync(join(REPO, path)).toString('base64')}`;
const call = (path, body) =>
  fetch(base + path, { method: 'POST', headers: { 'X-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then((r) => r.json());

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'catalog-ui-'));
  cpSync(join(REPO, 'examples'), root, { recursive: true }); // a valid set of baskets to start from
  child = spawn(process.execPath, [join(REPO, 'tools', 'ui.mjs'), '--no-open'], { env: { ...process.env, CATALOG_UI_ROOT: root } });
  base = await new Promise((done, fail) => {
    child.stdout.on('data', (d) => { const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(String(d)); if (m) done(m[0].slice(0, -1)); });
    child.on('exit', () => fail(new Error('the editor stopped')));
  });
  token = /TOKEN = '([a-f0-9]{32})'/.exec(await (await fetch(base + '/')).text())[1];
});
after(() => { child?.kill(); rmSync(root, { recursive: true, force: true }); });

test('a request without the page\'s token is refused', async () => {
  assert.equal((await fetch(base + '/api/check', { method: 'POST' })).status, 403);
});

test('an item naming a series that does not exist is refused and leaves nothing behind', async () => {
  const result = await call('/api/item', { game: 'hk4e', slug: 'zed', id: '10000999', name: 'Zed', rarity: 4, kind: 'character', element: 'pyro', series: 'no_such_series', icon: asDataUrl('examples/items/hk4e/mitya/icon.png'), wish: asDataUrl('examples/items/hk4e/mitya/wish.png') });
  assert.equal(result.ok, false);
  assert.equal(existsSync(join(root, 'items', 'hk4e', 'zed')), false);
});

test('a folder name that climbs out of the repository is refused', async () => {
  const result = await call('/api/item', { game: 'hk4e', slug: '../../escape', id: '1', name: 'E', rarity: 4, kind: 'weapon' });
  assert.equal(result.ok, false);
});

test('a good item is saved with its pictures', async () => {
  const result = await call('/api/item', { game: 'hk4e', slug: 'zed', id: '10000999', name: 'Zed', rarity: 4, kind: 'character', element: 'pyro', series: 'teachings_of_charity', icon: asDataUrl('examples/items/hk4e/mitya/icon.png'), wish: asDataUrl('examples/items/hk4e/mitya/wish.png') });
  // The example baskets live under examples/, so the real check of this copy sees them at its root.
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.ok(existsSync(join(root, 'items', 'hk4e', 'zed', 'icon.png')));
});
