// Reads the three baskets (items, banners, materials) under a root folder and checks everything.
// Never throws for bad data: every problem is collected as { file, message } in plain words, so one
// run lists all of them. The checks mirror what the Wishtory app itself refuses, so a basket that
// passes here is one the app accepts.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { inspectPicture } from './images.mjs';

export const LIMITS = {
  icon: 512 * 1024, // item icons and farming-series pictures
  wish: 3 * 1024 * 1024, // wish art
  minSide: 16,
  maxSide: 4096,
};

const ELEMENTS = {
  hk4e: ['anemo', 'cryo', 'dendro', 'electro', 'geo', 'hydro', 'pyro'],
  hkrpg: ['physical', 'fire', 'ice', 'lightning', 'wind', 'quantum', 'imaginary'],
  nap: ['physical', 'ice', 'fire', 'electric', 'ether', 'wind', 'lumen'],
};
const PATHS = ['destruction', 'hunt', 'erudition', 'harmony', 'nihility', 'preservation', 'abundance', 'remembrance', 'elation'];
const SPECIALTIES = ['attack', 'stun', 'support', 'anomaly', 'defense', 'rupture', 'armorer'];
const WEAPON_TYPES = ['sword', 'claymore', 'polearm', 'bow', 'catalyst'];

// What each game's items may be, and which extra fields each kind needs.
const GAMES = {
  hk4e: { character: ['element', 'series'], weapon: ['weapon_type', 'series'] },
  hkrpg: { character: ['element', 'path'], light_cone: [] },
  nap: { character: ['element', 'specialty'], weapon: [], bangboo: [] },
};
const ITEM_FIELDS = ['game', 'id', 'name', 'aliases', 'rarity', 'kind', 'element', 'path', 'specialty', 'weapon_type', 'series'];
const POOLS = { hk4e: ['character', 'weapon'], nap: ['character', 'weapon'], hkrpg: ['character', 'weapon', 'collab', 'collab_weapon'] };
const BANNER_FIELDS = ['id', 'game', 'pool', 'name', 'start', 'end', 'featured_5', 'featured_4', 'gacha_ids'];
const SERIES_FIELDS = ['id', 'name', 'title', 'days'];

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SERIES_ID = /^[a-z0-9_]+$/;
const ITEM_ID = /^[0-9]{1,12}$/;
const BANNER_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;

const list = (values) => values.map((v) => `"${v}"`).join(', ');
const isText = (v, max) => typeof v === 'string' && v.trim() !== '' && v.length <= max && !/[\u0000-\u001f]/.test(v);

const CLOCK_SHAPE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// A real date and time on the game's server clock: "2026-11-03 15:00:00". The day must exist in
// that month (leap years included), so 2026-02-31 is refused while 2028-02-29 is fine.
export function isClock(value) {
  const m = CLOCK_SHAPE.exec(value);
  if (!m) return false;
  const [, year, mo, d, h, mi, s] = m.map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lastDay = mo === 2 && leap ? 29 : DAYS_IN_MONTH[mo - 1];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= lastDay && h < 24 && mi < 60 && s < 60;
}

