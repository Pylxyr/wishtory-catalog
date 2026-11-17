// Runs tools/add.ps1 for real, with typed answers, in a throwaway copy of the repository.
// Needs PowerShell 7 (pwsh); where it is not installed these tests are skipped, not failed.
// (GitHub's ubuntu runners have pwsh. Windows PowerShell 5 itself cannot be run on Linux.)
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const probe = spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0'], { encoding: 'utf8' });
const skip = probe.status === 0 ? false : 'PowerShell 7 (pwsh) is not installed here';

const made = [];
after(() => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function scratchFolder(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

// A copy of what the helper needs: itself, the check scripts, the pinned key and an empty schedule.
// Like a fresh clone, it has no banners/ folder and no materials/pictures/ folder.
function freshClone() {
  const dir = scratchFolder('catalog-helper-');
  for (const name of ['tools', 'scripts', 'package.json', 'public-key.txt']) cpSync(join(repo, name), join(dir, name), { recursive: true });
  mkdirSync(join(dir, 'materials'));
  writeFileSync(join(dir, 'materials', 'schedule.json'), '{\n  "books": [],\n  "weapons": []\n}\n');
  return dir;
}

function picture() {
  const file = join(scratchFolder('catalog-picture-'), 'picture.png');
  cpSync(join(repo, 'examples', 'materials', 'pictures', 'teachings_of_charity.png'), file);
  return file;
}

function runHelper(clone, answers, { cwd = clone, before = '' } = {}) {
  const env = { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH}` };
  delete env.GITHUB_STEP_SUMMARY; // a test must not write into the real run summary
  delete env.GITHUB_ACTIONS;
  const command = `${before}; & '${join(clone, 'tools', 'add.ps1')}'`;
  return spawnSync('pwsh', ['-NoProfile', '-Command', command], { cwd, env, input: `${answers.join('\n')}\n`, encoding: 'utf8' });
}

const banner = (id) => ['2', 'hk4e', 'character', 'Test banner', '2026-11-03 15:00:00', '2026-11-24 17:59:59', ...id, '', '', ''];

test('a banner id with slashes is refused and asked again, nothing is written outside banners/', { skip }, () => {
  const clone = freshClone();
  const run = runHelper(clone, banner(['../evil', 'Has Space', 'hk4e-character-test']));
  assert.match(run.stdout, /Use lowercase letters, digits, dots, dashes and underscores only/);
  assert.equal(existsSync(join(clone, 'evil.json')), false, 'no file outside banners/');
  assert.equal(existsSync(join(clone, 'banners', 'hk4e-character-test.json')), true);
});

test('the first banner can be written although there is no banners/ folder yet', { skip }, () => {
  const clone = freshClone();
  const run = runHelper(clone, banner(['hk4e-character-test']));
  assert.equal(existsSync(join(clone, 'banners', 'hk4e-character-test.json')), true, run.stdout + run.stderr);
});

test('a name that cannot become a folder name stops before anything is written', { skip }, () => {
  const clone = freshClone();
  const run = runHelper(clone, ['1', 'hk4e', 'character', '???']);
  assert.match(run.stdout + run.stderr, /A folder name cannot be made from '\?\?\?'/);
  assert.equal(existsSync(join(clone, 'items', 'hk4e', 'item.json')), false, 'no item.json loose in the game folder');
});

test('the first series picture can be copied although there is no materials/pictures/ folder yet', { skip }, () => {
  const clone = freshClone();
  const run = runHelper(clone, ['3', 'book', 'Teachings of Charity', 'Charity', '', '1,4', picture()]);
  assert.equal(existsSync(join(clone, 'materials', 'pictures', 'teachings_of_charity.png')), true, run.stdout + run.stderr);
});

test('the final check looks at this repository, not at the folder the helper was started from', { skip }, () => {
  const clone = freshClone();
  mkdirSync(join(clone, 'materials', 'pictures'));
  const elsewhere = scratchFolder('catalog-elsewhere-');
  const run = runHelper(clone, ['3', 'book', 'Teachings of Charity', 'Charity', '', '1,4', picture()], { cwd: elsewhere });
  assert.match(run.stdout, /everything is in order \(0 item\(s\), 0 banner\(s\), 1 farming series\)/, run.stdout + run.stderr);
});

test('a series id with slashes is refused and asked again', { skip }, () => {
  const clone = freshClone();
  mkdirSync(join(clone, 'materials', 'pictures'));
  const run = runHelper(clone, ['3', 'book', 'Teachings of Charity', 'Charity', '../x', 'teachings_of_charity', '1,4', picture()]);
  assert.match(run.stdout, /Use lowercase letters, digits and underscores only/);
  assert.equal(existsSync(join(clone, 'materials', 'x.png')), false);
  assert.equal(existsSync(join(clone, 'materials', 'pictures', 'teachings_of_charity.png')), true, run.stdout + run.stderr);
});

test('names with non-English letters already in schedule.json survive adding another series', { skip }, () => {
  const clone = freshClone();
  mkdirSync(join(clone, 'materials', 'pictures'));
  const title = 'Caf\u00e9 \u2019Frost\u2019 Teachings';
  const old = { books: [{ id: 'cafe_frost', name: 'Caf\u00e9', title, days: [2, 5] }], weapons: [] };
  writeFileSync(join(clone, 'materials', 'schedule.json'), `${JSON.stringify(old, null, 2)}\n`, 'utf8'); // UTF-8 without a byte-order mark
  // Windows PowerShell 5 reads such a file as ANSI unless told otherwise. This makes pwsh do the same.
  const before = "$PSDefaultParameterValues['Get-Content:Encoding'] = 'Latin1'";
  runHelper(clone, ['3', 'weapon', 'Frost Emperor', 'Frost', '', '3,6', picture()], { before });
  const schedule = JSON.parse(readFileSync(join(clone, 'materials', 'schedule.json'), 'utf8'));
  assert.equal(schedule.books[0].title, title);
  assert.equal(schedule.books[0].name, 'Caf\u00e9');
  assert.equal(schedule.weapons.length, 1);
});

test('folder names do not change on a computer set to Turkish (I must stay i)', { skip }, () => {
  const clone = freshClone();
  const before = "[System.Threading.Thread]::CurrentThread.CurrentCulture = [cultureinfo]'tr-TR'";
  const run = runHelper(clone, ['1', 'hk4e', 'character', 'Itto', '10000999', '5', '', 'electro', 'teachings_of_charity', '', ''], { before });
  assert.equal(existsSync(join(clone, 'items', 'hk4e', 'itto', 'item.json')), true, run.stdout + run.stderr);
});
