// A banner date must be a date that exists: 2026-02-31 looks right but is not a real day.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { isClock, validate } from '../scripts/lib/validate.mjs';

test('isClock accepts real dates and times, leap days included', () => {
  for (const value of ['2026-11-03 15:00:00', '2026-02-28 23:59:59', '2028-02-29 00:00:00', '2000-02-29 12:00:00', '2026-12-31 00:00:00']) {
    assert.equal(isClock(value), true, value);
  }
});

test('isClock refuses days that do not exist, and times outside the clock', () => {
  for (const value of [
    '2026-02-31 10:00:00', // no 31st in February
    '2026-02-29 10:00:00', // 2026 is not a leap year
    '1900-02-29 10:00:00', // a century year that is not a leap year
    '2026-04-31 10:00:00', // April has 30 days
    '2026-13-01 10:00:00',
    '2026-00-10 10:00:00',
    '2026-01-00 10:00:00',
    '2026-11-03 24:00:00',
    '2026-11-03 15:60:00',
    '2026-11-03 15:00:60',
    '2026-11-3 15:00:00', // wrong shape
  ]) {
    assert.equal(isClock(value), false, value);
  }
});

test('the validator names the banner file and says the date is not real', () => {
  const root = mkdtempSync(join(tmpdir(), 'catalog-dates-'));
  try {
    mkdirSync(join(root, 'banners'));
    mkdirSync(join(root, 'materials'));
    writeFileSync(join(root, 'materials', 'schedule.json'), '{"books": [], "weapons": []}');
    writeFileSync(
      join(root, 'banners', 'hk4e-character-test.json'),
      JSON.stringify({
        id: 'hk4e-character-test',
        game: 'hk4e',
        pool: 'character',
        name: 'Test',
        start: '2026-02-31 10:00:00',
        end: '2026-03-20 17:59:59',
        featured_5: ['10000136'],
      }),
    );
    const { problems } = validate(root);
    assert.equal(problems.length, 1, JSON.stringify(problems));
    assert.equal(problems[0].file, 'banners/hk4e-character-test.json');
    assert.match(problems[0].message, /"start" says "2026-02-31 10:00:00", which is not a real date and time/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
