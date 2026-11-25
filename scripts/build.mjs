// Checks the baskets and, only if they are fine, assembles and signs what the app downloads.
//   node scripts/build.mjs [--root <folder>] [--out <folder>] [--published <version>] [--version <n>]
// Writes <out>/site/ (this folder is what gets published):
//   v1/own.envelope.json   the signed data: items, banners, farming schedule, picture addresses
//   v1/pictures/...        the item pictures, named with the picture's own SHA-256 fingerprint, so a
//                          changed picture gets a new address (the app keeps pictures by address)
//                          and a downloaded picture can be checked against its name
//   v1/materials/...       one picture per farming series
// The signing key comes from CATALOG_SIGNING_KEY (the PEM text) or CATALOG_SIGNING_KEY_FILE.
import './lib/node-version.mjs'; // first: stops loudly on a Node.js too old for import.meta.main
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { printReport } from './validate.mjs';
import { validate, totalBytes } from './lib/validate.mjs';
import { loadPrivateKey, signEnvelope, openEnvelope, pinnedPublicKey } from './lib/sign.mjs';

const MAX_PAYLOAD_BYTES = 3.5 * 1024 * 1024; // the app accepts 4 MiB; stay clear of it
const MAX_SITE_BYTES = 900 * 1024 * 1024; // GitHub Pages sites may be no larger than 1 GB

const fingerprint = (buf) => createHash('sha256').update(buf).digest('hex');
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function assemble(data, { version, now = new Date(), site }) {
  const place = (picture, relativeFolder, name) => {
    const path = `${relativeFolder}/${name}.${fingerprint(picture.buf)}.${picture.format}`;
    if (site) {
      mkdirSync(join(site, 'v1', relativeFolder), { recursive: true });
      writeFileSync(join(site, 'v1', path), picture.buf);
    }
    return path;
  };

  const usersOf = (seriesId) =>
    data.items
      .filter((item) => item.series === seriesId)
      .map((item) => ({ name: item.name, rarity: item.rarity }))
      .sort((a, b) => b.rarity - a.rarity || byText(a.name, b.name));

  const items = [...data.items].sort((a, b) => byText(a.game, b.game) || byText(a.id, b.id)).map((item) => {
    const traits = {};
    for (const key of ['element', 'path', 'specialty']) if (item[key] !== undefined) traits[key] = item[key];
    const pictures = { icon: place(item.pictures.icon, `pictures/${item.game}/${item.slug}`, 'icon') };
    if (item.pictures.wish) pictures.wish = place(item.pictures.wish, `pictures/${item.game}/${item.slug}`, 'wish');
    const out = { game: item.game, id: item.id, name: item.name, aliases: item.aliases, rarity: item.rarity, kind: item.kind, traits };
    if (item.weapon_type !== undefined) out.weapon_type = item.weapon_type;
    if (item.series !== undefined) out.series = item.series;
    out.pictures = pictures;
    return out;
  });

  const banners = [...data.banners]
    .sort((a, b) => byText(a.start, b.start) || byText(a.id, b.id))
    .map(({ file, ...banner }) => banner);

  const series = (group) =>
    data.schedule[group].map((s) => ({
      id: s.id,
      name: s.name,
      title: s.title,
      days: s.days,
      users: usersOf(s.id),
      picture: place(data.seriesPictures.get(s.id), 'materials', s.id),
    }));

  return {
    schema_version: 1,
    own_version: version,
    generated_at: now.toISOString(),
    items,
    banners,
    schedule: { books: series('books'), weapons: series('weapons') },
  };
}

// Every picture the signed data names must be a real file under <site>/v1/. Returns the ones that are not.
export function missingPictures(document, site) {
  const named = [
    ...document.items.flatMap((item) => Object.values(item.pictures)),
    ...document.schedule.books.map((series) => series.picture),
    ...document.schedule.weapons.map((series) => series.picture),
  ];
  return named.filter((path) => !existsSync(join(site, 'v1', path)));
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : fallback;
  };
  const root = option('--root', '.');
  const out = option('--out', 'dist');

  const result = validate(root);
  printReport(result);
  if (result.problems.length > 0) {
    console.error('\nNothing was assembled or signed.');
    process.exit(1);
  }

  const fail = (message) => {
    console.error(`\nBuild stopped: ${message}`);
    process.exit(1);
  };

  const published = Number(option('--published', '0'));
  if (!Number.isSafeInteger(published) || published < 0) fail('--published must be a whole number.');
  const now = new Date();
  const version = Number(option('--version', Math.max(Math.floor(now.getTime() / 1000), published + 1)));
  if (!Number.isSafeInteger(version) || version <= published) fail(`the version (${version}) must be higher than the one already published (${published}).`);

  let privateKey;
  try {
    const pem = process.env.CATALOG_SIGNING_KEY ?? (process.env.CATALOG_SIGNING_KEY_FILE ? readFileSync(process.env.CATALOG_SIGNING_KEY_FILE, 'utf8') : '');
    privateKey = loadPrivateKey(pem);
  } catch (error) {
    fail(error.message);
  }

  const site = join(out, 'site');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(site, 'v1'), { recursive: true });

  const document = assemble(result, { version, now, site });
  const payload = Buffer.from(`${JSON.stringify(document)}\n`);
  if (payload.length > MAX_PAYLOAD_BYTES) fail(`the data file would be ${(payload.length / 1048576).toFixed(1)} MB, over the ${(MAX_PAYLOAD_BYTES / 1048576).toFixed(1)} MB the app accepts.`);

  const envelope = signEnvelope(payload, privateKey);
  writeFileSync(join(site, 'v1', 'own.envelope.json'), envelope);
  writeFileSync(
    join(site, 'index.html'),
    '<!doctype html><meta charset="utf-8"><title>Wishtory data</title>' +
      '<p>Signed game data and pictures for the <a href="https://github.com/Pylxyr/Wishtory">Wishtory</a> app. ' +
      'Nothing here is meant to be read by hand. Source: <a href="https://github.com/Pylxyr/wishtory-catalog">wishtory-catalog</a>.</p>\n',
  );

  // The last check: what was written must open with the pinned key and refer only to pictures that exist.
  const reopened = openEnvelope(readFileSync(join(site, 'v1', 'own.envelope.json')), pinnedPublicKey());
  if (!reopened || !reopened.equals(payload)) fail('the signed file could not be verified after writing it. Nothing is published.');
  const missing = missingPictures(JSON.parse(reopened.toString('utf8')), site);
  if (missing.length > 0) fail(`the signed data names ${missing.length} picture(s) that are not in the site, for example ${missing[0]}. Nothing is published.`);
  const size = totalBytes(site);
  if (size > MAX_SITE_BYTES) fail(`the published site would be ${(size / 1048576).toFixed(0)} MB; GitHub Pages allows 1 GB. Remove pictures or make them smaller.`);

  console.log(`\nBuilt version ${version}: ${document.items.length} item(s), ${document.banners.length} banner(s), signed and ready in ${site} (${(size / 1048576).toFixed(1)} MB).`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, `### Published version ${version}\n${document.items.length} item(s), ${document.banners.length} banner(s).\n`, { flag: 'a' });
  }
}
