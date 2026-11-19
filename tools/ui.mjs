// A small local editor for the three baskets: forms and drag-and-drop pictures instead of hand-written JSON.
//   node tools/ui.mjs            (or double-click tools\ui.cmd on Windows)
// It listens on 127.0.0.1 only, needs a one-time token that only the page it opens knows, and writes
// nothing outside this repository. Every save is checked with the same code the publish uses; a save
// that would add a problem is undone. Nothing here is published until you press Publish (git push).
import '../scripts/lib/node-version.mjs';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../scripts/lib/validate.mjs';
import { inspectPicture } from '../scripts/lib/images.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// CATALOG_UI_ROOT exists for the tests, which work on a throw-away copy.
const ROOT = resolve(process.env.CATALOG_UI_ROOT ?? join(HERE, '..'));
const TOKEN = randomBytes(16).toString('hex');
const MAX_BODY = 12 * 1024 * 1024;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SERIES_ID = /^[a-z0-9_]+$/;
const BANNER_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const GAMES = ['hk4e', 'hkrpg', 'nap'];

class Refused extends Error {}
const refuse = (message) => {
  throw new Refused(message);
};

const inside = (path) => {
  const full = resolve(ROOT, path); // relative paths belong to the repository, wherever the editor was started from
  if (full !== ROOT && !full.startsWith(ROOT + sep)) refuse('That path is outside the repository.');
  return full;
};

// Remembers what a save wrote so it can be undone exactly.
function transaction() {
  const undo = [];
  return {
    write(path, data) {
      const full = inside(path);
      undo.push({ full, before: existsSync(full) ? readFileSync(full) : null });
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, data);
    },
    remove(path) {
      const full = inside(path);
      if (!existsSync(full)) return;
      undo.push({ full, before: readFileSync(full) });
      rmSync(full);
    },
    rollback() {
      for (const { full, before } of undo.reverse()) {
        if (before === null) {
          rmSync(full, { force: true });
          // Folders this save created are removed again, so a refused save leaves no empty folders behind.
          for (let dir = dirname(full); dir !== ROOT && dir.startsWith(ROOT + sep) && readdirSync(dir).length === 0; dir = dirname(dir)) rmdirSync(dir);
        } else writeFileSync(full, before);
      }
    },
  };
}

const keyOf = (p) => `${p.file}\u0000${p.message}`;

// Runs fn inside a transaction; keeps the result only if it adds no problem the repository did not already have.
function checkedSave(fn) {
  const before = new Set(validate(ROOT).problems.map(keyOf));
  const tx = transaction();
  try {
    fn(tx);
  } catch (error) {
    tx.rollback();
    throw error;
  }
  const added = validate(ROOT).problems.filter((p) => !before.has(keyOf(p)));
  if (added.length > 0) {
    tx.rollback();
    return { ok: false, problems: added };
  }
  return { ok: true, problems: [] };
}

function picture(dataUrl, label, maxBytes) {
  const m = /^data:[^;,]*;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl ?? '');
  if (!m) refuse(`The ${label} picture could not be read. Drop a PNG or WebP file.`);
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > maxBytes) refuse(`The ${label} picture is ${(buf.length / 1024).toFixed(0)} KB; the limit is ${Math.round(maxBytes / 1024)} KB.`);
  const info = inspectPicture(buf);
  if (info.problem) refuse(`${label}: ${info.problem}`);
  return { buf, ext: info.format === 'webp' ? 'webp' : 'png' };
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const pick = (source, keys) => Object.fromEntries(keys.filter((k) => source[k] !== undefined && source[k] !== '').map((k) => [k, source[k]]));

function saveItem(body) {
  if (!GAMES.includes(body.game)) refuse('Choose a game.');
  if (!SLUG.test(body.slug ?? '')) refuse('The folder name must be lowercase letters and digits with single dashes, for example "mitya".');
  const item = {
    game: body.game,
    id: String(body.id ?? ''),
    name: body.name,
    aliases: Array.isArray(body.aliases) ? body.aliases : [],
    rarity: Number(body.rarity),
    kind: body.kind,
    ...pick(body, ['element', 'path', 'specialty', 'weapon_type', 'series']),
  };
  const dir = `items/${body.game}/${body.slug}`;
  return checkedSave((tx) => {
    tx.write(`${dir}/item.json`, json(item));
    for (const [field, label, limit] of [['icon', 'icon', 512 * 1024], ['wish', 'wish art', 3 * 1024 * 1024]]) {
      if (!body[field]) continue;
      const { buf, ext } = picture(body[field], label, limit);
      tx.remove(`${dir}/${field}.png`);
      tx.remove(`${dir}/${field}.webp`);
      tx.write(`${dir}/${field}.${ext}`, buf);
    }
  });
}

function saveBanner(body) {
  if (!BANNER_ID.test(body.id ?? '')) refuse('The banner id may use lowercase letters, digits, dots, dashes and underscores, for example "hk4e-character-2026-11-04".');
  const banner = {
    id: body.id,
    game: body.game,
    pool: body.pool,
    name: body.name,
    start: body.start,
    end: body.end,
    featured_5: body.featured_5 ?? [],
    featured_4: body.featured_4 ?? [],
    gacha_ids: body.gacha_ids ?? [],
  };
  return checkedSave((tx) => tx.write(`banners/${body.id}.json`, json(banner)));
}