export function validate(rootFolder) {
  const root = resolve(rootFolder);
  const problems = [];
  const rel = (path) => relative(root, path).split('\\').join('/');
  const problem = (file, message) => problems.push({ file: isAbsolute(file) ? rel(file) : file, message });

  const readJson = (path) => {
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch (error) {
      problem(path, `Could not read this file (${error.code ?? error.message}).`);
      return undefined;
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // Windows editors add this invisible mark
    try {
      return JSON.parse(text);
    } catch (error) {
      const at = /position (\d+)/.exec(error.message);
      let where = '';
      if (at) {
        const before = text.slice(0, Number(at[1]));
        const line = before.split('\n').length;
        const column = Number(at[1]) - before.lastIndexOf('\n');
        where = ` Look near line ${line}, column ${column}.`;
      }
      problem(path, `This file is not valid JSON (${error.message.split(' in JSON')[0]}).${where} The usual causes are a missing comma, an extra comma after the last entry, or a missing quote.`);
      return undefined;
    }
  };

  const entries = (dir) => {
    try {
      return readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith('.'));
    } catch {
      return [];
    }
  };

  // A picture file: contents checked, then size and dimensions.
  const readPicture = (path, maxBytes, what) => {
    const buf = readFileSync(path);
    if (buf.length > maxBytes) {
      problem(path, `This ${what} is ${(buf.length / 1024).toFixed(0)} KB; the limit is ${(maxBytes / 1024).toFixed(0)} KB. Make it smaller (export at a lower size).`);
      return undefined;
    }
    const info = inspectPicture(buf);
    if (info.problem) {
      problem(path, info.problem);
      return undefined;
    }
    if (info.width < LIMITS.minSide || info.height < LIMITS.minSide || info.width > LIMITS.maxSide || info.height > LIMITS.maxSide) {
      problem(path, `This ${what} is ${info.width}x${info.height} pixels; each side must be between ${LIMITS.minSide} and ${LIMITS.maxSide}.`);
      return undefined;
    }
    return { file: rel(path), buf, format: info.format, width: info.width, height: info.height };
  };

  // ---------------------------------------------------------------- items
  const items = [];
  const itemsDir = join(root, 'items');
  for (const gameEntry of entries(itemsDir)) {
    const gamePath = join(itemsDir, gameEntry.name);
    if (!gameEntry.isDirectory()) {
      problem(gamePath, 'Loose file in the items basket. Items belong in items/<game>/<name>/, for example items/hk4e/mitya/.');
      continue;
    }
    if (!GAMES[gameEntry.name]) {
      problem(gamePath, `"${gameEntry.name}" is not a game folder. Use one of: ${list(Object.keys(GAMES))}.`);
      continue;
    }
    for (const itemEntry of entries(gamePath)) {
      const dir = join(gamePath, itemEntry.name);
      if (!itemEntry.isDirectory()) {
        problem(dir, `Loose file in items/${gameEntry.name}/. Each item gets its own folder, for example items/${gameEntry.name}/mitya/.`);
        continue;
      }
      const item = readItem(dir, gameEntry.name, itemEntry.name);
      if (item) items.push(item);
    }
  }

  function readItem(dir, game, slug) {
    if (!SLUG.test(slug)) {
      problem(dir, `The folder name "${slug}" is not allowed. Use lowercase letters, digits and single dashes, for example "starsealed-edict".`);
    }
    const files = new Map();
    for (const entry of entries(dir)) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        problem(path, 'Unexpected folder inside an item folder. An item folder holds only item.json, icon.png and (for characters) wish.png.');
        continue;
      }
      const m = /^(item|icon|wish)\.(json|png|webp)$/.exec(entry.name);
      const okExt = m && (m[1] === 'item' ? m[2] === 'json' : m[2] !== 'json');
      if (!okExt) {
        problem(path, `Unexpected file "${entry.name}". Allowed names are exactly item.json, icon.png (or .webp) and wish.png (or .webp), all in lowercase. Rename or remove it.`);
        continue;
      }
      if (files.has(m[1])) {
        problem(path, `There are two ${m[1]} files in this folder. Keep only one.`);
        continue;
      }
      files.set(m[1], path);
    }

    const jsonPath = files.get('item');
    if (!jsonPath) {
      problem(dir, 'This item folder has no item.json.');
      return undefined;
    }
    const raw = readJson(jsonPath);
    if (raw === undefined) return undefined;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      problem(jsonPath, 'item.json must be one JSON object between { and }.');
      return undefined;
    }

    for (const key of Object.keys(raw)) {
      if (!ITEM_FIELDS.includes(key)) problem(jsonPath, `Unknown field "${key}". Allowed fields: ${list(ITEM_FIELDS)}.`);
    }
    if (raw.game !== game) problem(jsonPath, `"game" says ${JSON.stringify(raw.game)} but this folder is under items/${game}/. They must match.`);
    if (typeof raw.id !== 'string' || !ITEM_ID.test(raw.id)) problem(jsonPath, '"id" must be the game\'s item number written in quotes, digits only, for example "10000136".');
    if (!isText(raw.name, 160)) problem(jsonPath, '"name" must be the item\'s English name, 1 to 160 characters.');
    if (raw.aliases !== undefined && (!Array.isArray(raw.aliases) || raw.aliases.length > 32 || raw.aliases.some((a) => !isText(a, 160)))) {
      problem(jsonPath, '"aliases" must be a list of other names in quotes (at most 32), for example ["Alt Name"], or []. ');
    }
    if (!Number.isInteger(raw.rarity) || raw.rarity < 1 || raw.rarity > 5) problem(jsonPath, '"rarity" must be a whole number from 1 to 5 (not in quotes).');

    const kinds = GAMES[game];
    const needs = kinds[raw.kind];
    if (needs === undefined) {
      problem(jsonPath, `"kind" is ${JSON.stringify(raw.kind)}, but ${game} items are ${list(Object.keys(kinds))}.`);
    } else {
      for (const field of ['element', 'path', 'specialty', 'weapon_type', 'series']) {
        const value = raw[field];
        if (!needs.includes(field)) {
          if (value !== undefined) problem(jsonPath, `"${field}" is not used for ${game} items of kind "${raw.kind}". Remove that line.`);
          continue;
        }
        if (value === undefined || value === '') {
          problem(jsonPath, `"${field}" is missing. ${game} ${raw.kind}s need it.`);
          continue;
        }
        const allowed = { element: ELEMENTS[game], path: PATHS, specialty: SPECIALTIES, weapon_type: WEAPON_TYPES }[field];
        if (allowed && !allowed.includes(value)) problem(jsonPath, `"${field}" is ${JSON.stringify(value)}, but it must be one of ${list(allowed)}.`);
        if (field === 'series' && (typeof value !== 'string' || !SERIES_ID.test(value))) {
          problem(jsonPath, '"series" must be a farming series id such as "teachings_of_charity" (lowercase letters, digits, underscores).');
        }
      }
    }

    // Pictures: icon for everything, wish art for characters.
    const pictures = {};
    const iconPath = files.get('icon');
    if (!iconPath) problem(dir, 'Missing picture: this item needs icon.png (or icon.webp).');
    else pictures.icon = readPicture(iconPath, LIMITS.icon, 'icon');
    const wishPath = files.get('wish');
    if (raw.kind === 'character') {
      if (!wishPath) problem(dir, 'Missing picture: a character needs wish.png (or wish.webp), the wish art.');
      else pictures.wish = readPicture(wishPath, LIMITS.wish, 'wish art');
    } else if (wishPath) {
      problem(wishPath, `Only characters have wish art. Remove this file, or check that "kind" is right (it says ${JSON.stringify(raw.kind)}).`);
    }

    // Kept even when something is wrong with it, so other files are not blamed for a "missing" item.
    return {
      dir: rel(dir),
      slug,
      game,
      id: raw.id,
      name: typeof raw.name === 'string' ? raw.name.trim() : '',
      aliases: Array.isArray(raw.aliases) ? raw.aliases.filter((a) => typeof a === 'string').map((a) => a.trim()) : [],
      rarity: raw.rarity,
      kind: raw.kind,
      element: raw.element,
      path: raw.path,
      specialty: raw.specialty,
      weapon_type: raw.weapon_type,
      series: raw.series,
      pictures,
      jsonFile: rel(jsonPath),
    };
  }

  const seenIds = new Map();
  for (const item of items) {
    const key = `${item.game}|${item.id}`;
    if (seenIds.has(key)) {
      problem(item.jsonFile, `The id "${item.id}" is already used by ${seenIds.get(key)}. Every item needs its own id.`);
    } else {
      seenIds.set(key, item.jsonFile);
    }
  }

  // ---------------------------------------------------------------- materials
  const schedulePath = join(root, 'materials', 'schedule.json');
  const schedule = { books: [], weapons: [] };
  const seriesPictures = new Map();
  const seriesKind = new Map(); // id -> 'books' | 'weapons'
  if (!existsSync(schedulePath)) {
    problem(schedulePath, 'materials/schedule.json is missing. An empty schedule is {"books": [], "weapons": []}.');
  } else {
    const raw = readJson(schedulePath);
    if (raw !== undefined) {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        problem(schedulePath, 'The schedule must be one JSON object with a "books" list and a "weapons" list.');
      } else {
        for (const key of Object.keys(raw)) {
          if (key !== 'books' && key !== 'weapons') problem(schedulePath, `Unknown top-level field "${key}". Only "books" and "weapons" are allowed.`);
        }
        for (const group of ['books', 'weapons']) {
          if (!Array.isArray(raw[group])) {
            problem(schedulePath, `"${group}" must be a list (use [] when there is nothing yet).`);
            continue;
          }
          raw[group].forEach((entry, index) => {
            const label = `${group}[${index + 1}]${entry && typeof entry.id === 'string' ? ` ("${entry.id}")` : ''}`;
            if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
              problem(schedulePath, `${label} must be an object like {"id": ..., "name": ..., "title": ..., "days": [...]}.`);
              return;
            }
            for (const key of Object.keys(entry)) {
              if (!SERIES_FIELDS.includes(key)) problem(schedulePath, `${label} has an unknown field "${key}". Allowed: ${list(SERIES_FIELDS)}. (Which items use a series comes from each item's "series" line, so it is not written here.)`);
            }
            if (typeof entry.id !== 'string' || !SERIES_ID.test(entry.id)) {
              problem(schedulePath, `${label}: "id" must be lowercase letters, digits and underscores, like "teachings_of_charity".`);
              return;
            }
            if (!isText(entry.name, 80)) problem(schedulePath, `${label}: "name" is the short name such as "Charity" (1 to 80 characters).`);
            if (!isText(entry.title, 120)) problem(schedulePath, `${label}: "title" is the full name such as "Teachings of Charity" (1 to 120 characters).`);
            if (!Array.isArray(entry.days) || entry.days.length === 0 || entry.days.some((d) => !Number.isInteger(d) || d < 1 || d > 6) || new Set(entry.days).size !== entry.days.length) {
              problem(schedulePath, `${label}: "days" must list the weekdays it can be farmed, Monday = 1 to Saturday = 6, for example [1, 4]. Sunday is never listed because every domain is open on Sundays.`);
            }
            if (seriesKind.has(entry.id)) {
              problem(schedulePath, `${label}: the series id "${entry.id}" is used twice. Every series needs its own id.`);
              return;
            }
            seriesKind.set(entry.id, group);
            schedule[group].push({ id: entry.id, name: entry.name, title: entry.title, days: entry.days });
          });
        }
      }
    }
  }
  const picturesDir = join(root, 'materials', 'pictures');
  for (const entry of entries(picturesDir)) {
    const path = join(picturesDir, entry.name);
    const m = /^([a-z0-9_]+)\.(png|webp)$/.exec(entry.name);
    if (entry.isDirectory() || !m) {
      problem(path, `Unexpected "${entry.name}" in materials/pictures/. Pictures are named after the series id, lowercase, for example teachings_of_charity.png.`);
      continue;
    }
    if (seriesPictures.has(m[1])) {
      problem(path, `There are two pictures for the series "${m[1]}". Keep only one.`);
      continue;
    }
    const picture = readPicture(path, LIMITS.icon, 'series picture');
    if (picture) seriesPictures.set(m[1], picture);
    else seriesPictures.set(m[1], null); // present but bad: already reported, do not also report it missing
  }
  for (const [id, group] of seriesKind) {
    if (!seriesPictures.has(id)) {
      problem(schedulePath, `The ${group === 'books' ? 'talent book' : 'weapon material'} series "${id}" has no picture. Add materials/pictures/${id}.png.`);
    }
  }
  for (const id of seriesPictures.keys()) {
    if (!seriesKind.has(id)) {
      problem(join(picturesDir, `${id}.png`), `This picture is for the series "${id}", which is not in materials/schedule.json. Add the series there, or remove the picture.`);
    }
  }

  // Items must use a series that exists, of the right kind (books for characters, materials for weapons).
  for (const item of items) {
    if (item.series === undefined) continue;
    const group = seriesKind.get(item.series);
    const wanted = item.kind === 'character' ? 'books' : 'weapons';
    if (group === undefined) {
      problem(item.jsonFile, `"series" says "${item.series}", but there is no such farming series in materials/schedule.json. Add it there first, or fix the spelling.`);
    } else if (group !== wanted) {
      problem(item.jsonFile, `"series" says "${item.series}", which is a ${group === 'books' ? 'talent book' : 'weapon material'} series, but a ${item.kind} uses ${wanted === 'books' ? 'a talent book' : 'a weapon material'} series.`);
    }
  }

  // ---------------------------------------------------------------- banners
  const banners = [];
  const bannersDir = join(root, 'banners');
  const bannerIds = new Map();
  for (const entry of entries(bannersDir)) {
    const path = join(bannersDir, entry.name);
    if (entry.isDirectory() || !entry.name.endsWith('.json')) {
      problem(path, `Unexpected "${entry.name}" in banners/. A banner is one file named after its id, for example banners/hk4e-character-2026-11-04.json.`);
      continue;
    }
    const raw = readJson(path);
    if (raw === undefined) continue;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      problem(path, 'A banner file must be one JSON object between { and }.');
      continue;
    }
    const before = problems.length;
    for (const key of Object.keys(raw)) {
      if (!BANNER_FIELDS.includes(key)) problem(path, `Unknown field "${key}". Allowed fields: ${list(BANNER_FIELDS)}.`);
    }
    if (typeof raw.id !== 'string' || !BANNER_ID.test(raw.id)) problem(path, '"id" must be lowercase letters, digits, dots, dashes or underscores, for example "hk4e-character-2026-11-04".');
    else if (`${raw.id}.json` !== entry.name) problem(path, `The file is named ${entry.name} but "id" says "${raw.id}". The file name must be the id plus .json.`);
    if (!GAMES[raw.game]) problem(path, `"game" must be one of ${list(Object.keys(GAMES))}.`);
    else if (!POOLS[raw.game].includes(raw.pool)) problem(path, `"pool" is ${JSON.stringify(raw.pool)}, but ${raw.game} banners use ${list(POOLS[raw.game])}. The pool is the pity the banner shares with other banners of that pool.`);
    if (!isText(raw.name, 160)) problem(path, '"name" is the banner\'s title, 1 to 160 characters.');
    for (const field of ['start', 'end']) {
      if (typeof raw[field] !== 'string' || !CLOCK_SHAPE.test(raw[field])) problem(path, `"${field}" must look like "2026-11-03 15:00:00" (the game's server clock, date, a space, time).`);
      else if (!isClock(raw[field])) problem(path, `"${field}" says "${raw[field]}", which is not a real date and time. Check that the day exists in that month and that the time is between 00:00:00 and 23:59:59.`);
    }
    if (isClock(raw.start ?? '') && isClock(raw.end ?? '') && raw.start > raw.end) problem(path, '"start" is later than "end".');
    const five = raw.featured_5;
    if (!Array.isArray(five) || five.length < 1 || five.length > 8 || five.some((id) => typeof id !== 'string' || id.trim() === '' || id.length > 80)) {
      problem(path, '"featured_5" must list the featured 5-star item ids in quotes, 1 to 8 of them, for example ["10000136"].');
    }
    const four = raw.featured_4 ?? [];
    if (!Array.isArray(four) || four.length > 16 || four.some((id) => typeof id !== 'string' || id.trim() === '' || id.length > 80)) {
      problem(path, '"featured_4" must be a list of item ids in quotes (at most 16), or [].');
    }
    const gacha = raw.gacha_ids ?? [];
    if (!Array.isArray(gacha) || gacha.length > 8 || gacha.some((id) => typeof id !== 'string' || id.trim() === '' || id.length > 80)) {
      problem(path, '"gacha_ids" must be a list of ids in quotes (at most 8), or [] (only Star Rail and Zenless banners use it).');
    }
    if (problems.length > before) continue;
    if (bannerIds.has(raw.id)) {
      problem(path, `The banner id "${raw.id}" is already used by ${bannerIds.get(raw.id)}.`);
      continue;
    }
    bannerIds.set(raw.id, rel(path));
    for (const id of [...five, ...four]) {
      if (!seenIds.has(`${raw.game}|${id}`)) {
        problem(path, `The featured item "${id}" does not exist. Add an item folder for it under items/${raw.game}/ (with its item.json and pictures) first.`);
      }
    }
    banners.push({
      id: raw.id,
      game: raw.game,
      pool: raw.pool,
      name: raw.name.trim(),
      gacha_ids: gacha,
      start: raw.start,
      end: raw.end,
      featured_5: five,
      featured_4: four,
      file: rel(path),
    });
  }

  return { problems, items, banners, schedule, seriesPictures };
}

export function totalBytes(path) {
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.size;
  return readdirSync(path).reduce((sum, name) => sum + totalBytes(join(path, name)), 0);
}
