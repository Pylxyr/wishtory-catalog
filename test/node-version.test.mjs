// The scripts start themselves with import.meta.main, which older Node.js versions do not have.
// On those versions they would run nothing and still exit 0, so they must stop loudly instead.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { unsupportedNode } from '../scripts/lib/node-version.mjs';

test('Node.js versions without import.meta.main are refused with a plain message', () => {
  for (const version of ['18.20.4', '20.19.0', '22.2.0', '22.17.0', '22.17.9', '23.11.0', '24.0.0', '24.1.0']) {
    const message = unsupportedNode(version);
    assert.ok(message, `${version} should be refused`);
    assert.ok(message.includes(version), 'the message names the version that is running');
    assert.match(message, /need Node\.js 22\.18/);
  }
});

test('Node.js versions that have import.meta.main are accepted', () => {
  for (const version of ['22.18.0', '22.23.4', '24.2.0', '24.13.1', '25.0.0', '26.13.1', '27.0.0']) {
    assert.equal(unsupportedNode(version), null, `${version} should be accepted`);
  }
});

test('package.json "engines" asks for the same versions as the check', () => {
  const { engines } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(engines.node, '^22.18.0 || >=24.2.0');
});