function saveSeries(body) {
  if (!['books', 'weapons'].includes(body.group)) refuse('Choose talent books or weapon materials.');
  if (!SERIES_ID.test(body.id ?? '')) refuse('The series id may use lowercase letters, digits and underscores, for example "teachings_of_charity".');
  const path = 'materials/schedule.json';
  const current = existsSync(join(ROOT, path)) ? JSON.parse(readFileSync(join(ROOT, path), 'utf8').replace(/^\uFEFF/, '')) : { books: [], weapons: [] };
  const entry = { id: body.id, name: body.name, title: body.title, days: [...(body.days ?? [])].map(Number).sort((a, b) => a - b) };
  const group = (current[body.group] ?? []).filter((s) => s.id !== body.id);
  current[body.group] = [...group, entry];
  current.books ??= [];
  current.weapons ??= [];
  return checkedSave((tx) => {
    tx.write(path, json(current));
    if (body.picture) {
      const { buf, ext } = picture(body.picture, 'series', 512 * 1024);
      tx.remove(`materials/pictures/${body.id}.png`);
      tx.remove(`materials/pictures/${body.id}.webp`);
      tx.write(`materials/pictures/${body.id}.${ext}`, buf);
    }
  });
}

const git = (...args) =>
  new Promise((done) => {
    execFile('git', args, { cwd: ROOT, timeout: 120_000, windowsHide: true }, (error, stdout, stderr) =>
      done({ ok: !error, text: `${stdout}${stderr}`.trim() || (error ? error.message : '') }),
    );
  });

async function publish(message) {
  const result = validate(ROOT);
  if (result.problems.length > 0) return { ok: false, text: `Not published: ${result.problems.length} problem(s) to fix first. Press Check to see them.` };
  const lines = [];
  const step = async (title, ...args) => {
    const r = await git(...args);
    lines.push(`> git ${args.join(' ')}\n${r.text}`.trim());
    return r.ok ? r : (lines.push(`${title} failed.`), null);
  };
  if (!(await step('Adding', 'add', '-A', '--', 'items', 'banners', 'materials'))) return { ok: false, text: lines.join('\n\n') };
  const staged = await git('diff', '--cached', '--quiet');
  if (staged.ok) lines.push('Nothing new to publish.');
  else if (!(await step('Saving', 'commit', '-m', message || 'Update catalog data'))) return { ok: false, text: lines.join('\n\n') };
  if (!(await step('Pushing', 'push'))) return { ok: false, text: lines.join('\n\n') };
  lines.push('Pushed. Open the repository\'s Actions tab: green means published, red means nothing was published.');
  return { ok: true, text: lines.join('\n\n') };
}

function state() {
  const result = validate(ROOT);
  return {
    items: result.items.map(({ buf, pictures, ...rest }) => ({ ...rest, hasWish: Boolean(pictures?.wish) })),
    banners: result.banners.map(({ file, ...b }) => b),
    schedule: { books: result.schedule.books, weapons: result.schedule.weapons },
    problems: result.problems,
  };
}

const routes = {
  'POST /api/item': (b) => saveItem(b),
  'POST /api/banner': (b) => saveBanner(b),
  'POST /api/series': (b) => saveSeries(b),
  'POST /api/check': () => ({ ok: true, ...state() }),
  'POST /api/publish': (b) => publish(typeof b.message === 'string' ? b.message.slice(0, 200) : ''),
  'GET /api/state': () => state(),
};

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) refuse('That upload is too large.');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

const server = createServer(async (request, response) => {
  const send = (status, type, body) => {
    response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'" });
    response.end(body);
  };
  try {
    const host = request.headers.host ?? '';
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) return send(403, 'text/plain', 'Forbidden');
    const url = new URL(request.url, `http://${host}`);
    if (request.method === 'GET' && url.pathname === '/') {
      const html = readFileSync(join(HERE, 'ui.html'), 'utf8').replace('__TOKEN__', TOKEN);
      return send(200, 'text/html; charset=utf-8', html);
    }
    const handler = routes[`${request.method} ${url.pathname}`];
    if (!handler) return send(404, 'text/plain', 'Not found');
    if (request.headers['x-token'] !== TOKEN) return send(403, 'text/plain', 'Forbidden');
    const origin = request.headers.origin;
    if (origin && origin !== `http://${host}`) return send(403, 'text/plain', 'Forbidden');
    const body = request.method === 'POST' ? await readBody(request) : {};
    return send(200, 'application/json', JSON.stringify(await handler(body)));
  } catch (error) {
    if (error instanceof Refused) return send(200, 'application/json', JSON.stringify({ ok: false, problems: [{ file: '', message: error.message }] }));
    console.error(error);
    return send(500, 'application/json', JSON.stringify({ ok: false, problems: [{ file: '', message: 'Something went wrong in the editor. See the window it was started from.' }] }));
  }
});

server.listen(0, '127.0.0.1', () => {
  const address = `http://127.0.0.1:${server.address().port}/`;
  console.log(`Wishtory catalog editor: ${address}\nClose this window (or press Ctrl+C) when you are done.`);
  if (!process.argv.includes('--no-open')) {
    const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', address]] : process.platform === 'darwin' ? ['open', [address]] : ['xdg-open', [address]];
    execFile(cmd, args, () => {});
  }
});
