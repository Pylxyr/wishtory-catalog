// After a publish: proves that what the world can download is exactly what was just built.
//   node scripts/verify-live.mjs <address of the published site> <folder that was published>
// The signed file must be byte for byte the one built, and every picture it names must be there and
// be the very same picture. Pages can take a minute to start serving a new deployment, so it tries
// again for a while; if the site never matches, the run fails (red) instead of looking fine.
import './lib/node-version.mjs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspectPicture } from './lib/images.mjs';

const [siteArgument, folder] = process.argv.slice(2);
if (!siteArgument || !folder) {
  console.error('Usage: node scripts/verify-live.mjs <address of the published site> <folder that was published>');
  process.exit(2);
}
const site = new URL(siteArgument.endsWith('/') ? siteArgument : `${siteArgument}/`);
const loopback = site.hostname === '127.0.0.1' || site.hostname === 'localhost'; // only the tests use this
if (site.protocol !== 'https:' && !(loopback && site.protocol === 'http:')) {
  console.error(`Refusing to check ${site}: the published site must be an https address.`);
  process.exit(2);
}

const ATTEMPTS = Number(process.env.VERIFY_ATTEMPTS ?? 18);
const DELAY_MS = Number(process.env.VERIFY_DELAY_MS ?? 10_000);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function download(path) {
  // A throw-away query makes sure a cached copy of an older publish is not what gets checked.
  const url = new URL(path, new URL('v1/', site));
  url.searchParams.set('check', String(Date.now()));
  const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const built = readFileSync(join(folder, 'v1', 'own.envelope.json'));
const document = JSON.parse(Buffer.from(JSON.parse(built.toString('utf8')).payload, 'base64').toString('utf8'));
const pictures = [
  ...document.items.flatMap((item) => Object.values(item.pictures)),
  ...document.schedule.books.map((series) => series.picture),
  ...document.schedule.weapons.map((series) => series.picture),
];

async function checkOnce() {
  const live = await download('own.envelope.json');
  if (!live.equals(built)) throw new Error('the published signed file is not the one that was just built (an older publish is still being served)');
  const queue = [...pictures];
  const problems = [];
  const worker = async () => {
    for (let path = queue.pop(); path !== undefined; path = queue.pop()) {
      try {
        const bytes = await download(path);
        const expected = sha256(readFileSync(join(folder, 'v1', path)));
        const info = inspectPicture(bytes);
        if (info.problem) problems.push(`${path}: ${info.problem}`);
        else if (sha256(bytes) !== expected) problems.push(`${path}: not the picture that was built`);
      } catch (error) {
        problems.push(error.message);
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  if (problems.length > 0) throw new Error(`${problems.length} of ${pictures.length} picture(s) are wrong or missing online, for example ${problems[0]}`);
}

let lastError;
for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  try {
    await checkOnce();
    console.log(`Verified online: version ${document.own_version}, ${pictures.length} picture(s), exactly as built (attempt ${attempt}).`);
    process.exit(0);
  } catch (error) {
    lastError = error;
    console.log(`Attempt ${attempt} of ${ATTEMPTS}: ${error.message}`);
    if (attempt < ATTEMPTS) await sleep(DELAY_MS);
  }
}
console.error(`\nThe site ${site} does not serve what was built: ${lastError.message}.\nThe publish step finished, but players may not be getting the new data. Run this workflow again from the Actions tab; if it keeps failing, see docs/rollback.md.`);
process.exit(1);
